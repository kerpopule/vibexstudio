import {ScrollView} from 'react-native';
import {ThemedView} from '@/components/themed-view';
import {ThemedText} from '@/components/themed-text';
import {qrNotice} from '@/lib/notices/qr';
export default function ThirdPartyNotices(){return <ThemedView style={{flex:1}}><ScrollView contentContainerStyle={{padding:24,gap:16}}><ThemedText type="title">Third-party notices</ThemedText><ThemedText type="heading">toqr 0.1.1 · QR encoder</ThemedText><ThemedText selectable>{qrNotice}</ThemedText><ThemedText>Additional dependency notices are available with the corresponding source packages.</ThemedText></ScrollView></ThemedView>;}
