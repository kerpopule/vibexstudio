/** Model output proposes a review; it never grants file-write authority. */
export const DIRECTOR_ACTION_PROMPT = 'When the user wants an available Library item in this project, you may append one fenced vibex-action JSON block: {"type":"import-library-asset","assetId":"EXACT_LIBRARY_ID"}. Use only an ID supplied in Library metadata. This proposes a user-reviewed copy, not an executed action. Do not include URLs, paths, commands or additional fields. The app chooses a safe destination. Never claim the copy succeeded until the user reports it.';
export type DirectorAssetProposal = {type:'import-library-asset';assetId:string};
export function directorAssetProposal(reply:string):{text:string;proposal:DirectorAssetProposal|null}{
 const blocks=[...reply.matchAll(/```vibex-action\s*\n([\s\S]*?)\n```/g)];
 if(blocks.length!==1||blocks[0][1].length>512)return {text:reply,proposal:null};
 try{
  const value=JSON.parse(blocks[0][1]);
  if(!value||Array.isArray(value)||Object.keys(value).sort().join(',')!=='assetId,type'||value.type!=='import-library-asset'||
   typeof value.assetId!=='string'||!/^(server|device)-[A-Za-z0-9_-]{1,128}$/.test(value.assetId))return {text:reply,proposal:null};
  return {text:reply.replace(blocks[0][0],'').trim(),proposal:value};
 }catch{return {text:reply,proposal:null};}
}
