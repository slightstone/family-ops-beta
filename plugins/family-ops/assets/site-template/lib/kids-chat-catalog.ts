import {z} from 'zod/v4';
import {KidsError} from './kids-error';
import {kidsHash} from './kids-hash';
import {kidsHostedSettings,verifyKidsHostedAccount,readKidsHostedProvider} from './kids-hosted-api';
import {KIDS_HOSTED_CONSENT} from './kids-hosted-config';
import {requireKidsService,kidsServiceGuard} from './kids-service';
import {connectionRemovalGuard} from './kids-hosted-removal-state';
import {catalogDb,catalogWorkspace,catalogBinding,catalogConnectionFence,catalogCanDiscover,readChatScan,publicChatScan,kidsChatMetadataHash,type ChatScan} from './kids-chat-catalog-state';

export const collectChatTitlesInput=z.object({operationId:z.string().uuid(),workspaceId:z.string().uuid(),baseRevision:z.number().int().min(1),bindingId:z.string().uuid().optional(),scanRevision:z.number().int().min(0),action:z.enum(['continue','restart']).default('continue'),scope:z.enum(['groups','all']).default('groups'),allTitlesConfirmed:z.boolean().default(false)}).strict();
export type ApprovedTitleProposal={proposalId:string;proposalHash:string};
type ScopeApproval={surface:'web';operationId:string}|({surface:'assistant';effectOperationId:string;effectHash:string}&ApprovedTitleProposal);
export const titlePageHash=(e:z.infer<typeof collectChatTitlesInput>,surface:'web'|'assistant')=>kidsHash(JSON.stringify(['kids-title-page-v1',e.workspaceId,e.baseRevision,e.scanRevision,e.action,e.scope,e.allTitlesConfirmed,surface,...(e.bindingId?['target',e.bindingId]:[])]));
const chat=z.object({object:z.literal('Chat'),id:z.string().min(1).max(180),name:z.string().trim().max(200).nullish(),provider:z.literal('whatsapp'),type:z.enum(['group','1to1','channel']),is_group:z.boolean(),is_1to1:z.boolean(),is_channel:z.boolean(),last_message_timestamp:z.unknown().optional()});
const page=z.object({data:z.array(z.unknown()).max(20),next_cursor:z.string().max(4000).optional(),total_count:z.number().int().min(0).optional()});
function failure(reason:string):never{console.warn('KIDS_TITLE_DISCOVERY_DIAGNOSTIC',JSON.stringify({code:reason}));throw new KidsError('This title page could not be confirmed ('+reason+'). Earlier titles and tracking choices are kept. Retry this same page or explicitly start a fresh scan.',503);}
const stamp=z.string().max(40).datetime({offset:true});

// The only provider title collector. Every request commits at most one page;
// all other catalog/recommendation operations read this minimized saved data.
export async function collectKidsChatTitles(user:string,input:unknown,surface:'web'|'assistant',approved?:ApprovedTitleProposal){
 const valid=collectChatTitlesInput.safeParse(input);if(!valid.success)throw new KidsError('Reopen chat setup to load the current title page.');const e=valid.data,db=catalogDb();
 const {row,kids}=await catalogWorkspace(user,e.workspaceId);
 const hash=await titlePageHash(e,surface);
 const retry=async()=>{
  const saved=await db.prepare('SELECT body_hash,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,row.id,e.operationId).first<{body_hash:string;source_authority:string|null}>();
  if(!saved)return null;
  if(saved.body_hash!==hash||!saved.source_authority)throw new KidsError('That retry belongs to another Kids change.',409);
  const receipt=z.object({kind:z.literal('kids-title-page-v1'),bindingId:z.string().uuid(),scan:z.unknown(),loaded:z.number().int().min(0).max(20),syncStatus:z.string()}).safeParse(JSON.parse(saved.source_authority));
  if(!receipt.success)throw new KidsError('That retry belongs to another Kids change.',409);
  return {savedOutcome:true,retried:true,...receipt.data,currentScan:publicChatScan(await readChatScan(receipt.data.bindingId)),providerCalls:0};
 };
 const prior=await retry();if(prior)return prior;let scanBinding='';
 try{
 if(row.revision!==e.baseRevision)throw new KidsError('Kids changed. Reopen its saved version before loading more titles.',409);
 if(kids.mode!=='live'||!kids.discoveryConsent)throw new KidsError('Confirm chat-title discovery in WhatsApp setup first.',403);
 if(await db.prepare('SELECT 1 ok FROM kids_hosted_batches WHERE owner_user_id=? AND workspace_id=? AND operation_id=? UNION ALL SELECT 1 ok FROM kids_hosted_history_pages WHERE owner_user_id=? AND workspace_id=? AND operation_id=? LIMIT 1').bind(user,row.id,e.operationId,user,row.id,e.operationId).first())throw new KidsError('Use a new operation ID; this one belongs to message collection.',409);
 const binding=await catalogBinding(user,row.id,kids,e.bindingId);catalogCanDiscover(binding);scanBinding=binding.id;
 const reservation=await db.prepare('SELECT proposal_id FROM kids_source_proposals WHERE owner_user_id=? AND ? IN (proposal_id,stage_operation_id,effect_operation_id)').bind(user,e.operationId).first();
 if(reservation&&!approved)throw new KidsError('This operation belongs to an exact saved source proposal.',409);
 const c=await kidsHostedSettings(),scan=await readChatScan(binding.id);
 if(!binding.active||binding.removed_at!==null||binding.application_id!==c.UNIPILE_APPLICATION_ID||binding.production!==Number(c.UNIPILE_ENVIRONMENT==='production')||binding.endpoint_id!==c.channelId||binding.consent_version!==KIDS_HOSTED_CONSENT||!/^[a-f0-9]{64}$/.test(binding.provider_identity_hash))throw new KidsError('Verify this WhatsApp connection before loading titles.',409);
 if((scan?.revision??0)!==e.scanRevision)throw new KidsError('The title scan changed. Reopen its saved status before continuing.',409);
 const restart=e.action==='restart',newScan=!scan||restart,scopeApproved=scan?.scope==='all'&&scan.epoch===row.epoch&&scan.binding_revision===binding.revision&&scan.config_hash===c.fingerprint;
 const verifyProposal=async(proof:ScopeApproval&{surface:'assistant'},originHash:string,operation:string)=>{
  const p=await db.prepare("SELECT payload_json,effect_hash,status FROM kids_source_proposals WHERE owner_user_id=? AND workspace_id=? AND proposal_id=? AND proposal_hash=? AND effect_operation_id=?").bind(user,row.id,proof.proposalId,proof.proposalHash,operation).first<{payload_json:string;effect_hash:string;status:string}>();
  if(!p||p.status!=='approved'||p.effect_hash!==originHash||proof.effectHash!==originHash||proof.effectOperationId!==operation)throw new KidsError('Review this account’s broader title scope again.',403);
  const payload=JSON.parse(p.payload_json),command=collectChatTitlesInput.safeParse(payload.command),cc=binding.connection;
  if(payload.kind!=='titles'||payload.change.action!=='include-direct-titles'||!command.success||command.data.bindingId!==binding.id||command.data.scope!=='all'||!command.data.allTitlesConfirmed||command.data.operationId!==operation||command.data.workspaceId!==row.id||await titlePageHash(command.data,'assistant')!==originHash||!cc||payload.change.connection.id!==cc.id||payload.change.connection.revision!==cc.revision||payload.change.connection.sourceEpoch!==cc.source_epoch)throw new KidsError('Review this account’s broader title scope again.',403);
  return command.data;
 };
 let scopeApproval:ScopeApproval|undefined;
 if(approved){
  if(surface!=='assistant'||e.scope!=='all'||!e.allTitlesConfirmed)throw new KidsError('This title approval does not match the requested page.',403);
  scopeApproval={surface:'assistant',...approved,effectOperationId:e.operationId,effectHash:hash};
  if(JSON.stringify(await verifyProposal(scopeApproval,hash,e.operationId))!==JSON.stringify(e))throw new KidsError('This title approval changed.',409);
 }else if(e.scope==='all'){
  if(surface==='web'&&e.allTitlesConfirmed)scopeApproval={surface:'web',operationId:e.operationId};
  else{
   if(!scopeApproved||surface==='assistant'&&restart)throw new KidsError('Review and approve group and one-to-one title discovery before starting this scan. No broader titles were collected.',403);
   const first=await db.prepare('SELECT r.operation_id,r.body_hash,r.committed_revision,r.source_authority FROM kids_chat_scan_pages p JOIN kids_operation_receipts r ON r.operation_id=p.operation_id AND r.owner_user_id=? AND r.workspace_id=? WHERE p.binding_id=? AND p.generation=? ORDER BY p.rowid LIMIT 1').bind(user,row.id,binding.id,scan!.generation).first<{operation_id:string;body_hash:string;committed_revision:number;source_authority:string}>();
   if(!first)throw new KidsError('This title scan has no confirmed approval history. Review its scope again.',403);
   const firstAuthority=JSON.parse(first.source_authority);scopeApproval=firstAuthority.scopeApproval??(scan!.approval_surface==='web'?{surface:'web',operationId:first.operation_id}:undefined);
   if(!scopeApproval)throw new KidsError('This title scan has no confirmed approval history. Review its scope again.',403);
   const op=scopeApproval.surface==='web'?scopeApproval.operationId:scopeApproval.effectOperationId;
   const origin=op===first.operation_id?first:await db.prepare('SELECT operation_id,body_hash,committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,row.id,op).first<typeof first>();
   if(!origin)throw new KidsError('This title scan’s approval could not be confirmed.',403);
   for(const receipt of [first,origin]){const a=JSON.parse(receipt.source_authority);if(a.kind!=='kids-title-page-v1'||a.bindingId!==binding.id||a.scan.scope!=='all'||a.epoch!==row.epoch||a.bindingRevision!==binding.revision||a.configHash!==c.fingerprint)throw new KidsError('This title scan’s authority changed. Review its scope again.',403);}
   if(firstAuthority.scan.generation!==scan!.generation)throw new KidsError('This title scan’s generation changed.',403);
   if(scopeApproval.surface==='assistant')await verifyProposal(scopeApproval,origin.body_hash,op);
   else{
    const a=JSON.parse(origin.source_authority);let matched=false;
    for(const action of ['continue','restart'] as const)for(const target of [undefined,binding.id])if(await titlePageHash({...e,operationId:op,baseRevision:origin.committed_revision,scanRevision:a.scan.revision-1,action,allTitlesConfirmed:true,...(target?{bindingId:target}:{bindingId:undefined})},'web')===origin.body_hash)matched=true;
    if(!matched)throw new KidsError('This title scan has no explicit broader-title approval.',403);
   }
  }
 }
 if(scan&&!restart&&(scan.scope!==e.scope||scan.epoch!==row.epoch||scan.binding_revision!==binding.revision||scan.config_hash!==c.fingerprint))throw new KidsError('Your interview or connection changed. Explicitly refresh the title scan; saved names and choices are kept.',409);
 const service=await requireKidsService(user,row.id,false);
 if(scan&&!restart&&scan.status!=='partial')return {savedOutcome:false,noCollection:true,bindingId:binding.id,scan:publicChatScan(scan),currentScan:publicChatScan(scan),providerCalls:0};
 const generation=newScan?(scan?.generation??0)+1:scan!.generation,offset=newScan?0:scan!.offset,cursor=newScan?null:scan!.cursor,totalBefore=newScan?null:scan!.total_count;
 const positionHash=await kidsHash(JSON.stringify(cursor?['cursor',cursor]:['offset',offset]));
 if(await db.prepare('SELECT 1 ok FROM kids_chat_scan_pages WHERE binding_id=? AND generation=? AND position_hash=?').bind(binding.id,generation,positionHash).first())failure('repeated_position');
 let syncStatus:string,raw:unknown;
 try{({sync:syncStatus}=await verifyKidsHostedAccount(c,{accountId:binding.account_id,applicationId:binding.application_id,scopeId:binding.scope_id,identityHash:binding.provider_identity_hash}));}
 catch{failure('account_unconfirmed');}
 const query=new URLSearchParams({limit:'20',...(e.scope==='groups'?{type:'group'}:{})});if(cursor)query.set('cursor',cursor);else query.set('offset',String(offset));
 try{raw=await readKidsHostedProvider(c,'/v2/'+encodeURIComponent(binding.account_id)+'/chats?'+query);}
 catch(error){const message=error instanceof Error?error.message:'';failure(/^PROVIDER_(HTTP_[1-5][0-9]{2}|TIMEOUT|NETWORK|RESPONSE_TOO_LARGE|RESPONSE_MISSING|RESPONSE_INVALID)$/.test(message)?message.slice(9).toLowerCase():'page_unconfirmed');}
 const p=page.safeParse(raw);if(!p.success)failure('page_schema');
 const values:{id:string;title:string;kind:'group'|'1to1'|'channel';lastActivity:string;metadataHash:string}[]=[],ids=new Set<string>();
 for(const value of p.data.data){const r=chat.safeParse(value);if(!r.success)failure('chat_schema');const v=r.data;
  if(v.is_group!==(v.type==='group')||v.is_1to1!==(v.type==='1to1')||v.is_channel!==(v.type==='channel'))failure('chat_flags');
  if(e.scope==='groups'&&v.type!=='group')failure('outside_title_scope');
  if(ids.has(v.id))failure('duplicate_chat');ids.add(v.id);
  if(v.type==='channel')continue;
  const item={id:v.id,title:v.name??'',kind:v.type,lastActivity:stamp.safeParse(v.last_message_timestamp).success?v.last_message_timestamp as string:''};
  values.push({...item,metadataHash:await kidsChatMetadataHash(binding.id,item)});
 }
 const total=p.data.total_count??totalBefore,nextOffset=offset+p.data.data.length,nextCursor=p.data.next_cursor||null;
 if(totalBefore!==null&&p.data.total_count!==undefined&&totalBefore!==p.data.total_count)failure('total_changed');
 if(total!==null&&nextOffset>total)failure('total_overrun');
 if(nextCursor){const nextHash=await kidsHash(JSON.stringify(['cursor',nextCursor]));if(!p.data.data.length||nextHash===positionHash||await db.prepare('SELECT 1 ok FROM kids_chat_scan_pages WHERE binding_id=? AND generation=? AND position_hash=?').bind(binding.id,generation,nextHash).first())failure('cursor_loop');if(total!==null&&nextOffset>=total)failure('cursor_total_conflict');}
 let seen=0;if(values.length)seen=(await db.prepare('SELECT COUNT(*) count FROM kids_chat_catalog WHERE binding_id=? AND seen_generation=? AND chat_id IN (SELECT json_extract(value,\'$.id\') FROM json_each(?))').bind(binding.id,generation,JSON.stringify(values)).first<{count:number}>())?.count??0;
 if(values.length&&seen===values.length)failure('repeated_page');
 if(seen)failure('overlapping_page');
 const priorCount=(await db.prepare('SELECT COUNT(*) count FROM kids_chat_catalog WHERE binding_id=? AND seen_generation=?').bind(binding.id,generation).first<{count:number}>())?.count??0;
 const excluded=p.data.data.length-values.length,priorExcluded=newScan?0:(await db.prepare('SELECT COALESCE(SUM(excluded_count),0) count FROM kids_chat_scan_pages WHERE binding_id=? AND generation=?').bind(binding.id,generation).first<{count:number}>())?.count??0,count=priorCount+values.length+priorExcluded+excluded;
 if(total!==null&&nextOffset===total&&count!==total)failure('distinct_total_mismatch');
 if(!p.data.data.length&&total!==null&&nextOffset<total)failure('pagination_unavailable');
 const status:ChatScan['status']=total!==null&&nextOffset===total&&!nextCursor?'complete':!p.data.data.length&&!nextCursor?'unconfirmed_end':'partial';
 const nonce=crypto.randomUUID(),next:ChatScan={binding_id:binding.id,revision:(scan?.revision??0)+1,generation,binding_revision:binding.revision,epoch:row.epoch,config_hash:c.fingerprint,scope:e.scope,approval_surface:scopeApproval?.surface??surface,offset:nextOffset,cursor:nextCursor,total_count:total,status,updated_at:Date.now(),last_write_nonce:nonce};
 const removal=connectionRemovalGuard(binding.id),permission=kidsServiceGuard(service),connection=catalogConnectionFence(binding.id,binding.connection),guard=`EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND revision=? AND epoch=? AND json_extract(document,'$.mode')='live' AND json_extract(document,'$.discoveryConsent')=1 AND ${connection.sql} AND ${permission.sql} AND ${removal.sql} AND EXISTS(SELECT 1 FROM kids_hosted_bindings b WHERE b.id=? AND b.owner_user_id=kids_state.user_id AND b.workspace_id=kids_state.id AND b.active=1 AND b.removed_at IS NULL AND b.revision=? AND b.application_id=? AND b.production=? AND b.endpoint_id=? AND b.scope_id=? AND b.account_id=? AND b.provider_identity_hash=? AND b.consent_version=?))`,guardValues=[user,row.id,row.revision,row.epoch,...connection.values,...permission.values,...removal.values,binding.id,binding.revision,binding.application_id,binding.production,binding.endpoint_id,binding.scope_id,binding.account_id,binding.provider_identity_hash,KIDS_HOSTED_CONSENT];
 const noReceipt='NOT EXISTS(SELECT 1 FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?)';
 const fields=['revision','generation','binding_revision','epoch','config_hash','scope','approval_surface','offset','cursor','total_count','status','updated_at','last_write_nonce'] as const,fieldValues=fields.map(key=>next[key]);
 const save=scan?db.prepare(`UPDATE kids_chat_scans SET ${fields.map(f=>f+'=?').join(',')} WHERE binding_id=? AND revision=? AND ${guard} AND ${noReceipt} RETURNING *`).bind(...fieldValues,binding.id,scan.revision,...guardValues,user,row.id,e.operationId):db.prepare(`INSERT INTO kids_chat_scans(binding_id,${fields.join(',')}) SELECT ?,${fields.map(()=>'?').join(',')} WHERE ${guard} AND ${noReceipt} ON CONFLICT(binding_id) DO NOTHING RETURNING *`).bind(binding.id,...fieldValues,...guardValues,user,row.id,e.operationId);
 const active='EXISTS(SELECT 1 FROM kids_chat_scans WHERE binding_id=? AND last_write_nonce=?)',receipt={kind:'kids-title-page-v1',bindingId:binding.id,scan:publicChatScan(next),loaded:values.length,excludedChannels:excluded,syncStatus:syncStatus!,epoch:row.epoch,bindingRevision:binding.revision,service,configHash:c.fingerprint,...(scopeApproval?{scopeApproval}:{})};
 const result=await db.batch([
  save,
  db.prepare(`INSERT INTO kids_chat_catalog(binding_id,chat_id,title,kind,last_activity,metadata_hash,seen_generation,updated_at) SELECT ?,json_extract(value,'$.id'),json_extract(value,'$.title'),json_extract(value,'$.kind'),json_extract(value,'$.lastActivity'),json_extract(value,'$.metadataHash'),?,? FROM json_each(?) WHERE ${active} ON CONFLICT(binding_id,chat_id) DO UPDATE SET title=excluded.title,kind=excluded.kind,last_activity=excluded.last_activity,metadata_hash=excluded.metadata_hash,seen_generation=excluded.seen_generation,updated_at=excluded.updated_at`).bind(binding.id,generation,next.updated_at,JSON.stringify(values),binding.id,nonce),
  db.prepare(`INSERT INTO kids_chat_scan_pages(binding_id,generation,position_hash,raw_count,operation_id,excluded_count) SELECT ?,?,?,?,?,? WHERE ${active}`).bind(binding.id,generation,positionHash,p.data.data.length,e.operationId,excluded,binding.id,nonce),
  db.prepare(`INSERT INTO kids_operation_receipts(owner_user_id,workspace_id,operation_id,body_hash,committed_revision,created_at,source_authority) SELECT ?,?,?,?,?,?,? WHERE ${active}`).bind(user,row.id,e.operationId,hash,row.revision,next.updated_at,JSON.stringify(receipt),binding.id,nonce),
 ]);
 if(!result[0].results.length){const raced=await retry();if(raced)return raced;throw new KidsError('The title scan, Kids choices or source permission changed. Reopen before continuing.',409);}
 return {savedOutcome:true,retried:false,bindingId:binding.id,scan:publicChatScan(next),currentScan:publicChatScan(next),loaded:values.length,syncStatus:syncStatus!,providerCalls:2};
 }catch(error){
  // A concurrent exact request can commit while this request is validating
  // the same provider page. Return its outcome even if a later seen-row check
  // observes that commit; never turn saved success into a false page failure.
  const raced=await retry();if(raced)return raced;
  const current=scanBinding?await readChatScan(scanBinding):null;
  if(current&&current.revision!==e.scanRevision)throw new KidsError('The title scan changed while this page was loading. Reopen its saved status; earlier titles are kept.',409);
  throw error;
 }
}
