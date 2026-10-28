import {FamilyError} from './family';
// Enforce the cap while streaming, even when Content-Length is absent or false.
export async function boundedRequest(request:Request,max:number){
 if(Number(request.headers.get('content-length')??0)>max)throw new FamilyError('This request is too large.',413);
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>max){await reader.cancel();throw new FamilyError('This request is too large.',413);}chunks.push(next.value);}}finally{reader.releaseLock();}
 const result=new Uint8Array(length);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
