//! Folder access is selected with the native picker, never a web-supplied path.
use std::{io::Write,path::PathBuf,process::{Command,Stdio},sync::Mutex};
use serde_json::{json,Value};
use tauri::{AppHandle,Manager,WebviewWindow};
use tauri_plugin_dialog::DialogExt;
#[derive(Default)]
pub struct FolderSync(pub Mutex<()>);
fn authorize(window:&WebviewWindow)->Result<(),String>{
 let url=window.url().map_err(|_| "Cannot verify Studio window")?;
 let local=(url.scheme()=="tauri"&&url.host_str()==Some("localhost"))||(cfg!(windows)&&url.scheme()=="http"&&url.host_str()==Some("tauri.localhost"));
 if window.label()!="main"||!local||url.port().is_some()||!url.username().is_empty()||url.password().is_some(){return Err("Folder sync requires the packaged Studio window".into());}Ok(())
}
fn config(app:&AppHandle)->Result<PathBuf,String>{Ok(app.path().app_data_dir().map_err(|_| "Cannot locate folder settings")?.join("project-sync-folder.json"))}
fn selected(app:&AppHandle)->Result<Option<PathBuf>,String>{
 let file=config(app)?;if !file.exists(){return Ok(None);}
 let raw=std::fs::read(file).map_err(|_| "Cannot read folder settings")?;
 let value:Value=serde_json::from_slice(&raw).map_err(|_| "Invalid folder settings")?;
 let path=PathBuf::from(value["path"].as_str().ok_or("Invalid folder settings")?);
 if !path.is_absolute(){return Err("Invalid folder settings".into());}Ok(Some(path))
}
#[tauri::command]
pub async fn sync_folder_pick(app:AppHandle,window:WebviewWindow)->Result<Value,String>{
 authorize(&window)?;
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<FolderSync>();let _guard=state.0.lock().unwrap();
  let Some(choice)=app.dialog().file().set_title("Choose your project sync folder").blocking_pick_folder() else{return Ok(json!({"cancelled":true}));};
  let path=choice.into_path().map_err(|_| "Choose a local or mounted folder")?.canonicalize().map_err(|_| "This folder is unavailable")?;
  if !path.is_dir(){return Err("Choose a folder".into());}
  let file=config(&app)?;std::fs::create_dir_all(file.parent().unwrap()).map_err(|_| "Cannot save folder settings")?;
  let temporary=file.with_extension("json.tmp");
  std::fs::write(&temporary,serde_json::to_vec(&json!({"path":path})).unwrap()).map_err(|_| "Cannot save folder settings")?;
  std::fs::rename(temporary,file).map_err(|_| "Cannot preserve folder selection")?;
  Ok(json!({"path":path}))
 }).await.map_err(|_| "Folder selection failed")?
}
#[tauri::command]
pub async fn sync_folder_status(app:AppHandle,window:WebviewWindow)->Result<Value,String>{
 authorize(&window)?;
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<FolderSync>();let _guard=state.0.lock().unwrap();
  Ok(json!({"path":selected(&app)?}))
 }).await.map_err(|_| "Cannot inspect folder selection")?
}
#[tauri::command]
pub async fn sync_folder_disconnect(app:AppHandle,window:WebviewWindow)->Result<(),String>{
 authorize(&window)?;
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<FolderSync>();let _guard=state.0.lock().unwrap();
  match std::fs::remove_file(config(&app)?){Ok(())=>Ok(()),Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(()),Err(_)=>Err("Cannot forget folder selection".into())}
 }).await.map_err(|_| "Folder disconnect failed")?
}
#[tauri::command]
pub async fn sync_folder_request(app:AppHandle,window:WebviewWindow,request:Value)->Result<Value,String>{
 authorize(&window)?;
 let input=serde_json::to_vec(&request).map_err(|_| "Invalid sync request")?;
 if input.len()>32*1024*1024{return Err("Sync request exceeds size limit".into());}
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<FolderSync>();let _guard=state.0.lock().unwrap();
  let root=selected(&app)?.ok_or("Choose a sync folder first")?;
  if request["folder"].as_str()!=root.to_str(){return Err("The selected folder changed. Retry sync with the current selection".into());}
  let node=super::find_node(&None).ok_or("Install Node.js to use desktop folder sync")?;
  let script=app.path().resource_dir().map_err(|_| "Cannot locate sync resources")?.join("workbench/project-sync-worker.mjs");
  if !script.is_file(){return Err("This build is missing folder sync resources".into());}
  let mut child=Command::new(node).arg(script).arg("--folder").arg(root).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().map_err(|_| "Cannot start folder sync")?;
  let sent=child.stdin.take().ok_or("Cannot open sync input")?.write_all(&input);
  if sent.is_err(){let _=child.kill();let _=child.wait();return Err("Cannot send folder sync request".into());}
  let output=child.wait_with_output().map_err(|_| "Folder sync worker failed")?;
  if !output.status.success(){return Err(String::from_utf8_lossy(&output.stderr).chars().take(1000).collect());}
  if output.stdout.len()>64*1024*1024{return Err("Folder sync response exceeds size limit".into());}
  serde_json::from_slice(&output.stdout).map_err(|_| "Invalid folder sync response".into())
 }).await.map_err(|_| "Folder sync task failed")?
}

/// Owner-only configuration: page requests cannot supply arbitrary filesystem roots.
#[tauri::command]
pub async fn sync_server_configure(app:AppHandle,window:WebviewWindow,enabled:bool,folder:String)->Result<Value,String>{
 authorize(&window)?;
 tauri::async_runtime::spawn_blocking(move||{
  let lock=app.state::<FolderSync>();let _guard=lock.0.lock().unwrap();
  let selected=selected(&app)?.ok_or("Choose a folder first")?;
  if selected.to_str()!=Some(folder.as_str()){return Err("The selected folder changed".into());}
  let cfg_path=super::workbench_cfg_path(&app);
  let mut cfg=if cfg_path.exists(){super::read_json(&cfg_path).ok_or("Cannot read existing server configuration")?}else{
   if !enabled{return Ok(json!({"enabled":false,"restartRequired":false}));}
   let node=super::find_node(&None).ok_or("Install Node.js to share projects with other devices")?;
   let listener=std::net::TcpListener::bind("127.0.0.1:0").map_err(|_| "Cannot choose a server port")?;
   let port=listener.local_addr().map_err(|_| "Cannot choose a server port")?.port();
   json!({"enabled":true,"port":port,"token":super::mint_token()?,"node":node,"projectsRoot":super::data_dir(&app).join("workbench-projects")})
  };
  if !cfg.is_object(){return Err("Invalid server configuration".into());}
  if enabled{
   if !selected.is_dir(){return Err("The selected folder is unavailable".into());}
   cfg["enabled"]=json!(true);
   cfg["syncFolder"]=json!(selected);
   let origins=cfg.as_object_mut().unwrap().entry("syncOrigins").or_insert(json!([])).as_array_mut().ok_or("Invalid browser origin configuration")?;
   for origin in ["tauri://localhost","http://tauri.localhost"]{if !origins.iter().any(|value|value.as_str()==Some(origin)){origins.push(json!(origin));}}
  }else{cfg.as_object_mut().unwrap().remove("syncFolder");}
  std::fs::create_dir_all(cfg_path.parent().unwrap()).map_err(|_| "Cannot save server settings")?;
  let temporary=cfg_path.with_extension("json.sync-tmp");
  let mut options=std::fs::OpenOptions::new();options.write(true).create_new(true);
  #[cfg(unix)]{use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
  let mut file=options.open(&temporary).map_err(|_| "Cannot stage server settings")?;
  let result=(||{file.write_all(&serde_json::to_vec_pretty(&cfg).map_err(|_| "Invalid server settings")?).map_err(|_| "Cannot write server settings")?;file.sync_all().map_err(|_| "Cannot preserve server settings")?;drop(file);std::fs::rename(&temporary,&cfg_path).map_err(|_| "Cannot apply server settings")})();// No tokens in the result.
  if result.is_err(){let _=std::fs::remove_file(&temporary);}result?;
  Ok(json!({"enabled":enabled,"restartRequired":true}))
 }).await.map_err(|_| "Server configuration failed")?
}
