import {env} from 'cloudflare:workers';
import {factSchema,KidsError,type Kids} from './kids';
import {validateSchoolAttendance} from './kids-school';
import {sourceFence,batchFence,sourceReconciliation,type BatchAuthority} from './kids-hosted-batch-state';
import {billingNowSql as clock} from './stripe-provider';
import type {z} from 'zod';
import {kidsMessageSourceKey,type KidsSourceKeys} from './kids-source-key';
type Message={id:string;chatId:string;fingerprint:string;facts:z.infer<typeof factSchema>[]|z.infer<typeof factSchema>|null};
type Prior={id:string;source_key:string;context_id:string;child_id:string};
export type SchoolSourceValue={id:string;sourceKey:string;contextId:string;childId:string;fingerprint:string;first:string;last:string;status:string;startTime:string;endTime:string;authority:string};
export async function guardSchoolSourceSupport(user:string,work:string,k:Kids,messages:Message[],a:BatchAuthority,sourceKeys:KidsSourceKeys){
 const d=env.DB!,keys=messages.map(m=>kidsMessageSourceKey(m.chatId,m.id,sourceKeys)),prior=(await d.prepare('SELECT id,source_key,context_id,child_id FROM kids_school_assertions WHERE owner_user_id=? AND workspace_id=? AND source_key IN ('+keys.map(()=>'?').join(',')+')').bind(user,work,...keys).all<Prior>()).results,unsupported:Prior[]=[];
 for(const m of messages){const facts=m.facts===null?[]:Array.isArray(m.facts)?m.facts:[m.facts],sourceKey=kidsMessageSourceKey(m.chatId,m.id,sourceKeys);
  for(const old of prior.filter(p=>p.source_key===sourceKey)){const c=k.contexts.find(c=>c.id===old.context_id),f=facts.find(f=>c?.key===f.kind+':'+[...f.childIds].sort().join(',')+':'+f.contextKey&&f.childIds.includes(old.child_id));if(!c||!f?.schoolAttendance)unsupported.push(old);}
 }
 if(unsupported.length){const f=sourceFence(user,work,a),b=batchFence(a);await d.batch(unsupported.map(p=>d.prepare(`INSERT INTO kids_school_issues(owner_user_id,workspace_id,batch_id,source_key,context_id,child_id,fingerprint,code,created_at) SELECT user_id,id,?,?,?,?,?,'attendance_support_missing',${clock} FROM kids_state WHERE ${f.sql} AND ${b.sql} ON CONFLICT(owner_user_id,workspace_id,source_key,context_id,child_id) DO UPDATE SET batch_id=excluded.batch_id,fingerprint=excluded.fingerprint,code=excluded.code,created_at=excluded.created_at,cleared_at=NULL WHERE kids_school_issues.batch_id IS NOT excluded.batch_id OR kids_school_issues.fingerprint IS NOT excluded.fingerprint OR kids_school_issues.cleared_at IS NOT NULL`).bind(a.batchId,p.source_key,p.context_id,p.child_id,messages.find(m=>kidsMessageSourceKey(m.chatId,m.id,sourceKeys)===p.source_key)!.fingerprint,...f.values,...b.values)));throw sourceReconciliation();}
}
export async function prepareSchoolSources(user:string,work:string,k:Kids,messages:Message[],a:BatchAuthority,sourceKeys:KidsSourceKeys){
 const out:SchoolSourceValue[]=[];
 for(const m of messages){const facts=m.facts===null?[]:Array.isArray(m.facts)?m.facts:[m.facts],sourceKey=kidsMessageSourceKey(m.chatId,m.id,sourceKeys);
  for(const f of facts){if(!f.schoolAttendance)continue;validateSchoolAttendance(f);const grant=k.grants.find(g=>g.enabled&&g.chatId===m.chatId);if(!grant||f.childIds.some(id=>!k.children.some(c=>c.id===id)||grant.childId&&id!==grant.childId))throw new KidsError('A school notice must match its confirmed child scope.',403);const c=k.contexts.find(c=>c.key===f.kind+':'+[...f.childIds].sort().join(',')+':'+f.contextKey);if(!c)throw sourceReconciliation();for(const child of f.childIds)out.push({id:crypto.randomUUID(),sourceKey,contextId:c.id,childId:child,fingerprint:m.fingerprint,first:f.date,last:f.schoolAttendance.through||f.date,status:f.schoolAttendance.status,startTime:f.schoolAttendance.startTime,endTime:f.schoolAttendance.endTime,authority:a.attendanceAuthority??'reported'});}
 }
 return out;
}
export function schoolSourceStatements(user:string,work:string,nonce:string,values:SchoolSourceValue[],sourceKeys:string[]){const d=env.DB!,active='EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?)',av=[user,work,nonce];return [
 d.prepare(`INSERT INTO kids_school_assertions(id,owner_user_id,workspace_id,source_key,context_id,child_id,fingerprint,first,last,status,start_time,end_time,authority,ignored,revision,updated_at) SELECT json_extract(v.value,'$.id'),?,?,json_extract(v.value,'$.sourceKey'),json_extract(v.value,'$.contextId'),json_extract(v.value,'$.childId'),json_extract(v.value,'$.fingerprint'),json_extract(v.value,'$.first'),json_extract(v.value,'$.last'),json_extract(v.value,'$.status'),json_extract(v.value,'$.startTime'),json_extract(v.value,'$.endTime'),json_extract(v.value,'$.authority'),0,1,${clock} FROM json_each(?) v WHERE ${active} ON CONFLICT(owner_user_id,workspace_id,source_key,context_id,child_id) DO UPDATE SET fingerprint=excluded.fingerprint,first=excluded.first,last=excluded.last,status=excluded.status,start_time=excluded.start_time,end_time=excluded.end_time,authority=excluded.authority,revision=kids_school_assertions.revision+1,updated_at=excluded.updated_at`).bind(user,work,JSON.stringify(values),...av),
 d.prepare(`UPDATE kids_school_issues SET cleared_at=${clock} WHERE owner_user_id=? AND workspace_id=? AND cleared_at IS NULL AND source_key IN (SELECT value FROM json_each(?)) AND ${active}`).bind(user,work,JSON.stringify(sourceKeys),...av),
 ];}
