import { create } from 'zustand';
import type { AlertButton, AlertOptions } from 'react-native';
type Dialog = {id:number;title:string;message?:string;buttons:AlertButton[];options?:AlertOptions};
let nextId = 0;
export const useAppDialog = create<{queue:Dialog[]}>()(() => ({queue:[]}));
export function showDialog(title:string,message?:string,buttons?:AlertButton[],options?:AlertOptions) {
  const dialog = {id:++nextId,title,message,buttons:buttons?.length ? buttons : [{text:'OK'}],options};
  useAppDialog.setState(state=>({queue:[...state.queue,dialog]}));
}
/** Remove first so repeated clicks cannot perform an action twice. */
export async function chooseDialog(id:number,index:number) {
  const dialog=useAppDialog.getState().queue[0];
  if (!dialog || dialog.id!==id || !dialog.buttons[index]) return;
  useAppDialog.setState(state=>({queue:state.queue.slice(1)}));
  try {await dialog.buttons[index].onPress?.();}
  catch {showDialog('Could not finish this action','Please try again.');}
}
export function dismissDialog(id:number) {
  const dialog=useAppDialog.getState().queue[0];
  if (!dialog || dialog.id!==id) return;
  const cancel=dialog.buttons.findIndex(button=>button.style==='cancel');
  if (cancel>=0) {void chooseDialog(id,cancel);return;}
  if (dialog.options?.cancelable) {
    useAppDialog.setState(state=>({queue:state.queue.slice(1)}));
    dialog.options.onDismiss?.();
  }
}
