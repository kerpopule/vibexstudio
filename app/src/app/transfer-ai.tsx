import {useRef,useState} from 'react';
import {Platform,ScrollView,TextInput,View} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import {digestStringAsync,CryptoDigestAlgorithm} from 'expo-crypto';
import {TransferQR} from '@/components/transfer-qr';
import {TransferCamera} from '@/components/transfer-camera';
import {makeTransferQR,readTransferQR} from '@/lib/connection-transfer/qr';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import {Glass} from '@/components/ui/glass';
import {useTheme} from '@/hooks/use-theme';
import {useApp} from '@/lib/store';
import {PROVIDERS} from '@/lib/ai/registry';
import {getProviderSecret,setProviderSecret} from '@/lib/storage/secrets';
import {updateProviders} from '@/lib/storage/settings';
import {saveBackupFile} from '@/lib/share/save-backup';
import {readBundleFile} from '@/lib/share/read-bundle-file';
import {canTransferConnection,collectConnections,TRANSFER_LIMIT,type ConnectionTransfer} from '@/lib/connection-transfer/bundle';
import {sealConnections,openConnections} from '@/lib/connection-transfer/encryption';
import {normalizeTransferFile,transferClipboardText} from '@/lib/connection-transfer/envelope';
import {restoreConnections} from '@/lib/connection-transfer/restore';

export default function TransferAI(){
 const theme=useTheme(),providers=useApp(s=>s.providers),lock=useRef(false);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const [showQR,setShowQR]=useState(false),[scanning,setScanning]=useState(false);
 const [mode,setMode]=useState<'send'|'receive'|null>(null),[selected,setSelected]=useState<string[]>([]);
 const [sealed,setSealed]=useState<{file:string;unlockCode:string}|null>(null);
 const [file,setFile]=useState<string|null>(null),[code,setCode]=useState('');
 const [pasteMode,setPasteMode]=useState(false),[pasted,setPasted]=useState('');
 const [review,setReview]=useState<{transfer:ConnectionTransfer;sha:string}|null>(null);
 async function run(action:()=>Promise<void>){if(lock.current)return;lock.current=true;setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof Error?error.message:'Could not transfer AI connections.');}finally{lock.current=false;setBusy(false);}}
 function reset(next:'send'|'receive'|null){setMode(next);setSealed(null);setFile(null);setCode('');setReview(null);setSelected([]);setMessage('');setPasteMode(false);setPasted('');setShowQR(false);setScanning(false);}
 const qrData=sealed?makeTransferQR(sealed.file,sealed.unlockCode):null;
 return <ThemedView style={{flex:1}}><ScrollView contentContainerStyle={{padding:20,paddingBottom:48}} keyboardShouldPersistTaps="handled"><View style={{width:'100%',maxWidth:660,alignSelf:'center',gap:16}}>
  <ThemedText type="title">{showQR?'Scan this code':'Move your AI'}</ThemedText>
  {!sealed&&!review?<ThemedText themeColor="textSecondary">Use your existing AI keys and model choices on another device. You control the transfer file; VibeX does not host it. Projects move separately through project sync or backups.</ThemedText>:null}
  {!mode?<><Button title="Send from this device" onPress={()=>reset('send')}/><Button title="Receive on this device" variant="secondary" onPress={()=>reset('receive')}/></>:null}
  {mode==='send'?<>
   {!sealed?<><ThemedText type="heading">Choose what to bring</ThemedText>
   <ThemedText themeColor="textSecondary">API-key connections can travel. Subscription sign-ins, GitHub and private device grants need a fresh sign-in on the other device.</ThemedText></>:null}
   {!providers.some(canTransferConnection)?<ThemedText>No transferable AI connections on this device yet.</ThemedText>:null}
   {!sealed?providers.filter(canTransferConnection).map(provider=><Button key={provider.id} title={`${selected.includes(provider.id)?'✓ ':''}${provider.label}`} variant="secondary" disabled={busy} onPress={()=>setSelected(ids=>ids.includes(provider.id)?ids.filter(id=>id!==provider.id):[...ids,provider.id])}/>):null}
   {!sealed?<Button title="Prepare encrypted transfer" disabled={busy||!selected.length} onPress={()=>void run(async()=>{
    const connections=useApp.getState().providers.filter(p=>selected.includes(p.id));
    if(connections.length!==selected.length)throw new Error('Your connections changed. Choose them again.');
    setSealed(await sealConnections(await collectConnections(connections,getProviderSecret)));
   })}/>:<Glass style={{padding:16,gap:12}}>
    <ThemedText type="heading">Scan on your other device</ThemedText>
    {qrData?<>
     {!showQR?<ThemedText>In the installed app, open Move AI connections → Receive → Scan from another device. Review what it shows before adding connections.</ThemedText>:null}
     <Button title={showQR?'Hide QR':'Show transfer QR'} variant="secondary" disabled={busy} onPress={()=>setShowQR(value=>!value)}/>
     {showQR?<><ThemedText>This code includes the selected API keys. Only show it to your own device.</ThemedText><TransferQR value={qrData}/></>:null}
    </>:<ThemedText>These settings are too large for one QR. Select fewer connections, or use the encrypted file/text option below.</ThemedText>}
    <ThemedText type="heading">Or bring a file and unlock code</ThemedText>
    <ThemedText>1. Save the encrypted file to your Files app, iCloud Drive, Google Drive, or another destination you control.</ThemedText>
    <Button title="Save encrypted file" disabled={busy} onPress={()=>void run(async()=>{await saveBackupFile(sealed.file,'ai');setMessage('File handed to your device. Confirm it reached your chosen destination.');})}/>
    <Button title="Or copy encrypted transfer text" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await Clipboard.setStringAsync(transferClipboardText(sealed.file));setMessage('Encrypted text copied. Paste it on your other device, then return here for the separate unlock code.');})}/>
    <ThemedText>2. Copy the unlock code and bring it separately. On your other device, open Setup → Move AI connections → Receive.</ThemedText>
    <Button title="Copy unlock code" variant="secondary" disabled={busy} onPress={()=>void run(async()=>{await Clipboard.setStringAsync(sealed.unlockCode);setMessage('Unlock code copied. Keep this screen open until your other device has received it.');})}/>
    <ThemedText themeColor="textSecondary">Anyone with both the file and code can use these API keys. Do not put them in a GitHub repository. Closing this screen discards the code from this screen; it does not clear a code you copied to the clipboard.</ThemedText>
   </Glass>}
  </>:null}
  {mode==='receive'?<>
   {Platform.OS!=='web'&&!review?<Button title="Scan from another device" variant="secondary" disabled={busy||scanning} onPress={()=>{setScanning(true);setMessage('');}}/>:null}
   {scanning?<TransferCamera onCancel={()=>setScanning(false)} onRead={payload=>{if(lock.current)return;setScanning(false);void run(async()=>{const decoded=readTransferQR(payload);const transfer=await openConnections(decoded.file,decoded.unlockCode);setFile(decoded.file);setCode('');setPasted('');setPasteMode(false);setReview({transfer,sha:await digestStringAsync(CryptoDigestAlgorithm.SHA256,decoded.file)});});}}/>:null}
   <ThemedText type="heading">Or bring the file and unlock code</ThemedText>
   <Button title={file?'Choose a different encrypted file':'Choose encrypted file'} variant="secondary" disabled={busy} onPress={()=>void run(async()=>{
    const picked=await DocumentPicker.getDocumentAsync({type:'application/json',copyToCacheDirectory:true});if(picked.canceled)return;
    setReview(null);setFile(null);const asset=picked.assets[0];
    if(asset.size!==undefined&&asset.size>TRANSFER_LIMIT*6)throw new Error('This AI transfer file is too large.');
    const raw=await readBundleFile(asset.uri);if(raw.length>TRANSFER_LIMIT*6)throw new Error('This AI transfer file is too large.');setFile(raw);setCode('');setPasteMode(false);setPasted('');
   })}/>
   {!review?<Button title={pasteMode?'Hide pasted transfer':'Or paste encrypted transfer text'} variant="secondary" disabled={busy} onPress={()=>{setPasteMode(value=>!value);setPasted('');}}/>:null}
   {pasteMode&&!review?<>
    <TextInput accessibilityLabel="Encrypted AI transfer text" placeholder="Paste the encrypted transfer text" placeholderTextColor={theme.textSecondary} value={pasted} onChangeText={setPasted} multiline maxLength={TRANSFER_LIMIT*6+1} autoCapitalize="none" autoCorrect={false} editable={!busy} style={{color:theme.text,borderColor:theme.border,borderWidth:1,borderRadius:16,padding:16,minHeight:120,maxHeight:180}}/>
    <Button title="Use pasted transfer" disabled={busy||!pasted.trim()} onPress={()=>void run(async()=>{if(pasted.length>TRANSFER_LIMIT*6)throw new Error('This AI transfer text is too large.');setFile(pasted.trim());setReview(null);setCode('');setPasted('');setPasteMode(false);})}/>
   </>:null}
   {file&&!review?<>
    <TextInput accessibilityLabel="Transfer unlock code" placeholder="Paste unlock code" placeholderTextColor={theme.textSecondary} value={code} onChangeText={setCode} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy} style={{color:theme.text,borderColor:theme.border,borderWidth:1,borderRadius:16,padding:16}}/>
    <Button title="Unlock and review" disabled={busy||!code.trim()} onPress={()=>void run(async()=>{const transfer=await openConnections(file,code);setReview({transfer,sha:await digestStringAsync(CryptoDigestAlgorithm.SHA256,normalizeTransferFile(file))});setCode('');})}/>
   </>:null}
   {review?<Glass style={{padding:16,gap:12}}>
    <ThemedText type="heading">Add these connections?</ThemedText>
    {review.transfer.connections.map((connection,index)=><View key={index} style={{gap:4}}>
     <ThemedText type="smallBold">{connection.label} · {PROVIDERS[connection.kind].name}</ThemedText>
     <ThemedText selectable themeColor="textSecondary">{connection.baseUrl??PROVIDERS[connection.kind].baseUrl}</ThemedText>
     <ThemedText themeColor="textSecondary">Model: {connection.model||'Choose after import'}{connection.mediaModels?.image?` · Image: ${connection.mediaModels.image}`:''}{connection.mediaModels?.video?` · Video: ${connection.mediaModels.video}`:''}</ThemedText>
    </View>)}
    <ThemedText themeColor="textSecondary">These are additional connections. Existing connections stay as they are. No AI requests run during import. Installed apps save keys in the device credential vault; a plain browser saves them in this site’s local browser storage. Check that you recognize every server address before adding it.</ThemedText>
    <Button title="Add connections to this device" disabled={busy} onPress={()=>void run(async()=>{
     const result=await restoreConnections(review.transfer,review.sha,{update:updateProviders,secret:setProviderSecret,changed:providers=>useApp.setState({providers})});
     setReview(null);setFile(null);setCode('');setMessage(`${result.added} added · ${result.existing} already imported. Open Your AI in Setup to check your connections. Projects can choose their AI there or in project settings.`);
    })}/>
   </Glass>:null}
  </>:null}
  {message?<ThemedText accessibilityRole="alert">{message}</ThemedText>:null}
  {mode?<Button title="Start over" variant="secondary" disabled={busy} onPress={()=>reset(null)}/>:null}
 </View></ScrollView></ThemedView>;
}
