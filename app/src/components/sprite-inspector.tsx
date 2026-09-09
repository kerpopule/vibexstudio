import {Image} from 'expo-image';
import {useState} from 'react';
import {View} from 'react-native';
import {ThemedText} from '@/components/themed-text';
import {Button} from '@/components/ui/button';
import type {ProjectSprite} from '@/lib/project-sprite';

type Frame = {frame:{x:number;y:number;w:number;h:number};spriteSourceSize:{x:number;y:number;w:number;h:number};sourceSize:{w:number;h:number};empty:boolean};

export function SpriteInspector({sprite}:{sprite:ProjectSprite}) {
  const [index,setIndex]=useState(0);
  const [imageError,setImageError]=useState(false);
  const order=sprite.metadata.meta.frameOrder;
  const row=sprite.metadata.frames[order[index]] as Frame;
  const scale=Math.min(240/row.sourceSize.w,240/row.sourceSize.h,4);
  const box=row.frame;
  return <View style={{gap:12,alignItems:'center'}}>
    <ThemedText type="heading">Sprite frames</ThemedText>
    <ThemedText>Frame {index+1} of {order.length}</ThemedText>
    <View accessibilityLabel={`Sprite frame ${index+1}`} style={{width:240,height:240,backgroundColor:'#606879',alignItems:'center',justifyContent:'center'}}>
      <View style={{width:row.sourceSize.w*scale,height:row.sourceSize.h*scale}}>
        {!row.empty ? <View style={{position:'absolute',left:row.spriteSourceSize.x*scale,top:row.spriteSourceSize.y*scale,width:box.w*scale,height:box.h*scale,overflow:'hidden'}}>
          <Image source={{uri:`data:image/png;base64,${sprite.image.content}`}} contentFit="fill" onError={()=>setImageError(true)} style={{position:'absolute',left:-box.x*scale,top:-box.y*scale,width:sprite.metadata.meta.size.w*scale,height:sprite.metadata.meta.size.h*scale}} />
        </View> : null}
      </View>
    </View>
    {imageError ? <ThemedText accessibilityRole="alert">The atlas image could not be displayed. Its frame data is still available below.</ThemedText> : null}
    <ThemedText>{row.sourceSize.w} × {row.sourceSize.h} pixels{row.empty ? ' · Empty frame' : ''}</ThemedText>
    <View style={{flexDirection:'row',gap:12}}>
      <Button title="Previous frame" variant="secondary" disabled={index===0} onPress={()=>setIndex(index-1)} />
      <Button title="Next frame" variant="secondary" disabled={index===order.length-1} onPress={()=>setIndex(index+1)} />
    </View>
    <ThemedText>Frames keep their original size and position. The gray background is only for this preview.</ThemedText>
  </View>;
}
