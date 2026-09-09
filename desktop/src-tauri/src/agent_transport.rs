//! Owned, in-memory IPC for the desktop agent transport. No project storage here.
use std::{collections::VecDeque, io::{BufRead, BufReader, Read, Write}, process::{Child, ChildStdin, Command, Stdio}, sync::{Arc, Mutex, mpsc}, time::Duration};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};

struct Process {
    child: Child,
    input: ChildStdin,
    queue: Arc<Mutex<VecDeque<Value>>>,
    port: u16,
}
impl Drop for Process {
    fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); }
}
#[derive(Default)]
pub struct AgentTransport(Mutex<Option<Process>>);
impl AgentTransport {
    pub fn stop(&self) { self.0.lock().unwrap().take(); }
}
fn authorize(window: &WebviewWindow) -> Result<(), String> {
    let url=window.url().map_err(|_| "Cannot verify Studio window")?;
    let local=(url.scheme()=="tauri" && url.host_str()==Some("localhost")) ||
        (cfg!(windows) && url.scheme()=="http" && url.host_str()==Some("tauri.localhost"));
    if window.label()!="main" || !local || url.port().is_some() || !url.username().is_empty() || url.password().is_some() {
        return Err("Agent transport requires the packaged Studio window".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn agent_transport_start(app:AppHandle,window:WebviewWindow)->Result<Value,String>{
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AgentTransport>();
        let mut slot=state.0.lock().unwrap();
        if let Some(process)=slot.as_mut() {
            if process.child.try_wait().map_err(|_| "Cannot inspect agent transport")?.is_none() {return Ok(json!({"port":process.port}));}
        }
        slot.take();
        let node=super::find_node(&None).ok_or("Install Node.js to connect a desktop agent")?;
        let script=app.path().resource_dir().map_err(|_| "Cannot locate app resources")?.join("workbench/agent-transport.mjs");
        if !script.is_file(){return Err("This build is missing the desktop agent transport".into());}
        let config_dir=app.path().app_data_dir().map_err(|_| "Cannot locate agent configuration")?;
        std::fs::create_dir_all(&config_dir).map_err(|_| "Cannot create agent configuration directory")?;
        let port_file=config_dir.join("agent-transport.json");
        let saved_port=if port_file.exists() {
            let raw=std::fs::read(&port_file).map_err(|_| "Cannot read saved agent port")?;
            let value:Value=serde_json::from_slice(&raw).map_err(|_| "Invalid saved agent port")?;
            Some(value["port"].as_u64().filter(|port| *port>0 && *port<=65535).ok_or("Invalid saved agent port")? as u16)
        } else {None};
        let mut child=Command::new(node).arg(script).arg("--port").arg(saved_port.unwrap_or(0).to_string()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| "Cannot start agent transport")?;
        let input=child.stdin.take().ok_or("Cannot open agent input")?;
        let output=child.stdout.take().ok_or("Cannot open agent output")?;
        let queue=Arc::new(Mutex::new(VecDeque::new()));
        let reader_queue=queue.clone();
        let (ready_tx,ready_rx)=mpsc::sync_channel(1);
        std::thread::spawn(move || {
            let mut reader=BufReader::new(output);
            let mut first=true;
            loop {
                let mut line=Vec::new();
                // Take bounds allocations even if a faulty child omits a newline.
                if reader.by_ref().take(2*1024*1024+1).read_until(b'\n',&mut line).unwrap_or(0)==0 {break;}
                if line.len()>2*1024*1024 || line.last()!=Some(&b'\n'){break;}
                let Ok(message)=serde_json::from_slice::<Value>(&line) else {break;};
                if first {
                    first=false;
                    if message["type"]!="ready" {break;}
                    let _=ready_tx.send(message["port"].as_u64().filter(|p| *p>0 && *p<=65535).map(|p|p as u16));
                } else if message["type"]=="request" {
                    let mut queue=reader_queue.lock().unwrap();
                    if queue.len()>=16 {break;}
                    queue.push_back(message);
                }
            }
        });
        let port=match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Some(port))=>port,
            _=>{let _=child.kill();let _=child.wait();return Err("Agent transport did not become ready".into());}
        };
        let process=Process{child,input,queue,port};
        if saved_port.is_none() {
            let temporary=config_dir.join("agent-transport.json.tmp");
            std::fs::write(&temporary,serde_json::to_vec(&json!({"port":port})).unwrap()).map_err(|_| "Cannot save agent port")?;
            std::fs::rename(&temporary,&port_file).map_err(|_| "Cannot preserve agent port for reconnection")?;
        }
        *slot=Some(process);
        Ok(json!({"port":port}))
    }).await.map_err(|_| "Agent transport startup failed")?
}
#[tauri::command]
pub fn agent_transport_poll(window:WebviewWindow,state:State<AgentTransport>)->Result<Value,String>{
    authorize(&window)?;
    let mut slot=state.0.lock().unwrap();
    let process=slot.as_mut().ok_or("Agent transport is stopped")?;
    if process.child.try_wait().map_err(|_| "Cannot inspect agent transport")?.is_some(){return Err("Agent transport exited".into());}
    let requests:Vec<Value>=process.queue.lock().unwrap().drain(..).collect();
    Ok(json!({"requests":requests}))
}
#[tauri::command]
pub async fn agent_transport_reply(app:AppHandle,window:WebviewWindow,id:String,response:Value)->Result<(),String>{
    authorize(&window)?;
    if id.len()!=36 || !id.bytes().all(|b|b.is_ascii_hexdigit()||b==b'-'){return Err("Invalid request identifier".into());}
    let line=serde_json::to_string(&json!({"id":id,"response":response})).map_err(|_| "Invalid agent response")?;
    if line.len()>3*1024*1024 {return Err("Agent response exceeds limit".into());}
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<AgentTransport>();let mut slot=state.0.lock().unwrap();
        let process=slot.as_mut().ok_or("Agent transport is stopped")?;
        writeln!(process.input,"{}",line).map_err(|_| "Cannot deliver agent response".to_string())
    }).await.map_err(|_| "Agent response task failed")?
}
#[tauri::command]
pub async fn agent_transport_stop(app:AppHandle,window:WebviewWindow)->Result<(),String>{
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        // Hold the remote lock through local shutdown to exclude concurrent starts.
        let remote=app.state::<RemoteAgent>();
        let mut remote_slot=remote.0.lock().unwrap();
        remote_slot.take();
        app.state::<AgentTransport>().stop();
    }).await.map_err(|_| "Agent transport shutdown failed".to_string())
}

#[tauri::command]
pub async fn agent_device_identity(app:AppHandle,window:WebviewWindow)->Result<Value,String>{
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let node=super::find_node(&None).ok_or("Install Node.js to prepare remote agent access")?;
        let resource=app.path().resource_dir().map_err(|_| "Cannot locate enrollment resources")?.join("workbench/agent-enroll.mjs");
        if !resource.is_file(){return Err("This build is missing remote enrollment resources".into());}
        let data=app.path().app_data_dir().map_err(|_| "Cannot locate app data")?;
        std::fs::create_dir_all(&data).map_err(|_| "Cannot create app data directory")?;
        let output=Command::new(node).arg(resource).arg("--directory").arg(data.join("remote-agent-identity"))
            .stdin(Stdio::null()).stderr(Stdio::null()).output().map_err(|_| "Cannot run device enrollment")?;
        if !output.status.success(){return Err("Device identity setup failed. Existing files were preserved; this currently requires macOS or Linux with OpenSSH".into());}
        if output.stdout.len()>4096{return Err("Invalid device enrollment response".into());}
        let value:Value=serde_json::from_slice(&output.stdout).map_err(|_| "Invalid device enrollment response")?;
        let key=value["publicKey"].as_str().filter(|key|key.starts_with("ssh-ed25519 ")&&key.len()<128&&!key.contains('\n')).ok_or("Invalid device public key")?;
        Ok(json!({"publicKey":key}))
    }).await.map_err(|_| "Device enrollment task failed")?
}

struct RemoteProcess {
    child: Child,
    input: Option<ChildStdin>,
    status: Arc<Mutex<Value>>,
}
impl Drop for RemoteProcess {
    fn drop(&mut self) {
        self.input.take(); // EOF asks the worker to stop SSH and remove connection files.
        let started=std::time::Instant::now();
        while started.elapsed()<Duration::from_secs(7) {
            if self.child.try_wait().ok().flatten().is_some(){break;}
            std::thread::sleep(Duration::from_millis(50));
        }
        #[cfg(unix)]
        unsafe { libc::kill(-(self.child.id() as i32),libc::SIGKILL); }
        #[cfg(windows)]
        { let _=Command::new("taskkill").args(["/T","/F","/PID",&self.child.id().to_string()]).stdout(Stdio::null()).stderr(Stdio::null()).status(); }
        let _=self.child.kill();let _=self.child.wait();
    }
}
#[derive(Default)]
pub struct RemoteAgent(Mutex<Option<RemoteProcess>>);
impl RemoteAgent {pub fn stop(&self){self.0.lock().unwrap().take();}}

#[tauri::command]
pub async fn agent_remote_start(app:AppHandle,window:WebviewWindow,enrollment:Value)->Result<Value,String>{
    authorize(&window)?;
    let encoded=serde_json::to_string(&enrollment).map_err(|_| "Invalid server enrollment")?;
    if encoded.len()>16300{return Err("Server enrollment exceeds size limit".into());}
    tauri::async_runtime::spawn_blocking(move || {
        let remote=app.state::<RemoteAgent>();let mut slot=remote.0.lock().unwrap();
        if slot.is_some(){return Err("Stop the existing remote connection before starting another".into());}
        let local=app.state::<AgentTransport>();
        let port={let mut local_slot=local.0.lock().unwrap();let process=local_slot.as_mut().ok_or("Start Agent Connect first")?;
            if process.child.try_wait().map_err(|_| "Cannot inspect local agent transport")?.is_some(){return Err("Local agent transport is stopped".into());}process.port};
        let node=super::find_node(&None).ok_or("Install Node.js to connect a remote agent")?;
        let script=app.path().resource_dir().map_err(|_| "Cannot locate remote worker")?.join("workbench/agent-remote-worker.mjs");
        if !script.is_file(){return Err("This build is missing remote connection resources".into());}
        let directory=app.path().app_data_dir().map_err(|_| "Cannot locate device identity")?.join("remote-agent-identity");
        let mut command=Command::new(node);
        command.arg(script).arg("--directory").arg(directory).arg("--local-port").arg(port.to_string()).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(unix)]
        {use std::os::unix::process::CommandExt;command.process_group(0);}
        let mut child=command.spawn().map_err(|_| "Cannot start remote worker")?;
        let input=child.stdin.take().ok_or("Cannot open remote worker input")?;
        let output=child.stdout.take().ok_or("Cannot open remote worker status")?;
        let status=Arc::new(Mutex::new(json!({"phase":"starting","verified":false})));
        let mut process=RemoteProcess{child,input:Some(input),status:status.clone()};
        writeln!(process.input.as_mut().unwrap(),"{}",encoded).map_err(|_| "Cannot send server enrollment")?;
        std::thread::spawn(move || {
            let mut reader=BufReader::new(output);
            loop {
                let mut line=Vec::new();
                if reader.by_ref().take(4097).read_until(b'\n',&mut line).unwrap_or(0)==0{break;}
                if line.len()>4096 || line.last()!=Some(&b'\n'){break;}
                if let Ok(value)=serde_json::from_slice::<Value>(&line){*status.lock().unwrap()=value;}
            }
        });
        *slot=Some(process);Ok(json!({"phase":"starting","verified":false}))
    }).await.map_err(|_| "Remote connection task failed")?
}
#[tauri::command]
pub async fn agent_remote_status(app:AppHandle,window:WebviewWindow)->Result<Value,String>{
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state=app.state::<RemoteAgent>();let mut slot=state.0.lock().unwrap();
        let Some(process)=slot.as_mut() else{return Ok(json!({"phase":"stopped","verified":false}));};
        if process.child.try_wait().map_err(|_| "Cannot inspect remote worker")?.is_some(){return Ok(json!({"phase":"failed","verified":false}));}
        let result=process.status.lock().unwrap().clone();Ok(result)
    }).await.map_err(|_| "Remote status task failed")?
}
#[tauri::command]
pub async fn agent_remote_stop(app:AppHandle,window:WebviewWindow)->Result<(),String>{
    authorize(&window)?;
    tauri::async_runtime::spawn_blocking(move || app.state::<RemoteAgent>().stop()).await.map_err(|_| "Remote shutdown task failed".to_string())
}

#[cfg(all(test, unix))]
mod remote_process_tests {
    use super::*;
    use std::os::unix::process::CommandExt;

    #[test]
    fn crashed_worker_cleanup_closes_descendant_pipe() {
        let mut command=Command::new("/bin/sh");
        command.args(["-c", "sleep 60 & echo ready; wait"])
            .process_group(0).stdin(Stdio::piped()).stdout(Stdio::piped());
        let mut child=command.spawn().unwrap();
        let input=child.stdin.take();
        let mut output=BufReader::new(child.stdout.take().unwrap());
        let mut ready=String::new();
        output.read_line(&mut ready).unwrap();
        assert_eq!(ready.trim(),"ready");
        child.kill().unwrap();
        child.wait().unwrap();
        let process=RemoteProcess {child,input,status:Arc::new(Mutex::new(json!({})))};
        let (tx,rx)=mpsc::channel();
        std::thread::spawn(move || {
            let mut rest=Vec::new();
            let _=tx.send(output.read_to_end(&mut rest).is_ok());
        });
        drop(process);
        assert_eq!(rx.recv_timeout(Duration::from_secs(3)).unwrap(),true,
            "SSH-like descendant must not outlive its crashed worker");
    }
}
