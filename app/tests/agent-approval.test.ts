import {expect,it,vi} from 'vitest';
import {approveCurrentRequest} from '../src/lib/agent-connect/approval';
it('an expired dialog cannot approve a newer request, including media access',()=>{
 const old={code:'old',agentName:'Old',remoteAddress:'127.0.0.1'};
 const current={code:'new',agentName:'New',remoteAddress:'127.0.0.1'};
 const resolveApproval=vi.fn(async()=>{});
 const core={pendingApproval:current,resolveApproval};
 approveCurrentRequest(core,old,true,true);expect(resolveApproval).not.toHaveBeenCalled();
 approveCurrentRequest(core,current,true,false);expect(resolveApproval).toHaveBeenCalledWith(true,false,false,false,false,false,false);
});
it('requires the current dialog to grant background removal separately',()=>{
 const old={code:'old',agentName:'Old',remoteAddress:'127.0.0.1'};
 const current={code:'new',agentName:'New',remoteAddress:'127.0.0.1'};
 const resolveApproval=vi.fn(async()=>{});
 const core={pendingApproval:current,resolveApproval};
 approveCurrentRequest(core,old,true,true,true,true);expect(resolveApproval).not.toHaveBeenCalled();
 approveCurrentRequest(core,current,true,true,false,true);expect(resolveApproval).toHaveBeenCalledWith(true,true,false,true,false,false,false);
});
it('only the current dialog can grant editing permission explicitly',()=>{
 const pending={code:'current',agentName:'Agent',remoteAddress:'127.0.0.1'},resolveApproval=vi.fn(async()=>{});
 const core={pendingApproval:pending,resolveApproval};
 approveCurrentRequest(core,{...pending},true,true,false,false,true);expect(resolveApproval).not.toHaveBeenCalled();
 approveCurrentRequest(core,pending,true,true,false,false,true);expect(resolveApproval).toHaveBeenCalledWith(true,true,false,false,true,false,false);
});
it('forwards separate render consent only for the current request',()=>{
 const pending={code:'current',agentName:'Agent',remoteAddress:'127.0.0.1'},resolveApproval=vi.fn(async()=>{});
 const core={pendingApproval:pending,resolveApproval};
 approveCurrentRequest(core,{...pending},true,true,false,false,false,true);expect(resolveApproval).not.toHaveBeenCalled();
 approveCurrentRequest(core,pending,true,true,false,false,false,true);expect(resolveApproval).toHaveBeenCalledWith(true,true,false,false,false,true,false);
});
it('forwards separate media-generation consent only for the current request',()=>{
 const pending={code:'current',agentName:'Agent',remoteAddress:'127.0.0.1'},resolveApproval=vi.fn(async()=>{});
 const core={pendingApproval:pending,resolveApproval};
 approveCurrentRequest(core,{...pending},true,true,false,false,false,false,true);expect(resolveApproval).not.toHaveBeenCalled();
 approveCurrentRequest(core,pending,true,true,false,false,false,false,true);expect(resolveApproval).toHaveBeenCalledWith(true,true,false,false,false,false,true);
});
