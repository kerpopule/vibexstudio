export type CollectionName = 'characters' | 'voices' | 'storyboards';
export type CollectionIssue = {field:string;targetId:string;reason:string};
export type SavedRecord = {soundtrackAsset?:{id:string;kind:string;title:string};sourceSha256?:string;archived?:boolean;relationshipIssues?:CollectionIssue[];id:string;title:string;description:string;details:string[];beats:{title:string;description:string;duration?:number;mediaLinks?:{field:string;id:string;kind:string;title:string}[]}[];libraryAssets?:{id:string;kind:string;title:string}[];links?:{voiceId?:string;characterId?:string;songId?:string;castIds:string[]}};
const text = (value:unknown,limit=4000) => typeof value === 'string' ? value.slice(0,limit) : '';
/** Older storyboard forms stored seconds as decimal strings. */
export function savedSceneDuration(value:unknown):number|undefined {
  const numeric=typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value.trim()):value;
  return typeof numeric==='number'&&Number.isFinite(numeric)&&numeric>0?numeric:undefined;
}
export function parseSavedCollection(value:unknown,name:CollectionName):SavedRecord[] {
  const data=value as {version?:unknown;collection?:unknown;records?:unknown};
  if(data?.version!==1||data.collection!==name||!Array.isArray(data.records)||data.records.length>5000)
    throw new Error('The server returned an unsupported saved collection.');
  const seen=new Set<string>();
  return data.records.map(raw=>{
    if(!raw||typeof raw!=='object'||typeof raw.id!=='string'||!raw.id||raw.id.length>240||seen.has(raw.id))
      throw new Error('The saved collection contains an invalid or duplicate record.');
    seen.add(raw.id);
    const beats=Array.isArray(raw.beats)?raw.beats.filter((beat:unknown)=>beat&&typeof beat==='object').map((beat:Record<string,unknown>,i:number)=>({
      title:text(beat.title,240)||`Scene ${i+1}`,description:text(beat.description)||text(beat.narration)||text(beat.video_prompt),
      ...(savedSceneDuration(beat.duration)!==undefined?{duration:savedSceneDuration(beat.duration)}:{}),
      mediaLinks:Array.isArray(beat.mediaLinks)?beat.mediaLinks.filter((asset:any)=>asset&&['still_url','clip_url','assembly_source_url','poster','thumbnail_url'].includes(asset.field)&&typeof asset.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(asset.id)&&['image','video','audio','model'].includes(asset.kind)).map((asset:any)=>({field:asset.field,id:asset.id,kind:asset.kind,title:text(asset.title,240)})):[],
    })):[];
    return {id:raw.id,soundtrackAsset:raw.soundtrackAsset?.kind==='audio'&&typeof raw.soundtrackAsset.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(raw.soundtrackAsset.id)?{id:raw.soundtrackAsset.id,kind:'audio',title:text(raw.soundtrackAsset.title,240)}:undefined,sourceSha256:typeof raw.sourceSha256==='string'&&/^[a-f0-9]{64}$/.test(raw.sourceSha256)?raw.sourceSha256:undefined,archived:raw.archived===true,title:text(raw.name,240)||text(raw.title,240)||'Untitled',
      description:text(raw.appearance)||text(raw.idea)||text(raw.backstory),
      details:[text(raw.personality),text(raw.backstory)].filter(Boolean),beats,
      libraryAssets:Array.isArray(raw.libraryAssets)?raw.libraryAssets.filter((asset:any)=>asset&&typeof asset.id==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(asset.id)&&['image','video','audio','model'].includes(asset.kind)).map((asset:any)=>({id:asset.id,kind:asset.kind,title:text(asset.title,240)})):[],
      relationshipIssues:Array.isArray(raw.relationshipIssues)?raw.relationshipIssues.filter((issue:any)=>issue&&typeof issue.field==='string'&&typeof issue.targetId==='string'&&typeof issue.reason==='string').map((issue:any)=>({field:text(issue.field,240),targetId:text(issue.targetId,240),reason:text(issue.reason,240)})):[],
      links:{voiceId:text(raw.voice_id,240)||undefined,characterId:text(raw.character_id,240)||undefined,
        songId:text(raw.song_id,240)||undefined,castIds:Array.isArray(raw.cast)?raw.cast.filter((id:unknown)=>typeof id==='string'&&id.length<=240):[]}};
  });
}

export function collectionIssueMessage(issue:CollectionIssue):string {
  if(issue.reason==='archived_reference_file_missing')return 'An archived reference image was not found in the preserved files. The character record and original reference are retained; no replacement image was chosen.';
  const subject=issue.field==='voice_id'?'A linked voice':issue.field==='song_id'?'A linked song':'A linked character';
  return `${subject} was not found in the preserved collection. Your saved record and its original link are still here; no replacement was chosen.`;
}
