import {create} from 'zustand';
import {generateFalSong} from '@/lib/ai/media';
import {forgetFalRequest,getFalRequest,listFalRequests,type FalRecovery,type FalSongOptions,validateFalSongOptions} from '@/lib/ai/fal-recovery';
import {downloadSong} from '@/lib/audio-file';
import {readGalleryItem,saveGalleryAudio} from '@/lib/storage/media-gallery';
import {getProviderSecret} from '@/lib/storage/secrets';
import {newId} from '@/lib/storage/projects';
import {useApp} from '@/lib/store';

type Job={songOptions?:FalSongOptions;id:string;providerId:string;providerLabel:string;prompt:string;status:'running'|'error';review:boolean;error?:string};
interface State{jobs:Job[];savedId:string|null;hydrate:()=>Promise<void>;start:(providerId:string,prompt:string,songOptions?:FalSongOptions)=>Promise<void>;resume:(id:string)=>Promise<void>;dismiss:(id:string)=>Promise<void>}
export const useSongStudio=create<State>((set,get)=>{
 let hydration:Promise<void>|null=null;
 let starting=false;
 const run=async(job:Job)=>{
  if(get().jobs.some(row=>row.id===job.id&&row.status==='running'))return;
  set(state=>({savedId:null,jobs:[...state.jobs.filter(row=>row.id!==job.id),{...job,status:'running',error:undefined}]}));
  try{
   let item=await readGalleryItem('fal-'+job.id);
   if(!item){
    const provider=useApp.getState().providers.find(row=>row.id===job.providerId&&row.kind==='fal'&&row.auth==='apiKey');
    if(!provider)throw new Error('The original fal connection is unavailable. Restore that connection to resume this job.');
    const secret=await getProviderSecret(provider.id);
    if(!secret)throw new Error('Replace the key for this fal connection in Setup, then resume this job.');
    if(!useApp.getState().providers.some(row=>row.id===provider.id))throw new Error('The fal connection was removed while reading its key.');
    const audio=await generateFalSong(provider,secret,job.prompt,job.id,job.songOptions);
    const base64=await downloadSong(audio.url);
    item=await saveGalleryAudio(job.prompt,job.providerLabel,base64,audio.mimeType,job.id);
   }
   await forgetFalRequest(job.id);
   set(state=>({jobs:state.jobs.filter(row=>row.id!==job.id),savedId:item.id}));
  }catch(error){
   let record:FalRecovery|null=null;
   try{record=await getFalRequest(job.id);}catch{/* Retain a conservative review action when tracking cannot be read. */}
   const review=record?.phase==='submitting';
   set(state=>({jobs:state.jobs.map(row=>row.id===job.id?{...row,status:'error',review,error:error instanceof Error?error.message:'The song could not be saved. Resume this job to try again.'}:row)}));
  }
 };
 return {jobs:[],savedId:null,
  hydrate:async()=>{
   if(hydration)return hydration;
   hydration=(async()=>{
    const records=(await listFalRequests()).filter(row=>row.kind==='audio'&&!row.projectId);
    set(state=>({jobs:[...state.jobs,...records.filter(row=>!state.jobs.some(job=>job.id===row.id)).map(row=>({id:row.id,providerId:row.providerId,providerLabel:row.providerLabel,prompt:row.prompt,songOptions:row.songOptions,status:'error' as const,review:row.phase==='submitting',error:row.phase==='submitting'?'Submission may have been accepted. Check fal.ai before starting another song.':'This saved song request is ready to resume.'}))]}));
   })();try{await hydration;}finally{hydration=null;}
  },
  start:async(providerId,prompt,songOptions)=>{
   if(starting||get().jobs.some(job=>job.status==='running'))throw new Error('Wait for the current song or resume it before starting another.');
   starting=true;
   try{
    if(songOptions!==undefined)songOptions=validateFalSongOptions(songOptions);
    const text=prompt.trim();
    if(!text||text.length>8000)throw new Error('Describe your song in 1–8,000 characters.');
    // A reopened screen may not have loaded accepted/uncertain requests yet.
    // Failure to read tracking must not turn into another potentially paid POST.
    try{await get().hydrate();}catch{throw new Error('Saved song requests could not be checked. Try again before starting a new song.');}
    if(get().jobs.some(job=>job.status==='running'))throw new Error('Wait for the current song or resume it before starting another.');
    const provider=useApp.getState().providers.find(row=>row.id===providerId&&row.kind==='fal'&&row.auth==='apiKey');
    if(!provider)throw new Error('Connect your fal.ai API key first.');
    if(get().jobs.some(job=>job.providerId===providerId&&job.prompt===text))throw new Error('This song already has a saved request. Resume it or check fal.ai below before starting another.');
    await run({songOptions,id:newId(),providerId,providerLabel:provider.label,prompt:text,status:'error',review:false});
   }finally{starting=false;}
  },
  resume:async(id)=>{const job=get().jobs.find(row=>row.id===id);if(job&&!job.review)await run(job);},
  dismiss:async(id)=>{
   const job=get().jobs.find(row=>row.id===id);if(!job||job.status==='running')return;
   set(state=>({jobs:state.jobs.map(row=>row.id===id?{...row,status:'running'}:row)}));
   try{await forgetFalRequest(id);set(state=>({jobs:state.jobs.filter(row=>row.id!==id)}));}
   catch{set(state=>({jobs:state.jobs.map(row=>row.id===id?{...row,status:'error',error:'Could not stop tracking. Try again.'}:row)}));}
  },
 };
});
