import {useMemo} from 'react';
import {View,useWindowDimensions} from 'react-native';
import {toQR} from 'toqr';
/** Integer-sized modules and a four-module quiet zone, rendered locally on every platform. */
export function TransferQR({value}:{value:string}){
 const {width}=useWindowDimensions();
 const {size,runs}=useMemo(()=>{
  const matrix=toQR(value,0),size=Math.sqrt(matrix.length);
  const runs:{x:number;y:number;length:number}[]=[];
  for(let y=0;y<size;y++)for(let x=0;x<size;){if(!matrix[y*size+x]){x++;continue;}const start=x;while(x<size&&matrix[y*size+x])x++;runs.push({x:start,y,length:x-start});}
  return {size,runs};
 },[value]);
 const scale=Math.max(1,Math.floor(Math.min(360,Math.max(120,width-80))/(size+8))),pixels=(size+8)*scale;
 return <View accessible accessibilityLabel="AI connection transfer QR. Includes the selected API keys." style={{width:pixels,height:pixels,backgroundColor:'#fff',alignSelf:'center'}}>
  {runs.map((run,index)=><View key={index} style={{position:'absolute',left:(run.x+4)*scale,top:(run.y+4)*scale,width:run.length*scale,height:scale,backgroundColor:'#000'}}/>)}
 </View>;
}
