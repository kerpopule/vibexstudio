const COMMON_WORDS=new Set('a about an and are as at be been but by can could do does for from get give have hey how i in into is it its latest like make me my new of on or our please put recent should show some take than that the their them then there these they this those to use using want was we what when where which who will with would you your image images video videos audio music song songs model models file files asset assets project app website game'.split(' '));
function words(value:string):Set<string>{
 return new Set((value.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]).filter(word=>word.length>1&&!COMMON_WORDS.has(word)).slice(0,64));
}
/** Search all titles locally; send only a bounded set of metadata to the chosen AI. */
export function directorLibrarySelection<T extends {kind:string;prompt?:string;title?:string}>(newestFirst:readonly T[],query=''):T[]{
 const wanted=words(query.slice(0,4000));
 const matches=newestFirst.map((item,index)=>({index,score:[...words(item.title??item.prompt??'')].filter(word=>wanted.has(word)).length}))
  .filter(item=>item.score>0).sort((a,b)=>b.score-a.score||a.index-b.index).slice(0,8);
 const selected=new Set<number>(matches.map(item=>item.index)),kinds=new Set<string>();
 // Reserve up to four positions for the latest of each media type.
 newestFirst.forEach((item,index)=>{if(!kinds.has(item.kind)&&selected.size<12){kinds.add(item.kind);selected.add(index);}});
 for(let index=0;index<newestFirst.length&&selected.size<12;index++)selected.add(index);
 if(!matches.length)return [...selected].sort((a,b)=>a-b).map(index=>newestFirst[index]);
 return [...selected].map(index=>newestFirst[index]);
}
