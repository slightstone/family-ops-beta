import {z} from 'zod';
import {KidsError} from './kids';
import {kidsHostedConfig} from './kids-hosted-config';
const text=z.string().min(1).max(512);
const hex=(b:ArrayBuffer)=>[...new Uint8Array(b)].map(v=>v.toString(16).padStart(2,'0')).join('');
const sha=async(s:string)=>hex(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
export async function kidsHostedSettings(cleanup=false){
 const c=kidsHostedConfig(cleanup);if(!c.UNIPILE_API_KEY||!c.FAMILY_OPS_SOURCE_IDENTITY_KEY||c.FAMILY_OPS_SOURCE_IDENTITY_KEY.length<32||!c.FAMILY_OPS_PUBLIC_ORIGIN)throw new KidsError('Hosted connection setup is not configured.',503);
 let origin:URL;try{origin=new URL(c.FAMILY_OPS_PUBLIC_ORIGIN);}catch{throw new KidsError('Hosted connection origin is unavailable.',503);}
 if(origin.protocol!=='https:'||origin.username||origin.password||origin.port||origin.pathname!=='/'||origin.search||origin.hash)throw new KidsError('Hosted connection origin is unavailable.',503);
 const fingerprint=await sha(JSON.stringify([c.UNIPILE_APPLICATION_ID,c.UNIPILE_ENVIRONMENT,c.channelId,origin.origin,await sha(c.UNIPILE_API_KEY),await sha(c.FAMILY_OPS_SOURCE_IDENTITY_KEY),...(c.transport==='poll'?['poll']:[])]));
 return {...c,key:c.UNIPILE_API_KEY,identityKey:c.FAMILY_OPS_SOURCE_IDENTITY_KEY,origin:origin.origin,fingerprint};
}
type Settings=Awaited<ReturnType<typeof kidsHostedSettings>>;
export async function readKidsHostedProvider(c:Settings,path:string,body?:unknown,timeout=8000,method?:'DELETE'){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(8000,Math.max(1,timeout)));
 try{
  const r=await fetch('https://api.unipile.com'+path,{method:method??(body===undefined?'GET':'POST'),redirect:'manual',signal:controller.signal,headers:{'X-API-KEY':c.key,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  if(!r.ok)throw new Error('PROVIDER_HTTP_'+r.status);const reader=r.body?.getReader();if(!reader)throw new Error('PROVIDER_RESPONSE_MISSING');const chunks:Uint8Array[]=[];let size=0;
  try{while(true){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>262144)throw new Error('PROVIDER_RESPONSE_TOO_LARGE');chunks.push(x.value);}}finally{await reader.cancel().catch(()=>{});}
  const bytes=new Uint8Array(size);let at=0;for(const x of chunks){bytes.set(x,at);at+=x.length;}try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;}catch{throw new Error('PROVIDER_RESPONSE_INVALID');}
 }catch(e){
  if(controller.signal.aborted)throw new Error('PROVIDER_TIMEOUT');
  if(e instanceof Error&&/^PROVIDER_(HTTP_[1-5][0-9]{2}|RESPONSE_MISSING|RESPONSE_TOO_LARGE|RESPONSE_INVALID)$/.test(e.message))throw e;
  throw new Error('PROVIDER_NETWORK');
 }finally{clearTimeout(timer);}
}
const provider=readKidsHostedProvider;
export async function verifyKidsHostedAccount(c:Settings,expected:{accountId:string;applicationId:string;scopeId:string;identityHash?:string},timeout=8000){
 const accountSchema=z.object({object:z.literal('Account'),id:text,user_id:text,application_id:text,account_scope_id:text,provider:z.literal('whatsapp'),is_locked:z.literal(false),status:z.literal('running'),initial_sync:z.object({status:z.enum(['pending','running','failed','completed'])}).optional()});
 const v=accountSchema.parse(await provider(c,'/v2/accounts/'+encodeURIComponent(expected.accountId),undefined,timeout));if(v.id!==expected.accountId||v.application_id!==expected.applicationId||v.account_scope_id!==expected.scopeId)throw new Error('ACCOUNT_UNCONFIRMED');
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.identityKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);const identity=hex(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['family-ops/unipile-identity/v1',v.application_id,v.account_scope_id,v.user_id]))));if(expected.identityHash&&expected.identityHash!==identity)throw new Error('ACCOUNT_UNCONFIRMED');
 return {identity,sync:v.initial_sync?.status??'unknown'};
}
