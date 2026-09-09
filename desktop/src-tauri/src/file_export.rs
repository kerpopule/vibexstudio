//! User-selected native exports, isolated from WebKit's download handling.
use std::{collections::HashMap,fs::{File,OpenOptions},io::Write,path::PathBuf,sync::Mutex};
use tauri::{AppHandle,Manager,WebviewWindow};
use tauri_plugin_dialog::DialogExt;
#[derive(Default)]
pub struct FileExports(Mutex<HashMap<String,Session>>);
struct Session {file:Option<File>,temporary:PathBuf,target:PathBuf,bytes:u64,next:u64,last:Vec<u8>}
impl Drop for Session {fn drop(&mut self){drop(self.file.take());let _=std::fs::remove_file(&self.temporary);}}
fn authorize(window:&WebviewWindow)->Result<(),String>{
 let url=window.url().map_err(|_|"Cannot verify Studio window")?;
 let local=(url.scheme()=="tauri"&&url.host_str()==Some("localhost"))||(cfg!(windows)&&url.scheme()=="http"&&url.host_str()==Some("tauri.localhost"));
 if window.label()!="main"||!local||url.port().is_some()||!url.username().is_empty()||url.password().is_some(){return Err("File exports require the packaged Studio window".into());}Ok(())
}
fn identity()->Result<String,String>{let mut raw=[0u8;16];getrandom::getrandom(&mut raw).map_err(|_|"Cannot create export identity")?;Ok(raw.iter().map(|b|format!("{b:02x}")).collect())}
impl Session {
 fn create(target:PathBuf,id:&str)->Result<Self,String>{
  if target.exists(){return Err("Choose a new filename. Existing files are never replaced.".into());}
  let parent=target.parent().ok_or("Choose a file in a folder")?;
  let temporary=parent.join(format!(".vibex-export-{id}.partial"));
  let mut options=OpenOptions::new();options.write(true).create_new(true);
  #[cfg(unix)] {use std::os::unix::fs::OpenOptionsExt;options.mode(0o600);}
  let file=options.open(&temporary).map_err(|_|"Cannot create the export. Check folder access and free space.")?;
  Ok(Self{file:Some(file),temporary,target,bytes:0,next:0,last:Vec::new()})
 }
 fn write(&mut self,sequence:u64,bytes:Vec<u8>)->Result<(),String>{
  if bytes.is_empty()||bytes.len()>1024*1024{return Err("Invalid export chunk size".into());}
  if self.next>0&&sequence==self.next-1&&bytes==self.last{return Ok(());}
  if sequence!=self.next||self.bytes+bytes.len() as u64>0xffff_ffff{return Err("Export sequence or size limit exceeded".into());}
  self.file.as_mut().ok_or("Export is closed")?.write_all(&bytes).map_err(|_|"Could not write export. Check free space.")?;
  self.bytes+=bytes.len() as u64;self.next+=1;self.last=bytes;Ok(())
 }
 fn finish(mut self)->Result<(),String>{
  let mut file=self.file.take().ok_or("Export is closed")?;
  file.flush().and_then(|_|file.sync_all()).map_err(|_|"Could not verify saved export")?;drop(file);
  std::fs::hard_link(&self.temporary,&self.target).map_err(|_|"Could not save under that name. Choose a new filename on a local filesystem.")?;
  Ok(()) // Drop removes only our temporary hard link.
 }
}
#[tauri::command]
pub async fn file_export_begin(app:AppHandle,window:WebviewWindow,name:String)->Result<Option<String>,String>{
 authorize(&window)?;
 if name.len()>180||name.chars().any(|c|c=='/'||c=='\\'||c.is_control())||!(name.ends_with(".vibexdir")||name.ends_with(".mp4")){return Err("Choose an archive or video filename".into());}
 tauri::async_runtime::spawn_blocking(move||{
  let Some(choice)=app.dialog().file().set_title("Save your VibeX export — choose a new filename").set_file_name(&name).blocking_save_file() else{return Ok(None);};
  let target=choice.into_path().map_err(|_|"Choose a local or mounted folder")?;
  let state=app.state::<FileExports>();let mut sessions=state.0.lock().map_err(|_|"Export state unavailable")?;
  if sessions.len()>=2{return Err("Finish another export before starting this one".into());}
  let id=identity()?;let session=Session::create(target,&id)?;sessions.insert(id.clone(),session);Ok(Some(id))
 }).await.map_err(|_|"Export destination selection failed")?
}
#[tauri::command]
pub async fn file_export_write(app:AppHandle,window:WebviewWindow,id:String,sequence:u64,bytes:Vec<u8>)->Result<(),String>{
 authorize(&window)?;
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<FileExports>();let mut sessions=state.0.lock().map_err(|_|"Export state unavailable")?;
  let result=sessions.get_mut(&id).ok_or("Export is unavailable")?.write(sequence,bytes);
  if result.is_err(){sessions.remove(&id);}result
 }).await.map_err(|_|"Export write failed")?
}
#[tauri::command]
pub async fn file_export_finish(app:AppHandle,window:WebviewWindow,id:String)->Result<(),String>{
 authorize(&window)?;
 tauri::async_runtime::spawn_blocking(move||{
  let state=app.state::<FileExports>();let session=state.0.lock().map_err(|_|"Export state unavailable")?.remove(&id).ok_or("Export is unavailable")?;session.finish()
 }).await.map_err(|_|"Export finish failed")?
}
#[tauri::command]
pub async fn file_export_abort(app:AppHandle,window:WebviewWindow,id:String)->Result<(),String>{
 authorize(&window)?;let state=app.state::<FileExports>();state.0.lock().map_err(|_|"Export state unavailable")?.remove(&id);Ok(())
}
#[cfg(test)]
mod tests {
 use super::*;
 #[test]fn publishes_exact_bytes_and_never_overwrites(){
  let dir=std::env::temp_dir().join(identity().unwrap());std::fs::create_dir(&dir).unwrap();let target=dir.join("test.vibexdir");
  let mut session=Session::create(target.clone(),"test").unwrap();session.write(0,vec![1,2,3]).unwrap();session.write(0,vec![1,2,3]).unwrap();session.write(1,vec![4]).unwrap();session.finish().unwrap();
  assert_eq!(std::fs::read(&target).unwrap(),vec![1,2,3,4]);assert!(Session::create(target.clone(),"other").is_err());assert_eq!(std::fs::read_dir(&dir).unwrap().count(),1);std::fs::remove_dir_all(dir).unwrap();
 }
 #[test]fn abort_and_publish_collision_preserve_existing_files(){
  let dir=std::env::temp_dir().join(identity().unwrap());std::fs::create_dir(&dir).unwrap();let target=dir.join("test.mp4");
  {let mut session=Session::create(target.clone(),"abort").unwrap();assert!(session.write(2,vec![1]).is_err());}
  assert_eq!(std::fs::read_dir(&dir).unwrap().count(),0);
  let mut session=Session::create(target.clone(),"race").unwrap();session.write(0,vec![2]).unwrap();std::fs::write(&target,b"original").unwrap();assert!(session.finish().is_err());assert_eq!(std::fs::read(&target).unwrap(),b"original");assert_eq!(std::fs::read_dir(&dir).unwrap().count(),1);std::fs::remove_dir_all(dir).unwrap();
 }
}
