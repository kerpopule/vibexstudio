import {libraryOrigin} from '@/lib/library-core';
import {getGenerationConnection,getLibraryToken} from '@/lib/storage/secrets';
import type {DirectorProjectContext} from '@/lib/director-project-context';

export type DirectorMessage = {role:'user'|'assistant';content:string};

export async function askDirector(server: string, messages: DirectorMessage[], project?: DirectorProjectContext,
  signal?: AbortSignal, includeLibrary=false,includeCollections=false): Promise<string> {
  const origin = libraryOrigin(server);
  const recent=messages.map(message=>({...message,content:message.content.slice(0,4000)})).slice(-20);
  let body=JSON.stringify({messages:recent,selected_project:project,...(includeLibrary?{include_library:true}:{}),...(includeCollections?{include_collections:true}:{})});
  while(new TextEncoder().encode(body).length>65536 && recent.length>1){
    recent.shift();
    body=JSON.stringify({messages:recent,selected_project:project,...(includeLibrary?{include_library:true}:{}),...(includeCollections?{include_collections:true}:{})});
  }
  if(new TextEncoder().encode(body).length>65536)throw new Error('Choose fewer project assets or write a shorter message.');
  const raw = await getGenerationConnection(origin);
  let token: unknown;
  try {token=raw ? JSON.parse(raw).token : null;} catch { /* reconnect unreadable credentials */ }
  if (typeof token !== 'string' || !token.startsWith('mlab-render-v1.')) throw new Error('Connect this device to Media Lab to talk with Sparky.');
  const libraryToken=(includeLibrary||includeCollections)?await getLibraryToken(origin):null;
  if((includeLibrary||includeCollections) && (!libraryToken || !libraryToken.startsWith('mlab-library-v1.')))throw new Error('Connect Library access in Media Lab before including recent creations.');
  const controller=new AbortController();
  const cancel=()=>controller.abort();
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true});
  const timer=setTimeout(cancel,60_000);
  try {
    const response=await fetch(origin+'/api/studio/director', {method:'POST',credentials:'omit',redirect:'error',
      signal:controller.signal,headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json',...(libraryToken?{'X-Library-Authorization':'Bearer '+libraryToken}:{})},
      body});
    if (!response.ok) throw new Error(response.status===401 || response.status===403 ? 'Reconnect Media Lab to talk with Sparky.' :
      response.status===404 || response.status===503 ? 'Sparky is not available on this host yet. Your message is still here.' :
      response.status===429 ? 'Sparky is busy. Try again shortly.' : 'Sparky could not use this conversation. Try a shorter message.');
    const result=await response.json();
    if(result.version!==1 || typeof result.message!=='string' || !result.message.trim() || result.message.length>16000 ||
       !Array.isArray(result.actions) || result.actions.length) throw new Error('This host returned an unsupported director reply.');
    return result.message;
  } catch(error) {
    if(controller.signal.aborted)throw new Error('The conversation was interrupted. Your message is still here.');
    if(error instanceof TypeError)throw new Error('Could not reach Sparky. Check your Media Lab connection.');
    throw error;
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);}
}
