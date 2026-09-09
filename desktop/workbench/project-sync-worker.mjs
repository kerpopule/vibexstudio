import {readProjectRevisions,appendProjectRevision,listFolderProjects} from './project-sync-folder.mjs';
const deadline=setTimeout(()=>{console.error('Folder access timed out. Existing revisions were preserved.');process.exit(1);},45000);
try{
 const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--folder')throw new Error('A selected sync folder is required');
 let size=0;const chunks=[];
 for await(const chunk of process.stdin){size+=chunk.length;if(size>32*1024*1024)throw new Error('Sync request is too large');chunks.push(chunk);}
 const request=JSON.parse(Buffer.concat(chunks).toString('utf8'));let result;
 if(request.operation==='list')result={projects:await listFolderProjects(args[1])};
 else if(request.operation==='read'){
  const state=await readProjectRevisions(args[1],request.projectId);
  result={heads:state.heads,revisions:state.revisions.filter(revision=>state.heads.includes(revision.revision))};
 }else if(request.operation==='append')result=await appendProjectRevision(args[1],request.projectId,request.payload,request.expectedHeads);
 else throw new Error('Unsupported sync operation');
 const raw=JSON.stringify(result);if(Buffer.byteLength(raw)>64*1024*1024)throw new Error('Too much conflicting project data to load at once');
 process.stdout.write(raw);
}catch(error){console.error(error.message);process.exitCode=1;}finally{clearTimeout(deadline);}
