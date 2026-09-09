import { Modal, Platform, ScrollView, View } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
import { chooseDialog, dismissDialog, useAppDialog } from '@/lib/app-dialog';
export function AppDialogHost() {
  const dialog=useAppDialog(state=>state.queue[0]);
  const theme=useTheme();
  if (Platform.OS!=='web' || !dialog) return null;
  return <Modal transparent visible animationType="fade" onRequestClose={()=>dismissDialog(dialog.id)}>
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'center',alignItems:'center',padding:20}}>
      <View accessibilityViewIsModal accessibilityRole="alert" style={{width:'100%',maxWidth:480,maxHeight:'90%',backgroundColor:theme.background,padding:24,borderRadius:20,gap:16}}>
        <ScrollView>
          <ThemedText type="smallBold" style={{fontSize:20,marginBottom:12}}>{dialog.title}</ThemedText>
          {dialog.message ? <ThemedText>{dialog.message}</ThemedText> : null}
        </ScrollView>
        {dialog.buttons.map((button,index)=><Button key={`${dialog.id}-${index}`} title={button.text || 'OK'}
          variant={button.style==='destructive'?'danger':button.style==='cancel'?'secondary':'primary'}
          onPress={()=>void chooseDialog(dialog.id,index)} />)}
      </View>
    </View>
  </Modal>;
}
