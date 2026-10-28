import {env} from 'cloudflare:workers';
import {z} from 'zod';
import {KidsError,type Kids} from './kids';
import {kidsHash} from './kids-hash';

export type KidsNotice={version:string;acknowledgedAt:string|null;clearedAt:string|null;updated:boolean;lastActionId:string|null};
type Tuple={exists:boolean;version:string;acknowledgedAt:string|null;clearedAt:string|null;lastActionId:string|null};
type Stored={context_id:string;version:string;acknowledged_at:string|null;cleared_at:string|null;last_parent_operation_id:string};
const d=()=>{if(!env.DB)throw new KidsError('Kids storage is unavailable. Your earlier work is unchanged.',503);return env.DB;};
// The exact SQL JSON is hashed and fenced; caller cannot supply this proof.
const proofRows=`SELECT DISTINCT l.context_id,r.source_key,r.fingerprint FROM kids_source_links l JOIN kids_source_records r ON r.owner_user_id=l.owner_user_id AND r.workspace_id=l.workspace_id AND r.source_key=l.source_key WHERE l.owner_user_id=? AND l.workspace_id=? AND l.task_id=''`;
export const noticeProofSql=`(SELECT json_group_array(json_array(source_key,fingerprint)) FROM (${proofRows} AND l.context_id=? ORDER BY r.source_key COLLATE BINARY,r.fingerprint COLLATE BINARY))`;
const stored=(r:Stored):Tuple=>({exists:true,version:r.version,acknowledgedAt:r.acknowledged_at,clearedAt:r.cleared_at,lastActionId:r.last_parent_operation_id});
const empty=(version:string):Tuple=>({exists:false,version,acknowledgedAt:null,clearedAt:null,lastActionId:null});
export async function kidsNoticeProjection(user:string,workspace:string){
 const rows=(await d().prepare(`SELECT context_id,json_group_array(json_array(source_key,fingerprint)) proof FROM (${proofRows} ORDER BY l.context_id COLLATE BINARY,r.source_key COLLATE BINARY,r.fingerprint COLLATE BINARY) GROUP BY context_id`).bind(user,workspace).all<{context_id:string;proof:string}>()).results;
 const reviews=(await d().prepare('SELECT * FROM kids_notice_reviews WHERE owner_user_id=? AND workspace_id=?').bind(user,workspace).all<Stored>()).results;
 const entries=await Promise.all(rows.map(async r=>{const version=await kidsHash(r.proof),old=reviews.find(x=>x.context_id===r.context_id),same=old?.version===version;return [r.context_id,{version,acknowledgedAt:same?old.acknowledged_at:null,clearedAt:same?old.cleared_at:null,updated:!!old&&!same,lastActionId:old?.last_parent_operation_id??null} satisfies KidsNotice] as const;}));
 const board=await d().prepare('SELECT document FROM kids_state WHERE user_id=? AND id=?').bind(user,workspace).first<{document:string}>();
 if(board)for(const c of (JSON.parse(board.document) as Kids).contexts){const p=c.parentEntry;if(!p)continue;const version=await kidsHash(JSON.stringify([c.id,c.title,c.childIds,c.date,c.event,c.notes,c.tasks.map(t=>[t.id,t.title,t.childId,t.due]),p.category]));entries.push([c.id,{version,acknowledgedAt:p.acknowledgedAt,clearedAt:p.archivedAt,updated:false,lastActionId:p.lastReviewOperation}]);}
 return Object.fromEntries(entries);
}
const input=z.object({contextId:z.string().uuid(),version:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(['acknowledge','unacknowledge','clear','restore','undo']),undoOperationId:z.string().uuid().optional()}).strict();
const tuple=z.object({exists:z.boolean(),version:z.string().regex(/^[a-f0-9]{64}$/),acknowledgedAt:z.string().nullable(),clearedAt:z.string().nullable(),lastActionId:z.string().uuid().nullable()}).strict();
const receiptSchema=z.object({kind:z.literal('parent-notice-review-v1'),contextId:z.string().uuid(),version:z.string(),proof:z.string(),action:z.string(),before:tuple,after:tuple,undoOperationId:z.string().uuid().optional()}).strict();
export type NoticeChange={contextId:string;proof:string;value:Tuple;receipt:z.infer<typeof receiptSchema>;fence:{sql:string;values:(string|number|null)[]}};
export async function prepareKidsNotice(user:string,k:Kids,operationId:string,args:unknown):Promise<NoticeChange>{
 const a=input.parse(args);if((a.action==='undo')!==!!a.undoOperationId)throw new KidsError('Undo must name the exact notice change.',400);
 if(!k.contexts.some(c=>c.id===a.contextId))throw new KidsError('That notice is not in this board.',404);
 const p=await d().prepare(`SELECT ${noticeProofSql} proof`).bind(user,k.id,a.contextId).first<{proof:string}>();
 if(!p||p.proof==='[]'||await kidsHash(p.proof)!==a.version)throw new KidsError('This notice has a new source version. Reopen the saved board before reviewing it.',409);
 const old=await d().prepare('SELECT * FROM kids_notice_reviews WHERE owner_user_id=? AND workspace_id=? AND context_id=?').bind(user,k.id,a.contextId).first<Stored>();
 const before=old?stored(old):empty(a.version),same=before.version===a.version;
 let value:Tuple={exists:true,version:a.version,acknowledgedAt:same?before.acknowledgedAt:null,clearedAt:same?before.clearedAt:null,lastActionId:operationId};
 const now=new Date().toISOString(),conflict=()=>new KidsError('That notice review changed. Reopen the saved board before trying again.',409);
 if(a.action==='acknowledge'){if(value.acknowledgedAt)throw conflict();value.acknowledgedAt=now;}
 else if(a.action==='unacknowledge'){if(!value.acknowledgedAt)throw conflict();value.acknowledgedAt=null;}
 else if(a.action==='clear'){if(value.clearedAt)throw conflict();value.clearedAt=now;}
 else if(a.action==='restore'){if(!value.clearedAt)throw conflict();value.clearedAt=null;}
 else{
  const target=await d().prepare('SELECT source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,k.id,a.undoOperationId!).first<{source_authority:string|null}>();
  let targetValue:unknown=null;try{targetValue=target?.source_authority?JSON.parse(target.source_authority):null;}catch{throw conflict();}
  const parsed=receiptSchema.safeParse(targetValue);
  if(!parsed.success||parsed.data.contextId!==a.contextId||parsed.data.version!==a.version||parsed.data.proof!==p.proof||before.lastActionId!==a.undoOperationId||JSON.stringify(before)!==JSON.stringify(parsed.data.after))throw conflict();
  value={...parsed.data.before,exists:true,lastActionId:operationId};
 }
 const receipt={kind:'parent-notice-review-v1' as const,contextId:a.contextId,version:a.version,proof:p.proof,action:a.action,before,after:value,...(a.undoOperationId?{undoOperationId:a.undoOperationId}:{})};
 const prior=old?'EXISTS(SELECT 1 FROM kids_notice_reviews WHERE owner_user_id=kids_state.user_id AND workspace_id=kids_state.id AND context_id=? AND version=? AND acknowledged_at IS ? AND cleared_at IS ? AND last_parent_operation_id=?)':'NOT EXISTS(SELECT 1 FROM kids_notice_reviews WHERE owner_user_id=kids_state.user_id AND workspace_id=kids_state.id AND context_id=?)';
 return {contextId:a.contextId,proof:p.proof,value,receipt,fence:{sql:`EXISTS(SELECT 1 FROM json_each(document,'$.contexts') WHERE json_extract(value,'$.id')=?) AND ${noticeProofSql}=? AND ${prior}`,values:[a.contextId,user,k.id,a.contextId,p.proof,a.contextId,...(old?[old.version,old.acknowledged_at,old.cleared_at,old.last_parent_operation_id]:[])]}};
}
export function kidsNoticeStatement(user:string,workspace:string,nonce:string,change:NoticeChange){
 const v=change.value;return d().prepare(`INSERT INTO kids_notice_reviews(owner_user_id,workspace_id,context_id,version,acknowledged_at,cleared_at,last_parent_operation_id) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?) ON CONFLICT(owner_user_id,workspace_id,context_id) DO UPDATE SET version=excluded.version,acknowledged_at=excluded.acknowledged_at,cleared_at=excluded.cleared_at,last_parent_operation_id=excluded.last_parent_operation_id`).bind(user,workspace,change.contextId,v.version,v.acknowledgedAt,v.clearedAt,v.lastActionId,user,workspace,nonce);
}
export async function exportKidsNoticeReviews(user:string,workspace:string){return (await d().prepare('SELECT * FROM kids_notice_reviews WHERE owner_user_id=? AND workspace_id=? ORDER BY context_id').bind(user,workspace).all<Stored>()).results;}
