import { beforeEach, expect, it, vi } from 'vitest';
import { chooseDialog, dismissDialog, showDialog, useAppDialog } from '@/lib/app-dialog';
beforeEach(()=>useAppDialog.setState({queue:[]}));
it('cancel never invokes the destructive choice and queued dialogs retain their order',async()=>{
 const remove=vi.fn();showDialog('Delete?',undefined,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:remove}]);
 showDialog('Next');const id=useAppDialog.getState().queue[0].id;
 dismissDialog(id);
 expect(remove).not.toHaveBeenCalled();expect(useAppDialog.getState().queue[0].title).toBe('Next');
 await chooseDialog(id,1);expect(remove).not.toHaveBeenCalled();
});
it('executes a confirmed action once even when clicked again before it completes',async()=>{
 let finish!:()=>void;const action=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
 showDialog('Confirm',undefined,[{text:'Do it',onPress:action}]);const id=useAppDialog.getState().queue[0].id;
 const pending=chooseDialog(id,0);await chooseDialog(id,0);expect(action).toHaveBeenCalledTimes(1);finish();await pending;
});
it('keeps failures visible and does not dismiss a required choice on Escape',async()=>{
 showDialog('Required',undefined,[{text:'Try',onPress:()=>{throw Error('fixture');}}]);
 const id=useAppDialog.getState().queue[0].id;dismissDialog(id);expect(useAppDialog.getState().queue).toHaveLength(1);
 await chooseDialog(id,0);expect(useAppDialog.getState().queue[0].title).toBe('Could not finish this action');
});
