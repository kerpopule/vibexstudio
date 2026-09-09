import type {AgentConnectCore,PendingApproval} from './core';
/** An old dialog cannot authorize a replacement request after timeout. */
export function approveCurrentRequest(core:Pick<AgentConnectCore,'pendingApproval'|'resolveApproval'>,pending:PendingApproval,approved:boolean,mediaRead=false,mediaImport=false,mediaBackground=false,mediaEdit=false,mediaRender=false,mediaGenerate=false):void {
  if(core.pendingApproval!==pending)return;
  void core.resolveApproval(approved,mediaRead,mediaImport,mediaBackground,mediaEdit,mediaRender,mediaGenerate);
}
