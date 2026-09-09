import {listSavedCollection} from '@/lib/remote-library';
import type {CollectionName} from '@/lib/saved-collections';
export async function directorCollections(origin:string,signal?:AbortSignal){
 const names:CollectionName[]=['characters','voices','storyboards'];
 const groups=await Promise.all(names.map(async name=>{
  const rows=await listSavedCollection(origin,name,signal);
  return {collection:name,available:rows.length,records:rows.slice(0,8).map(row=>({id:row.id,title:row.title.slice(0,120),archived:row.archived===true,description:row.description.slice(0,240),sceneCount:row.beats.length,missingReferences:row.relationshipIssues?.length??0}))};
 }));
 return groups;
}
