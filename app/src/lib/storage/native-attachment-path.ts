/** iOS can relocate an app's data container during installation or restoration. */
export function iosProjectAttachmentPath(uri:string,projectId:string):string|null {
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(projectId)||typeof uri!=='string')return null;
 try{
  const url=new URL(uri);
  if(url.protocol!=='file:'||url.hostname||url.search||url.hash)return null;
  const path=decodeURIComponent(url.pathname);
  const uuid='[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
  const container=`(?:/(?:private/)?var/mobile/Containers/Data/Application/${uuid}|/(?:private/)?Users/[^/]+/Library/Developer/CoreSimulator/Devices/${uuid}/data/Containers/Data/Application/${uuid})`;
  const match=path.match(new RegExp(`^${container}/Documents/projects/${projectId}/((?:files|media)/.+)$`));
  if(!match)return null;
  const relative=match[1];
  if(relative.includes('\\')||relative.split('/').some(part=>!part||part==='.'||part==='..'||/[\u0000-\u001f]/.test(part)))return null;
  // URL normalization must not turn a traversal into an apparently valid reference.
  if(/(?:^|\/)(?:\.|\.\.)(?:\/|$)/.test(decodeURIComponent(uri.slice('file://'.length))))return null;
  return relative;
 }catch{return null;}
}

export function sameNativeProjectAttachment(uri:string,currentUri:string,projectId:string):boolean {
 if(uri===currentUri)return true;
 const oldPath=iosProjectAttachmentPath(uri,projectId);
 return oldPath!==null&&oldPath===iosProjectAttachmentPath(currentUri,projectId);
}
