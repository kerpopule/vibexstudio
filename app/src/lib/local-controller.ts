type Invoke = (command:string, args?: Record<string, unknown>)=>Promise<unknown>;
function bridge():Invoke|undefined {
  const value=(globalThis as unknown as {__TAURI_INTERNALS__?:{invoke?:Invoke}}).__TAURI_INTERNALS__?.invoke;
  return typeof value==='function'?value:undefined;
}
export function canUseLocalController():boolean {return Boolean(bridge());}
/** Pairing material stays in memory; never put the access code in a URL or log. */
export async function localControllerConnection():Promise<{url:string;code:string}> {
  const invoke=bridge();
  if(!invoke)throw new Error('This action requires the desktop app.');
  const result=await invoke('medialab_local_connection') as {url?:unknown;code?:unknown}|null;
  if(!result||typeof result.url!=='string'||!/^http:\/\/127\.0\.0\.1:\d+$/.test(result.url)
    ||typeof result.code!=='string'||!/^[a-f0-9]{64}$/i.test(result.code)) {
    throw new Error('The desktop returned an invalid local connection.');
  }
  const port=Number(result.url.split(':').at(-1));
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('The desktop returned an invalid local connection.');
  return {url:result.url,code:result.code};
}

export interface TailnetDevice { name: string; address: string; online: boolean; }
export async function discoverTailnetMediaServices(address:string):Promise<string[]>{
  const invoke=bridge();
  if(!invoke)throw new Error('Service discovery needs the installed desktop app. Enter your full server link instead.');
  const result=await invoke('tailscale_media_services',{address});
  if(!Array.isArray(result)||result.length>4)throw new Error('Invalid Media Lab service list.');
  return result.map(value=>{
    if(typeof value!=='string')throw new Error('Invalid Media Lab address.');
    const url=new URL(value);
    if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||url.pathname!=='/'||url.origin!==value)throw new Error('Invalid Media Lab address.');
    return value;
  });
}
export async function discoverTailnetDevices(): Promise<TailnetDevice[]> {
  const invoke = bridge();
  if (!invoke) throw new Error('Device discovery needs the installed desktop app. You can still enter your server address here.');
  const result = await invoke('tailscale_devices');
  if (!Array.isArray(result)) throw new Error('Invalid device list.');
  return result.filter((item): item is TailnetDevice => {
    if (!item || typeof item.name !== 'string' || typeof item.address !== 'string' || typeof item.online !== 'boolean') return false;
    const parts: number[] = item.address.split('.').map(Number);
    return parts.length === 4 && parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  });
}

export async function installLocalController(resume: boolean): Promise<void> {
  const invoke = bridge();
  if (!invoke) throw new Error('Local installation requires the desktop app.');
  await invoke('install_bundled_controller', { resume });
}
export async function startLocalController(): Promise<void> {
  const invoke = bridge();
  if (!invoke) throw new Error('Starting a local controller requires the desktop app.');
  await invoke('medialab_enable');
}

/** Only expose setup flags; pairing material is retrieved separately. */
export async function localControllerStatus(): Promise<{configured:boolean; independent:boolean; running:boolean; installationAvailable?:boolean; installationMessage?:string}> {
  const invoke = bridge();
  if (!invoke) throw new Error('Local setup requires the desktop app.');
  const result = await invoke('medialab_status') as Record<string, unknown> | null;
  if (!result || typeof result.configured !== 'boolean' || typeof result.independent !== 'boolean' || typeof result.running !== 'boolean') {
    throw new Error('Could not read local setup. Update the desktop app or use its Media Lab menu.');
  }
  return {configured: result.configured, independent: result.independent, running: result.running,
    ...(typeof result.installationAvailable === 'boolean' ? {installationAvailable:result.installationAvailable} : {}),
    ...(typeof result.installationMessage === 'string' ? {installationMessage:result.installationMessage} : {})};
}
