/** Read an explicit UI capability without confusing API liveness with a website. */
export type MediaHostCapabilities={modelSetup?:boolean;integratedStudio:boolean;webInterface:boolean;editingDrafts:boolean;editingPreview:boolean;editingExport:boolean;editingLibrarySave?:boolean;editingAddSources:boolean};
export async function probeMediaHost(url: string): Promise<MediaHostCapabilities|null> {
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),4000);
  try {
    const response=await fetch(`${url.replace(/\/+$/,'')}/manifest.json`,{
      signal:controller.signal,credentials:'omit',redirect:'error',
    });
    if(!response.ok)return null;
    const manifest=await response.json();
    const integratedStudio=manifest?.vibexStudio?.version===1 && manifest.vibexStudio.integratedStudio===true;
    return {editingLibrarySave:manifest?.vibexStudio?.version===1 && manifest.vibexStudio.editingLibrarySave===true,modelSetup:manifest?.vibexStudio?.version===1?manifest.vibexStudio.modelSetup===true:true,integratedStudio,editingAddSources:manifest?.vibexStudio?.version===1 && manifest.vibexStudio.editingAddSources===true,webInterface:!integratedStudio && !(manifest?.vibexStudio?.version===1 && manifest.vibexStudio.webInterface===false),editingPreview:manifest?.vibexStudio?.version===1 && manifest.vibexStudio.editingPreview===true,editingExport:manifest?.vibexStudio?.version===1 && manifest.vibexStudio.editingExport===true,editingDrafts:manifest?.vibexStudio?.version===1 && manifest.vibexStudio.editingDrafts===true};
  } catch {return null;}
  finally {clearTimeout(timer);}
}
