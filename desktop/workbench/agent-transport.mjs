/** Local HTTP transport only. Authorization and project access remain in Studio. */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

export function createAgentTransport(dispatch, {timeoutMs = 95_000, maxPending = 16} = {}) {
  const pending = new Map();
  const server = http.createServer({maxHeaderSize:16*1024}, (request,response) => {
    const send = (status,body) => {
      if (response.destroyed || response.writableEnded) return;
      response.writeHead(status, {'Content-Type':'application/json','Cache-Control':'no-store','Connection':'close'});
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (request.headers.origin) { send(403,{error:'Browser origins are not allowed'}); return; }
    if (request.method !== 'POST' || !['/pair','/mcp'].includes(request.url)) { send(404,{error:'Unknown endpoint'}); return; }
    if (pending.size >= maxPending) { send(429,{error:'Too many pending requests'}); return; }
    const length = Number(request.headers['content-length']);
    if (Number.isFinite(length) && length > 256*1024) {send(413,{error:'Request too large'});return;}
    const id=randomUUID(); let bytes=0; const chunks=[];
    const timer=setTimeout(()=>{send(504,{error:'Studio did not respond in time'}); cleanup();},timeoutMs);
    const cleanup=()=>{clearTimeout(timer);pending.delete(id);};
    pending.set(id, (result)=>{
      if (!result || !Number.isInteger(result.status) || result.status<200 || result.status>599 || typeof result.body!=='string' || Buffer.byteLength(result.body)>2*1024*1024) {
        send(502,{error:'Invalid Studio response'});
      } else send(result.status,result.body);
      cleanup();
    });
    response.on('close',cleanup);
    request.on('error',()=>{send(400,{error:'Incomplete request'});cleanup();});
    request.on('data',(chunk)=>{
      bytes+=chunk.length;
      if(bytes>256*1024){send(413,{error:'Request too large'});cleanup();request.resume();return;}
      if(pending.has(id))chunks.push(chunk);
    });
    request.on('end',()=>{
      if(!pending.has(id))return;
      // Headers with credentials travel only on the owned IPC pipe, never logs.
      try { dispatch({id,request:{method:request.method,path:request.url,headers:request.headers,body:Buffer.concat(chunks).toString('utf8'),remoteAddress:request.socket.remoteAddress??'unknown'}}); }
      catch {send(503,{error:'Studio unavailable'});cleanup();}
    });
  });
  server.headersTimeout=10_000;server.requestTimeout=15_000;
  return {
    server,
    reply(id,response){const callback=pending.get(id);if(callback)callback(response);},
    close(){for(const reply of [...pending.values()])reply({status:503,body:'{"error":"Studio disconnected"}'});server.close();server.closeAllConnections();},
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Only the desktop parent launches this entry point. No public binding here.
  const args=process.argv.slice(2);
  if(args.length && (args.length!==2 || args[0]!=='--port' || !/^\d+$/.test(args[1]) || Number(args[1])>65535)){
    process.stderr.write('Invalid agent port\n');process.exit(1);
  }
  const port=args.length?Number(args[1]):0;
  const transport=createAgentTransport((message)=>process.stdout.write(JSON.stringify({type:'request',...message})+'\n'));
  const input=createInterface({input:process.stdin,crlfDelay:Infinity});
  input.on('line',(line)=>{
    if(Buffer.byteLength(line)>3*1024*1024){transport.close();input.close();return;}
    try {const message=JSON.parse(line);transport.reply(message.id,message.response);}catch { /* Invalid parent messages never become agent responses. */ }
  });
  input.on('close',()=>transport.close());
  transport.server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({type:'ready',port:transport.server.address().port})+'\n'));
  transport.server.on('error',()=>{process.stderr.write('Agent transport could not listen\n');process.exitCode=1;input.close();});
}
