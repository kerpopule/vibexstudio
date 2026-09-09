/** Select a bounded mix of recent and explicitly described creations.
 * Titles are searchable metadata, never executable instructions. */
const common=new Set('use using put add take my the this that these those latest newest recent last image images video videos audio song music model asset assets creation creations from with into onto for and please make website app game project'.split(' '));
type Source={searchText?:string;offer:{kind:string;source:string;title:string;createdAt:number}};
function searchWords(text:string):string[]{return text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)??[];}
export function matchingLibraryTerms(item:Source,query:string):string[]{
 const terms=[...new Set(searchWords(query.slice(0,8000)).filter(word=>!common.has(word)))].slice(0,32);
 const words=new Set(searchWords(`${item.offer.title.slice(0,8000)} ${(item.searchText ?? '').slice(0,8000)}`));
 return terms.filter(term=>words.has(term));
}
export function selectLibrarySources<T extends Source>(sources:T[],query=''):T[]{
 const sorted=[...sources].sort((a,b)=>b.offer.createdAt-a.offer.createdAt);
 const groups=new Map<string,T[]>();
 for(const item of sorted){const key=`${item.offer.source}:${item.offer.kind}`;const group=groups.get(key)??[];group.push(item);groups.set(key,group);}
 const selected=new Set<T>();
 for(const group of groups.values()){
  const matches=group.map(item=>{
   return {item,score:matchingLibraryTerms(item,query).length};
  }).filter(row=>row.score>0).sort((a,b)=>b.score-a.score).slice(0,2);
  const chosen=new Set(matches.map(row=>row.item));
  for(const item of group){if(chosen.size>=5)break;chosen.add(item);}
  for(const item of chosen)selected.add(item);
 }
 return sorted.filter(item=>selected.has(item));
}
