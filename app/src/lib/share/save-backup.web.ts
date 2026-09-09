export async function saveBackupFile(raw:string,kind:'project'|'ai'='project'):Promise<void>{
 const url=URL.createObjectURL(new Blob([raw],{type:'application/json'}));
 const link=document.createElement('a');
 try{link.href=url;link.download=`vibex-${kind==='ai'?'ai-connections':'backup'}-${Date.now()}.json`;link.style.display='none';document.body.appendChild(link);link.click();}
 finally{link.remove();setTimeout(()=>URL.revokeObjectURL(url),60_000);}
}
