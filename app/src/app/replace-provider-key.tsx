import {useRef,useState} from 'react';
import {router,useLocalSearchParams} from 'expo-router';
import {ScrollView} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {TextField} from '@/components/ui/text-field';
import {Button} from '@/components/ui/button';
import {Spacing} from '@/constants/theme';
import {useApp} from '@/lib/store';
import {setProviderSecret,clearProviderSecret} from '@/lib/storage/secrets';
import {canReplaceProviderKey,replaceProviderKey} from '@/lib/ai/replace-provider-key';

export default function ReplaceProviderKeyScreen(){
 const {connectionId}=useLocalSearchParams<{connectionId:string}>();
 const provider=useApp(state=>state.providers.find(row=>row.id===connectionId));
 const lock=useRef(false);
 const [key,setKey]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false),[error,setError]=useState('');
 async function save(){
  if(lock.current||saved||!provider)return;
  lock.current=true;setBusy(true);setError('');
  try{
   await replaceProviderKey(provider.id,key,{providers:()=>useApp.getState().providers,write:setProviderSecret,remove:clearProviderSecret});
   setKey('');setSaved(true);
  }catch{setError('Could not finish saving the key. Check any credential-vault prompt and confirm this connection still exists in Setup, then try again.');}
  finally{lock.current=false;setBusy(false);}
 }
 return <ThemedView style={{flex:1}}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{padding:Spacing.three,gap:Spacing.three,width:'100%',maxWidth:720,alignSelf:'center'}}>
  <ThemedText type="title">Replace API key</ThemedText>
  {provider&&canReplaceProviderKey(provider)?<>
   <ThemedText type="heading">{provider.label}</ThemedText>
   <ThemedText>Use a key for the same provider account to keep access to existing jobs. Your projects, model choices, and saved requests keep this connection.</ThemedText>
   <ThemedText type="small" themeColor="textSecondary">The new key stays on this device. Native apps use the OS credential vault; browsers use this site’s local storage. The old key is not displayed. Saving does not validate the key or start generation.</ThemedText>
   {!saved?<><TextField label="New API key" secureTextEntry value={key} onChangeText={setKey} editable={!busy} autoCapitalize="none" autoCorrect={false}/><Button title="Save replacement key" onPress={()=>void save()} loading={busy} disabled={!key.trim()}/></>:<ThemedText accessibilityRole="alert">Key saved. Return to your project or Create and resume the saved job.</ThemedText>}
  </>:<ThemedText>This API-key connection is unavailable. Subscription and managed sign-ins must be refreshed through their sign-in flow.</ThemedText>}
  {error?<ThemedText accessibilityRole="alert">{error}</ThemedText>:null}
  <Button title={saved?'Done':'Back'} variant="secondary" disabled={busy} onPress={()=>router.canGoBack()?router.back():router.replace('/(tabs)/settings')}/>
 </ScrollView></ThemedView>;
}
