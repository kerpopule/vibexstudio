use std::{io::{Read,Write},net::{TcpStream,SocketAddr},time::Duration};
use serde_json::{Value,json};
use tauri::{AppHandle,WebviewWindow};

fn authorized(label:&str,url:&tauri::Url)->bool{
 let local=(url.scheme()=="vxpair"&&url.host_str()==Some("localhost"))||(cfg!(windows)&&url.scheme()=="http"&&url.host_str()==Some("vxpair.localhost"));
 label=="pair"&&local&&url.path()=="/"&&url.port().is_none()&&url.username().is_empty()&&url.password().is_none()
}
fn request(app:&AppHandle,route:&str,body:Option<Value>)->Result<Value,String>{
 let cfg=super::workbench_config(app).filter(|v|v["enabled"].as_bool()==Some(true)).ok_or("Enable this computer's build server first.")?;
 let port=cfg["port"].as_u64().unwrap_or(super::WORKBENCH_PORT as u64);
 if port==0||port>65535{return Err("Invalid build server port.".into());}
 let token=cfg["token"].as_str().filter(|s|!s.is_empty()&&s.len()<4096&&!s.chars().any(char::is_control)).ok_or("The build server needs a valid pairing credential.")?;
 loopback_request(port as u16,token,route,body)
}
fn loopback_request(port:u16,token:&str,route:&str,body:Option<Value>)->Result<Value,String>{
 let timeout=Duration::from_secs(5);
 let address=SocketAddr::from(([127,0,0,1],port));
 let mut stream=TcpStream::connect_timeout(&address,timeout).map_err(|_|"Start your build server, then try again.")?;
 stream.set_read_timeout(Some(timeout)).map_err(|_|"Cannot configure pairing connection.")?;
 stream.set_write_timeout(Some(timeout)).map_err(|_|"Cannot configure pairing connection.")?;
 let method=if body.is_some(){"POST"}else{"GET"};let body=body.map(|v|v.to_string()).unwrap_or_default();
 let message=format!("{method} {route} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Workbench-Token: {token}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",body.len());
 stream.write_all(message.as_bytes()).map_err(|_|"Cannot contact your build server.")?;
 let mut response=String::new();stream.take(65537).read_to_string(&mut response).map_err(|_|"Your build server did not answer in time.")?;
 if response.len()>65536{return Err("Unexpected pairing response.".into());}
 let (headers,body)=response.split_once("\r\n\r\n").ok_or("Invalid pairing response.")?;
 if !headers.lines().next().unwrap_or("").starts_with("HTTP/1.1 200 "){return Err("Pairing request failed. Restart or update your build server and try again.".into());}
 serde_json::from_str(body).map_err(|_|"Invalid pairing response.".into())
}
fn tailnet_address(status:&Value)->Result<String,String>{
 if status["BackendState"].as_str()!=Some("Running"){return Err("Sign into Tailscale on this computer first.".into());}
 status["Self"]["TailscaleIPs"].as_array().into_iter().flatten().filter_map(|value|value.as_str()).find(|text|{
  text.parse::<std::net::Ipv4Addr>().map(|ip|{let octets=ip.octets();octets[0]==100&&(64..=127).contains(&octets[1])}).unwrap_or(false)
 }).map(str::to_owned).ok_or_else(||"This computer has no usable Tailscale address. Check that Tailscale is connected.".into())
}
#[tauri::command]
pub async fn device_pairing_manage(app:AppHandle,window:WebviewWindow,operation:String,device_id:Option<String>,network:Option<String>)->Result<Value,String>{
 if !authorized(window.label(),&window.url().map_err(|_|"Cannot verify pairing window.")?){return Err("Use the desktop pairing window to manage devices.".into());}
 tauri::async_runtime::spawn_blocking(move||match operation.as_str(){
  "issue"=>{
   let cfg=super::workbench_config(&app).filter(|v|v["enabled"].as_bool()==Some(true));
   let ml=super::medialab_config(&app);
   let media_port=ml.as_ref().filter(|v|v["enabled"].as_bool()==Some(true)&&v["runtime"].as_str()!=Some("independent-studio")).map(|v|v["port"].as_u64().unwrap_or(super::MEDIALAB_PORT as u64));
   let ip=match network.as_deref().unwrap_or("local"){
    "local"=>local_ip_address::local_ip().map_err(|_|"Connect this computer to your network first.")?.to_string(),
    "tailscale"=>tailnet_address(&super::read_tailscale_status()?)?,
    _=>return Err("Choose the same network or Tailscale.".into())
   };
   let invite=if cfg.is_some(){Some(request(&app,"/pairing/invites",Some(json!({})))?)}else{None};
   let workbench=if let Some(ref value)=invite{
    let code=value["code"].as_str().filter(|v|v.len()==43&&v.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_')).ok_or("Invalid invitation response.")?;
    Some((cfg.as_ref().unwrap()["port"].as_u64().unwrap_or(super::WORKBENCH_PORT as u64),code))
   }else{None};
   let link=super::build_pair_link(&ip,media_port,workbench).ok_or("Enable a build server or network-accessible Media Lab first.")?;
   let svg=qrcode::QrCode::new(link.as_bytes()).map_err(|_|"Cannot create QR code.")?.render::<qrcode::render::svg::Color>().min_dimensions(240,240).build();
   Ok(json!({"link":link,"svg":svg,"expiresAt":invite.as_ref().map(|v|v["expiresAt"].clone()),"deviceManagement":cfg.is_some()}))
  },
  "list"=>request(&app,"/pairing/devices",None),
  "revoke"=>{
   let id=device_id.filter(|v|v.len()==36&&v.bytes().all(|b|b.is_ascii_hexdigit()||b==b'-')).ok_or("Choose a valid device.")?;
   request(&app,"/pairing/revoke",Some(json!({"deviceId":id})))
  },
  _=>Err("Unknown device operation.".into())
 }).await.map_err(|_|"Device management failed.")?
}
#[cfg(test)]
mod tests{
 #[test]fn uses_only_this_computers_valid_tailnet_address(){
  use super::*;
  let value=json!({"BackendState":"Running","Self":{"TailscaleIPs":["192.168.1.2","100.64.1.2"]},"Peer":{"other":{"TailscaleIPs":["100.70.1.1"]}}});
  assert_eq!(tailnet_address(&value).unwrap(),"100.64.1.2");
  for value in [json!({"BackendState":"Stopped","Self":{"TailscaleIPs":["100.64.1.2"]}}),json!({"BackendState":"Running","Self":{"TailscaleIPs":["100.2.3.4","100.999.1.2","100.64.1.2:9999"]}})]{assert!(tailnet_address(&value).is_err());}
 }
 #[test]fn only_pair_window_can_manage_devices(){
  use super::*;
  assert!(authorized("pair",&tauri::Url::parse("vxpair://localhost/").unwrap()));
  for (label,url) in [("main","vxpair://localhost/"),("pair","https://localhost/"),("pair","vxpair://attacker/"),("pair","vxpair://localhost/welcome"),("pair","vxpair://localhost:99/")]{assert!(!authorized(label,&tauri::Url::parse(url).unwrap()));}
 }
}
