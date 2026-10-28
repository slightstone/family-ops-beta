import {env} from 'cloudflare:workers';
import {z} from 'zod/v4';
import {checkedKids,kidsNeedsUpgrade,type Kids} from './kids';
import {KidsError} from './kids-error';
import {kidsHash} from './kids-hash';
import {kidsAppChatId,type KidsSourceConnection,type KidsChatSource} from './kids-source-connections';

export type ChatScan={binding_id:string;revision:number;generation:number;binding_revision:number;epoch:number;config_hash:string;scope:'groups'|'all';approval_surface:'web'|'assistant';offset:number;cursor:string|null;total_count:number|null;status:'partial'|'complete'|'unconfirmed_end';updated_at:number;last_write_nonce:string};
export type CatalogRow={sequence:number;binding_id:string;chat_id:string;title:string;kind:'group'|'1to1'|'channel';last_activity:string;metadata_hash:string;seen_generation:number;updated_at:number};
export type CatalogBinding={id:string;owner_user_id:string;workspace_id:string;revision:number;active:number;removed_at:number|null;application_id:string;production:number;endpoint_id:string;scope_id:string;account_id:string;provider_identity_hash:string;consent_version:string;connection?:KidsSourceConnection|null};
export type CatalogWorkspace={user_id:string;id:string;revision:number;document:string;operations:string;epoch:number};
export const catalogDb=()=>{const c=env as unknown as {DB:D1Database};if(!c.DB)throw new KidsError('Chat-title storage is unavailable.',503);return c.DB;};
export const kidsRelevanceProfileHash=(k:Kids)=>kidsHash(JSON.stringify(['kids-relevance-profile-v1',k.children,k.language,k.exclusions]));
export const kidsChatMetadataHash=(binding:string,v:{id:string;title:string;kind:string;lastActivity:string})=>kidsHash(JSON.stringify(['kids-chat-title-v1',binding,v.id,v.title,v.kind,v.lastActivity]));
export async function catalogWorkspace(user:string,workspace:string){
 const row=await catalogDb().prepare('SELECT * FROM kids_state WHERE user_id=? AND id=?').bind(user,workspace).first<CatalogWorkspace>();
 if(!row)throw new KidsError('Open your current Kids workspace before reviewing chat titles.',404);
 const kids=checkedKids(JSON.parse(row.document));if(kidsNeedsUpgrade(kids,row.operations))throw new KidsError('Finish the saved Kids storage upgrade before reviewing chat titles.',503);
 return {row,kids};
}
export async function catalogBinding(user:string,workspace:string,k:Kids,bindingId?:string){
 const db=catalogDb(),connections=(await db.prepare('SELECT * FROM kids_source_connections WHERE owner_user_id=? AND workspace_id=?').bind(user,workspace).all<KidsSourceConnection>()).results;
 if(connections.length){
  const available=connections.filter(c=>c.status!=='removed'&&c.binding_id),target=bindingId?connections.find(c=>c.binding_id===bindingId):available.length===1?available[0]:undefined;
  if(!target?.binding_id)throw new KidsError('Choose the exact saved WhatsApp connection for these titles.',409);
  const b=await db.prepare('SELECT * FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND id=?').bind(user,workspace,target.binding_id).first<CatalogBinding>();
  if(!b||target.id!==b.id)throw new KidsError('This saved connection identity needs review.',409);
  return {...b,connection:target};
 }
 const current=k.connection.accountId.startsWith('hosted:')?k.connection.accountId.slice(7):'';
 if(k.connection.accountId&&!current||current&&bindingId&&bindingId!==current)throw new KidsError('This title list belongs to another WhatsApp connection. Open your current connection’s titles.',409);
 if(current?k.connection.selfUserId!=='hosted-self:'+current:!!k.connection.selfUserId)throw new KidsError('Check the verified identity of this WhatsApp connection.',409);
 if(current){const saved=await db.prepare('SELECT * FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND id=?').bind(user,workspace,current).first<CatalogBinding>();if(saved&&saved.removed_at!==null)return {...saved,connection:null};}
 const initial=(await db.prepare('SELECT * FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=? AND removed_at IS NULL LIMIT 2').bind(user,workspace).all<CatalogBinding>()).results;
 if(initial.length!==1||bindingId&&initial[0].id!==bindingId||current&&initial[0].id!==current)throw new KidsError('No single current WhatsApp connection can be confirmed. Check connection setup.',409);
 return {...initial[0],connection:null};
}
export const catalogConnectionFence=(bindingId:string,connection?:KidsSourceConnection|null)=>connection?{
 sql:"EXISTS(SELECT 1 FROM kids_source_connections cc WHERE cc.owner_user_id=kids_state.user_id AND cc.workspace_id=kids_state.id AND cc.id=? AND cc.binding_id=? AND cc.status='connected' AND cc.revision=? AND cc.source_epoch=? AND cc.discovery_consent=1 AND cc.paused=0)",values:[bindingId,bindingId,connection.revision,connection.source_epoch],
}:{sql:"NOT EXISTS(SELECT 1 FROM kids_source_connections cc WHERE cc.owner_user_id=kids_state.user_id AND cc.workspace_id=kids_state.id) AND ((json_extract(kids_state.document,'$.connection.accountId')=? AND json_extract(kids_state.document,'$.connection.selfUserId')=?) OR (json_extract(kids_state.document,'$.connection.accountId')='' AND json_extract(kids_state.document,'$.connection.selfUserId')='' AND (SELECT COUNT(*) FROM kids_hosted_bindings cb WHERE cb.owner_user_id=kids_state.user_id AND cb.workspace_id=kids_state.id AND cb.removed_at IS NULL)=1))",values:['hosted:'+bindingId,'hosted-self:'+bindingId]};
export function catalogCanDiscover(b:CatalogBinding){if(b.connection&&(b.connection.status!=='connected'||b.connection.paused||!b.connection.discovery_consent))throw new KidsError('Review this WhatsApp connection’s title-discovery permission first.',403);}
// Public prepared IDs are application identities; metadataHash binds the raw catalog row.
// This planner is pure. Only the staging transaction inserts its missing trusted maps.
export async function catalogSourceMaps(user:string,workspace:string,b:CatalogBinding,rows:CatalogRow[]){
 const ids=new Map<string,string>(),missing:KidsChatSource[]=[];
 if(!b.connection){for(const row of rows)ids.set(row.chat_id,row.chat_id);return {ids,missing};}
 const db=catalogDb(),raws=JSON.stringify(rows.map(r=>r.chat_id)),maps=(await db.prepare('SELECT * FROM kids_chat_sources WHERE owner_user_id=? AND workspace_id=? AND binding_id=? AND provider_chat_id IN (SELECT value FROM json_each(?))').bind(user,workspace,b.id,raws).all<KidsChatSource>()).results;
 for(const row of rows){const old=maps.find(m=>m.provider_chat_id===row.chat_id),app=old?.app_chat_id??await kidsAppChatId(b.id,row.chat_id);
  if(old&&(old.binding_id!==b.id||old.identity_kind==='legacy'&&app!==row.chat_id||old.identity_kind==='namespaced'&&app!==await kidsAppChatId(b.id,row.chat_id)))throw new KidsError('This saved chat identity needs reconciliation.',409);
  ids.set(row.chat_id,app);if(!old)missing.push({owner_user_id:user,workspace_id:workspace,app_chat_id:app,binding_id:b.id,provider_chat_id:row.chat_id,identity_kind:'namespaced',created_at:Date.now()});
 }
 if(missing.length){const collisions=(await db.prepare('SELECT * FROM kids_chat_sources WHERE owner_user_id=? AND workspace_id=? AND app_chat_id IN (SELECT value FROM json_each(?))').bind(user,workspace,JSON.stringify(missing.map(m=>m.app_chat_id))).all<KidsChatSource>()).results;if(collisions.length)throw new KidsError('This chat identity conflicts with saved source history.',409);}
 return {ids,missing};
}
export const readChatScan=(binding:string)=>catalogDb().prepare('SELECT * FROM kids_chat_scans WHERE binding_id=?').bind(binding).first<ChatScan>();
export const publicChatScan=(s:ChatScan|null)=>s?{revision:s.revision,generation:s.generation,scope:s.scope,status:s.status,consumed:s.offset,reportedTotal:s.total_count,updatedAt:s.updated_at,canLoadMore:s.status==='partial'}:{revision:0,generation:0,scope:'groups' as const,status:'not_started' as const,consumed:0,reportedTotal:null,updatedAt:null,canLoadMore:true};
export const catalogReadInput=z.object({workspace_id:z.string().uuid(),binding_id:z.string().uuid().optional(),search:z.string().trim().max(100).default(''),type:z.enum(['groups','direct','all']).default('groups'),cursor:z.string().max(2000).optional(),limit:z.number().int().min(1).max(40).default(20)}).strict();
const cursorSchema=z.object({v:z.literal(1),binding:z.string().uuid(),generation:z.number().int().min(0),revision:z.number().int().min(0),query:z.string().regex(/^[a-f0-9]{64}$/),after:z.number().int().min(0),proof:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const encode=(v:z.infer<typeof cursorSchema>)=>btoa(JSON.stringify(v)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function decode(v:string){try{return cursorSchema.parse(JSON.parse(atob(v.replace(/-/g,'+').replace(/_/g,'/'))));}catch{throw new KidsError('This saved-title page link is invalid. Reopen the list.',400);}}

// Pure cache read: never obtains credentials, contacts the provider or creates a scan.
export async function getKidsChatCatalog(user:string,input:unknown){
 const parsed=catalogReadInput.safeParse(input);if(!parsed.success)throw new KidsError('Check the saved chat-title filters.');const e=parsed.data;
 const {row,kids}=await catalogWorkspace(user,e.workspace_id),binding=await catalogBinding(user,row.id,kids,e.binding_id),scan=await readChatScan(binding.id),revision=scan?.revision??0,generation=scan?.generation??0;
 const queryHash=await kidsHash(JSON.stringify(['kids-title-cache-v1',user,row.id,binding.id,e.search,e.type]));
 const proof=async(after:number)=>{const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(scan?.last_write_nonce??'empty-title-list'),{name:'HMAC',hash:'SHA-256'},false,['sign']);return [...new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['kids-title-cursor-v1',user,row.id,binding.id,generation,revision,queryHash,after]))))].map(v=>v.toString(16).padStart(2,'0')).join('');};
 const cursor=e.cursor?decode(e.cursor):null;
 if(cursor&&(cursor.binding!==binding.id||cursor.generation!==generation||cursor.revision!==revision||cursor.query!==queryHash))throw new KidsError('The title list changed. Reopen its first page; your saved choices are kept.',409);
 if(cursor&&cursor.proof!==await proof(cursor.after))throw new KidsError('This saved-title page link is invalid. Reopen the list.',400);
 const filter="binding_id=? AND kind IN ('group','1to1') AND (?='all' OR kind=?) AND instr(lower(title),lower(?))>0",args=[binding.id,e.type,e.type==='direct'?'1to1':'group',e.search];
 const [names,count,total,excluded]=await Promise.all([
  catalogDb().prepare(`SELECT * FROM kids_chat_catalog WHERE ${filter} AND sequence>? ORDER BY sequence LIMIT ?`).bind(...args,cursor?.after??0,e.limit+1).all<CatalogRow>(),
  catalogDb().prepare(`SELECT COUNT(*) count FROM kids_chat_catalog WHERE ${filter}`).bind(...args).first<{count:number}>(),
  catalogDb().prepare("SELECT COUNT(*) count,SUM(CASE WHEN seen_generation=? THEN 1 ELSE 0 END) current_count FROM kids_chat_catalog WHERE binding_id=? AND kind IN ('group','1to1')").bind(generation,binding.id).first<{count:number;current_count:number|null}>(),
  catalogDb().prepare('SELECT COALESCE(SUM(excluded_count),0) count FROM kids_chat_scan_pages WHERE binding_id=? AND generation=?').bind(binding.id,generation).first<{count:number}>(),
 ]);
 const current=await readChatScan(binding.id);if((current?.revision??0)!==revision)throw new KidsError('More titles were saved while this page opened. Reopen the title list; your choices are kept.',409);
 const rows=names.results.slice(0,e.limit),profileHash=await kidsRelevanceProfileHash(kids),mapped=await catalogSourceMaps(user,row.id,binding,rows);
 const after=await catalogWorkspace(user,row.id),afterBinding=await catalogBinding(user,row.id,after.kids,binding.id),afterScan=await readChatScan(binding.id);if(after.row.revision!==row.revision||(afterScan?.revision??0)!==revision||JSON.stringify(afterBinding)!==JSON.stringify(binding))throw new KidsError('Your board, connection or title list changed while opening. Reopen the saved list.',409);
 return {workspaceId:row.id,boardRevision:row.revision,bindingId:binding.id,accountAlias:'hosted:'+binding.id,profileHash,scan:publicChatScan(scan),needsRefresh:!!scan&&(scan.binding_revision!==binding.revision||scan.epoch!==row.epoch),cachedCount:total?.count??0,currentGenerationCount:total?.current_count??0,matchingCount:count?.count??0,
  titles:rows.map(v=>{const appId=mapped.ids.get(v.chat_id)!,c=kids.candidates.find(c=>c.id===appId&&c.accountId==='hosted:'+binding.id),g=c?kids.grants.find(g=>g.chatId===appId):undefined;return {id:appId,bindingId:binding.id,title:v.title||'Unnamed WhatsApp chat',titleAvailable:!!v.title,kind:v.kind,lastActivity:v.last_activity,metadataHash:v.metadata_hash,generation:v.seen_generation,current:v.seen_generation===generation,selectable:v.kind!=='channel'&&!!v.title,decision:c?.decision??null,childId:c?.childId??'',tracked:!!g?.enabled,inReview:!!c};}),
  nextCursor:names.results.length>e.limit&&rows.length?encode({v:1,binding:binding.id,generation,revision,query:queryHash,after:rows.at(-1)!.sequence,proof:await proof(rows.at(-1)!.sequence)}):null,
  providerCalls:0,excludedChannels:excluded?.count??0,coverage:(scan?.status==='complete'?'The provider reported the end of this title scan. This does not establish message coverage.':scan?.status==='unconfirmed_end'?'The provider returned no more titles without confirming a total. Coverage remains unconfirmed.':'Only loaded chat titles are searched. More titles may remain on WhatsApp.')+(excluded?.count?` ${excluded.count} channel records were excluded; only group and one-to-one titles are saved.`:''),
  privacy:'Titles and basic chat flags only. No messages, previews, participants, attachments or source grants are returned or changed.',
 };
}

export async function exportKidsChatCatalog(user:string,workspace:string){
 const db=catalogDb(),where='binding_id IN (SELECT id FROM kids_hosted_bindings WHERE owner_user_id=? AND workspace_id=?)';
 const scans=(await db.prepare(`SELECT binding_id,revision,generation,binding_revision,epoch,scope,approval_surface,offset,total_count,status,updated_at FROM kids_chat_scans WHERE ${where} ORDER BY binding_id`).bind(user,workspace).all()).results;
 const titles=(await db.prepare(`SELECT sequence,binding_id,chat_id,title,kind,last_activity,metadata_hash,seen_generation,updated_at FROM kids_chat_catalog WHERE ${where} ORDER BY sequence`).bind(user,workspace).all()).results;
 const after=(await db.prepare(`SELECT binding_id,revision,generation,binding_revision,epoch,scope,approval_surface,offset,total_count,status,updated_at FROM kids_chat_scans WHERE ${where} ORDER BY binding_id`).bind(user,workspace).all()).results;
 if(JSON.stringify(scans)!==JSON.stringify(after))throw new KidsError('The title catalog changed while exporting. Retry to export one saved version.',409);
 return {version:1,scans,titles};
}
