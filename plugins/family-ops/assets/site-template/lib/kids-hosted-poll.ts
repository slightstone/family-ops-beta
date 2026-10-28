import {providerChat,connectionEpoch} from './kids-source-authority';
import {KidsError} from './kids';
import {billingNowSql as clock} from './stripe-provider';
import {sourceFence,sourceConflict,type SourceContext} from './kids-hosted-batch-state';
export const POLL_INTERVAL_MS=300000;
export const POLL_LIMITS={scans:10000,pages:60000,versions:100000,batches:100000} as const;
export const pollStorageSql=(binding:string)=>`(SELECT COUNT(*) FROM kids_hosted_history_scans WHERE binding_id=${binding})<${POLL_LIMITS.scans} AND (SELECT COUNT(*) FROM kids_hosted_history_pages WHERE scan_id IN (SELECT id FROM kids_hosted_history_scans WHERE binding_id=${binding}))<${POLL_LIMITS.pages} AND (SELECT COUNT(*) FROM kids_hosted_history_messages WHERE binding_id=${binding})<${POLL_LIMITS.versions} AND (SELECT COUNT(*) FROM kids_hosted_batches WHERE binding_id=${binding} AND source_kind='history')<${POLL_LIMITS.batches}`;
export async function pollStorageError(s:SourceContext):Promise<never>{
 const f=sourceFence(s.row.user_id,s.row.id,s.authority);
 await s.c.DB.prepare(`UPDATE kids_hosted_history_scans SET gap='poll_storage_limit' WHERE id=(SELECT id FROM kids_hosted_history_scans WHERE binding_id=? ORDER BY (chat_id=?) DESC,until DESC,rowid DESC LIMIT 1) AND gap IS NOT 'poll_storage_limit' AND EXISTS(SELECT 1 FROM kids_state WHERE ${f.sql})`).bind(s.b.id,providerChat(s.authority),...f.values).run();
 throw new KidsError('Private connection storage reached its beta limit. Earlier work is preserved; export, then review connection removal/reconnect to continue. No coverage advanced.',413,'POLL_STORAGE_LIMIT');
}
/** New scan only; immutable old operations are always resolved by collectKidsHistory first. */
export async function reservePollScan(s:SourceContext,authorityHash:string,authorityJson:string){
 const d=s.c.DB,f=sourceFence(s.row.user_id,s.row.id,s.authority),read=()=>d.prepare('SELECT * FROM kids_hosted_history_scans WHERE binding_id=? AND chat_id=? ORDER BY until DESC,rowid DESC LIMIT 1').bind(s.b.id,providerChat(s.authority)).first<{id:string;authority_hash:string;status:string;until:number}>();
 let latest=await read();
 if(latest?.status==='pending'){if(latest.authority_hash!==authorityHash)throw sourceConflict();return latest.id;}
 const time=await d.prepare(`SELECT ${clock} now`).first<{now:number}>();if(!time)throw sourceConflict();
 if(latest&&time.now<latest.until+POLL_INTERVAL_MS){if(latest.authority_hash!==authorityHash)throw sourceConflict();return latest.id;}
 const quota=await d.prepare(`SELECT 1 ok WHERE ${pollStorageSql('?')}`).bind(s.b.id,s.b.id,s.b.id,s.b.id).first();if(!quota)return pollStorageError(s);
 const id=crypto.randomUUID();await d.prepare(`INSERT INTO kids_hosted_history_scans(id,owner_user_id,workspace_id,binding_id,chat_id,authority_hash,authority_json,since,until,revision,page_count,seen_count,offset,status) SELECT ?,user_id,id,?,?,?,?,${clock}-604800000,${clock},1,0,0,0,'pending' FROM kids_state WHERE ${f.sql} AND NOT EXISTS(SELECT 1 FROM kids_hosted_history_scans WHERE binding_id=? AND chat_id=? AND status='pending') AND NOT EXISTS(SELECT 1 FROM kids_hosted_history_messages WHERE binding_id=? AND chat_id=? AND consumed_at IS NULL) AND NOT EXISTS(SELECT 1 FROM kids_hosted_batches WHERE binding_id=? AND chat_id=? AND COALESCE(app_chat_id,chat_id)=? AND connection_epoch=? AND status='ready' AND expires_at>${clock}) AND ${clock}>=COALESCE((SELECT MAX(until)+${POLL_INTERVAL_MS} FROM kids_hosted_history_scans WHERE binding_id=? AND chat_id=?),0) AND ${pollStorageSql('?')} ON CONFLICT DO NOTHING`).bind(id,s.b.id,providerChat(s.authority),authorityHash,authorityJson,...f.values,s.b.id,providerChat(s.authority),s.b.id,providerChat(s.authority),s.b.id,providerChat(s.authority),s.authority.chatId,connectionEpoch(s.authority),s.b.id,providerChat(s.authority),s.b.id,s.b.id,s.b.id,s.b.id).run();
 latest=await read();if(!latest||latest.status!=='pending'||latest.authority_hash!==authorityHash){if(!await d.prepare(`SELECT 1 ok WHERE ${pollStorageSql('?')}`).bind(s.b.id,s.b.id,s.b.id,s.b.id).first())return pollStorageError(s);throw sourceConflict();}return latest.id;
}
