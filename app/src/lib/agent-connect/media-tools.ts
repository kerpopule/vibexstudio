import type { ConnectTool } from './core';
import type { RemoteLibraryAsset } from '../library-core';

export function createMediaConnectTools(list: () => Promise<RemoteLibraryAsset[]>, importAsset?: (input:{projectId:string;assetId:string;path:string})=>Promise<unknown>, capabilities?: () => Promise<unknown>): ConnectTool[] {
  const tools:ConnectTool[] = [{
    name: 'list_media_assets',
    requiredPermission: 'mediaRead',
    description: 'List a page of up to 100 newest matching creations in the user-connected Media Lab library. Optionally search title/prompt words with query and filter by kind or an exact Library folder path (including subfolders by default); use these filters to find older named assets. Pass nextCursor back as after with the same filters to reach older pages; null means done. Newer additions do not shift later pages. Returns asset IDs and bounded metadata, without credentials, server addresses or file bytes. Requires separate media library approval. Does not generate, delete or import assets.',
    inputSchema: {type:'object', additionalProperties:false, properties:{
      query:{type:'string',minLength:1,maxLength:200,description:'Search words in creation titles and prompts. Every word must match; case is ignored.'},
      kind:{type:'string',enum:['image','video','audio','model']},
      folder:{type:'string',maxLength:1024,description:'Exact case-sensitive Library folder path, such as Videos/Music Videos. Empty string is the Library root. Omit to search every folder.'},
      includeSubfolders:{type:'boolean',description:'Defaults to true. Set false with folder to list only files directly in that folder.'},
      after:{type:'object',additionalProperties:false,required:['createdAt','id'],properties:{createdAt:{type:'number'},id:{type:'string',minLength:1,maxLength:200}},description:'Use the previous response nextCursor unchanged, with the same query, kind and folder options. Omit for newest results.'},
    }},
    handler: async (args) => {
      if(args.query!==undefined&&(typeof args.query!=='string'||!args.query.trim()||args.query.length>200))throw new Error('Search query must contain 1–200 characters.');
      if(args.kind!==undefined&&!['image','video','audio','model'].includes(args.kind as string))throw new Error('Choose image, video, audio or model.');
      if(args.folder!==undefined&&(typeof args.folder!=='string'||args.folder.length>1024||/[\\\x00-\x1f\x7f]/.test(args.folder)||(args.folder!==''&&args.folder.split('/').some(part=>!part||part==='.'||part==='..'))))throw new Error('Choose an exact relative Library folder path.');
      if(args.includeSubfolders!==undefined&&(typeof args.includeSubfolders!=='boolean'||args.folder===undefined))throw new Error('Use includeSubfolders with a folder, as true or false.');
      const cursor=args.after as {createdAt:number;id:string}|undefined;
      if(cursor!==undefined&&(!cursor||typeof cursor!=='object'||Array.isArray(cursor)||!Number.isFinite(cursor.createdAt)||typeof cursor.id!=='string'||!cursor.id||cursor.id.length>200||Object.keys(cursor).some(key=>key!=='createdAt'&&key!=='id')))throw new Error('Use the nextCursor returned by the previous page.');
      const words=typeof args.query==='string'?args.query.trim().toLowerCase().split(/\s+/):[];
      const assets = (await list()).filter(asset=>{
        if(args.kind!==undefined&&asset.kind!==args.kind)return false;
        if(typeof args.folder==='string'){
          const folder=asset.folder||'';
          if(folder!==args.folder&&!(args.includeSubfolders!==false&&(args.folder===''||folder.startsWith(args.folder+'/'))))return false;
        }
        const text=`${asset.title} ${asset.prompt} ${asset.folder || ''}`.toLowerCase();
        return words.every(word=>text.includes(word));
      });
      const ordered=[...assets].sort((a,b)=>b.createdAt-a.createdAt||(a.id<b.id?-1:a.id>b.id?1:0));
      const remaining=cursor?ordered.filter(asset=>asset.createdAt<cursor.createdAt||(asset.createdAt===cursor.createdAt&&asset.id>cursor.id)):ordered;
      const page=remaining.slice(0,100);
      const last=page[page.length-1];
      return {
        assets: page.map((asset) => ({
          id:asset.id, kind:asset.kind, title:asset.title.slice(0,200),
          prompt:asset.prompt.slice(0,1000), createdAt:asset.createdAt,
          fileName:asset.fileName.slice(0,200), mimeType:asset.mimeType,
          bytes:asset.bytes, provider:asset.providerLabel.slice(0,100),
          ...(asset.folder?{folder:asset.folder.slice(0,1024)}:{}),
        })),
        total:assets.length, truncated:remaining.length > 100,
        nextCursor:remaining.length>100&&last?{createdAt:last.createdAt,id:last.id}:null,
      };
    },
  }];
  if(importAsset)tools.push({name:'import_media_asset',requiredPermission:'mediaImport',description:'Copy one asset up to 128 MiB from the connected Media Lab library into an existing project without overwriting files. Requires separate media-import approval. Use an asset ID from list_media_assets and a relative assets/ path. Returns the saved path. Retrying the same path recovers an identical binary file after verifying its bytes; different files are never overwritten. Does not generate or delete library media.',inputSchema:{type:'object',additionalProperties:false,required:['projectId','assetId','path'],properties:{projectId:{type:'string',minLength:1,maxLength:128},assetId:{type:'string',minLength:1,maxLength:200},path:{type:'string',minLength:1,maxLength:180}}},handler:async(args)=>{
   for(const key of ['projectId','assetId','path'])if(typeof args[key]!=='string'||!args[key])throw new Error(`${key} is required.`);
   return importAsset({projectId:args.projectId as string,assetId:args.assetId as string,path:args.path as string});
  }});
  if (capabilities) tools.push({
    name:'get_media_capabilities', requiredPermission:'mediaRead',
    description:'Read the connected Media Lab server’s supported operations and setup state. Requires media library approval. Returns no server addresses, credentials, files or job history. Does not install models, generate media or authorize agent generation.',
    inputSchema:{type:'object',additionalProperties:false,properties:{}},
    handler:async (_args,agent) => {
      const value=await capabilities();
      const report=value as Record<string,unknown>;
      const ready=Array.isArray(report.operations) && report.operations.some(operation => operation?.operation==='remove-background');
      return {...report,agentCanSubmitJobs:agent.mediaBackground===true && report.state==='connected' && ready,
        agentApprovedOperations:agent.mediaBackground===true ? ['remove-background'] : []};
    },
  });
  return tools;
}
