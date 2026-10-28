import {connectionSourceFence} from './kids-source-authority';
import {readKidsChatSource,readKidsSourceConnection} from './kids-source-connections';
import {hostedQueueCount,hostedQueueBytes} from './kids-hosted-capacity';
import {z} from 'zod';
import {KidsError,checkedKids,kidsNeedsUpgrade} from './kids';
import {kidsServiceGuard,requireKidsService} from './kids-service';
import {kidsHostedConfig,kidsHostedAccountAlias} from './kids-hosted-config';

const MAX_BODY=262144,MAX_QUEUE=1000,MAX_QUEUE_BYTES=8*1024*1024;
const CONSENT='unipile-v2-2026-10-23';
const id=z.string().min(1).max(180);
const eventSchema=z.object({id,created_at:z.string().datetime({offset:true}),application_id:id,application_production:z.boolean(),account_id:id,account_scope_id:id,account_provider:z.literal('whatsapp'),type:z.string().min(1).max(100),payload:z.unknown()});
const messageIdentity=z.object({id,chat_id:id,provider:z.literal('whatsapp').optional()});
const accountEvents=new Set(['account.add','account.reconnect','account.remove','account.locked','account.unlocked','account.status.running','account.status.disconnected','account.status.errored','account.status.partial','account.status.degraded','account.initial_sync.running','account.initial_sync.completed','account.initial_sync.failed']);
type Binding={id:string;owner_user_id:string;workspace_id:string;application_id:string;production:number;endpoint_id:string;scope_id:string;account_id:string;revision:number;active:number;consent_version:string;created_at:number};
type Workspace={user_id:string;id:string;revision:number;epoch:number;document:string;operations:string};
const denied=()=>new KidsError('This source event is not currently authorized.',403);
const digest=async(bytes:Uint8Array<ArrayBuffer>)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');

// This is deliberately the only public entry point. No helper can assign an
// account, infer consent, release source bodies, or trigger paid computation.
export async function receiveKidsHostedEvent(request:Request){
 const c=kidsHostedConfig();
 if(c.transport!=='webhook'||!c.webhookSecret)throw new KidsError('Webhook intake is unavailable for this private polling connection.',404);
 // Use the platform's maintained WebCrypto verifier rather than a handwritten
 // signature comparison. Sign the original bytes, not reconstructed JSON.
 const header=request.headers.get('unipile-signature')??'',parts=/^t=([1-9][0-9]{0,12}),v0=([a-f0-9]{64})$/.exec(header);
 if(!parts)throw new KidsError('Source signature was rejected.',401);
 const timestamp=Number(parts[1]),now=Math.floor(Date.now()/1000);
 if(timestamp>now||now-timestamp>300)throw new KidsError('Source signature expired or is in the future.',401);
 if(request.headers.get('content-encoding')&&request.headers.get('content-encoding')!=='identity')throw new KidsError('Use an unencoded source event.',415);
 const reader=request.body?.getReader();if(!reader)throw new KidsError('Source event is empty.',400);
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>MAX_BODY)throw new KidsError('Source event exceeds the intake limit. Reconciliation is required.',413);chunks.push(item.value);}}finally{await reader.cancel().catch(()=>{});}
 const raw=new Uint8Array(size);let offset=0;for(const chunk of chunks){raw.set(chunk,offset);offset+=chunk.length;}
 const prefix=new TextEncoder().encode(parts[1]+'.'),signed=new Uint8Array(prefix.length+raw.length);signed.set(prefix);signed.set(raw,prefix.length);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(c.webhookSecret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const signature=Uint8Array.from(parts[2].match(/../g)!,v=>parseInt(v,16));
 if(!await crypto.subtle.verify('HMAC',key,signature,signed))throw new KidsError('Source signature was rejected.',401);
 let rawText:string,event:z.infer<typeof eventSchema>;
 try{rawText=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);event=eventSchema.parse(JSON.parse(rawText));}catch{throw new KidsError('Source event format was rejected.',400);}
 const isMessage=['message.new','message.update','message.delete'].includes(event.type);
 if(!isMessage&&!accountEvents.has(event.type))throw new KidsError('Unsupported source event. Reconciliation is required.',422);
 if(event.application_id!==c.UNIPILE_APPLICATION_ID||event.application_production!==(c.UNIPILE_ENVIRONMENT==='production'))throw denied();
 const b=await c.DB.prepare('SELECT * FROM kids_hosted_bindings WHERE application_id=? AND account_id=? AND scope_id=?').bind(event.application_id,event.account_id,event.account_scope_id).first<Binding>();
 if(!b||!b.active||b.production!==Number(event.application_production)||b.endpoint_id!==c.channelId||b.consent_version!==CONSENT||Date.parse(event.created_at)<b.created_at)throw denied();
 const row=await c.DB.prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(b.owner_user_id,b.workspace_id).first<Workspace>();
 if(!row)throw denied();const k=checkedKids(JSON.parse(row.document));
 if(kidsNeedsUpgrade(k,row.operations))throw new KidsError('Kids storage upgrade is not finished.',503);
 if(k.mode!=='live'||!k.discoveryConsent||!k.processingConsent||!k.confirmedAt||!k.grants.some(g=>g.enabled))throw denied();
 const identity=isMessage?messageIdentity.safeParse(event.payload):null;
 if(isMessage&&!identity?.success)throw new KidsError('Source message identity was rejected.',400);
 const chat=identity?.success?identity.data.chat_id:null,message=identity?.success?identity.data.id:null;
 const connection=await readKidsSourceConnection(c.DB,b.owner_user_id,b.workspace_id,b.id);
 if(connection&&(connection.id!==b.id||connection.status!=='connected'||!connection.discovery_consent||!connection.processing_consent||!connection.confirmed_at||connection.paused))throw denied();
 const prepared=!!await c.DB.prepare('SELECT 1 ok FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=? LIMIT 1').bind(b.owner_user_id,b.workspace_id).first();
 if(prepared&&!connection||!prepared&&(k.connection.accountId!==kidsHostedAccountAlias(b.id)||k.connection.selfUserId!=='hosted-self:'+b.id))throw denied();
 const candidates=k.candidates.filter(candidate=>candidate.accountId===kidsHostedAccountAlias(b.id)&&k.grants.some(g=>g.enabled&&g.chatId===candidate.id));
 let appChat:string|null=null,rawChat:string|null=null;
 if(prepared){for(const candidate of candidates){const mapping=await readKidsChatSource(c.DB,b.owner_user_id,b.workspace_id,candidate.id);if(mapping?.binding_id===b.id&&(!chat||mapping.provider_chat_id===chat)){appChat=mapping.app_chat_id;rawChat=mapping.provider_chat_id;break;}}}
 else if(candidates.some(candidate=>!chat||candidate.id===chat)){appChat=chat??candidates[0].id;rawChat=appChat;}
 if(!appChat||!rawChat)throw denied();
 const localEpoch=connection?.source_epoch??0,local=connectionSourceFence(b.id,appChat,rawChat,localEpoch);
 const service=await requireKidsService(b.owner_user_id,b.workspace_id,false),guard=kidsServiceGuard(service),hash=await digest(raw);
 const previous=()=>c.DB.prepare('SELECT body_hash,binding_id FROM kids_hosted_events WHERE application_id=? AND event_id=?').bind(event.application_id,event.id).first<{body_hash:string;binding_id:string}>();
 const old=await previous();
 if(old){if(old.body_hash!==hash||old.binding_id!==b.id)throw new KidsError('This source event ID belongs to different content.',409);return {received:true,retried:true};}
 const body=isMessage?rawText:null,bytes=isMessage?raw.length:0;
 // Reuse the canonical DB-clock entitlement predicate, without refreshing a
 // provider. Every source/body fence is repeated in the serialized INSERT.
 const fence=`kids_state.user_id=? AND kids_state.id=? AND kids_state.revision=? AND kids_state.epoch=? AND json_extract(kids_state.document,'$.mode')='live' AND json_extract(kids_state.document,'$.discoveryConsent')=1 AND json_extract(kids_state.document,'$.processingConsent')=1 AND json_extract(kids_state.document,'$.confirmedAt') IS NOT NULL AND ${local.sql} AND EXISTS(SELECT 1 FROM json_each(kids_state.document,'$.candidates') candidate WHERE json_extract(candidate.value,'$.id')=? AND json_extract(candidate.value,'$.accountId')=?) AND EXISTS(SELECT 1 FROM json_each(kids_state.document,'$.grants') g WHERE json_extract(g.value,'$.enabled')=1 AND json_extract(g.value,'$.chatId')=?) AND b.id=? AND b.revision=? AND b.active=1 AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.scope_id=? AND b.account_id=? AND b.consent_version=? AND b.created_at<=? AND ${guard.sql}`;
 const values=[b.owner_user_id,b.workspace_id,row.revision,row.epoch,...local.values,appChat,kidsHostedAccountAlias(b.id),appChat,b.id,b.revision,event.application_id,Number(event.application_production),c.channelId,event.account_scope_id,event.account_id,CONSENT,Date.parse(event.created_at),...guard.values];
 const source='kids_state JOIN kids_hosted_bindings b ON b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id';
 const capacity=`${hostedQueueCount('b.id')}<${MAX_QUEUE} AND ${hostedQueueBytes('b.id')}+?<=${MAX_QUEUE_BYTES}`;
 const receiptSql='EXISTS(SELECT 1 FROM kids_hosted_events WHERE application_id=? AND event_id=? AND body_hash=? AND binding_id=?)',receiptValues=[event.application_id,event.id,hash,b.id];
 // The UPDATE runs after INSERT. An accepted event is already included in the
 // queue sum; add incoming bytes only when that event was not recorded.
 const full=`${hostedQueueCount('kids_hosted_bindings.id')}>=${MAX_QUEUE} OR ${hostedQueueBytes('kids_hosted_bindings.id')}>=${MAX_QUEUE_BYTES} OR (NOT ${receiptSql} AND ${hostedQueueBytes('kids_hosted_bindings.id')}+?>${MAX_QUEUE_BYTES})`,fullValues=[...receiptValues,bytes];
 const result=await c.DB.batch([
  c.DB.prepare(`INSERT INTO kids_hosted_events(binding_id,binding_revision,application_id,event_id,event_type,event_created_at,event_millis,chat_id,message_id,body_hash,raw_body,raw_bytes,workspace_revision,epoch,service_grant_id,service_revision,connection_epoch,received_at) SELECT b.id,b.revision,?,?,?,?,?,?,?,?,?,?,kids_state.revision,kids_state.epoch,?,?,?,CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) FROM ${source} WHERE ${fence} AND ${capacity} ON CONFLICT(application_id,event_id) DO NOTHING RETURNING sequence`).bind(event.application_id,event.id,event.type,event.created_at,Date.parse(event.created_at),chat,message,hash,body,bytes,service.grantId,service.revision,localEpoch,...values,bytes),
  c.DB.prepare(`UPDATE kids_hosted_bindings SET reconciliation_reason=CASE WHEN ${full} THEN 'queue_capacity_reached' ELSE COALESCE(reconciliation_reason,'account_event_requires_reconciliation') END WHERE id=? AND EXISTS(SELECT 1 FROM ${source} WHERE ${fence}) AND (?=0 AND ${receiptSql} OR ${full})`).bind(...fullValues,b.id,...values,Number(isMessage),...receiptValues,...fullValues),
 ]);
 if(result[0].results.length)return {received:true,retried:false};
 const raced=await previous();if(raced){if(raced.body_hash!==hash||raced.binding_id!==b.id)throw new KidsError('This source event ID belongs to different content.',409);return {received:true,retried:true};}
 throw new KidsError('Source intake paused or its queue is full. Retry the same event; reconciliation is required.',503);
}
