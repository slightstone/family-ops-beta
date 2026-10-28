import {env} from 'cloudflare:workers';
import {KidsError,type Kids} from './kids';
import {kidsToday} from './kids-schedule';
import {parentActivityCommand,parentDefinition,parentLimits,parentSession,projectParentActivities,parentRange,type ParentActivity,type ParentOccurrence,type ParentVersion} from './kids-parent-activities';
const db=()=> (env as unknown as {DB:D1Database}).DB;
type ActivityRow={id:string;revision:number;created_at:string};
type VersionRow={activity_id:string;revision:number;effective_from:string;definition:string|null};
type OccurrenceRow={activity_id:string;day:string;child_id:string;revision:number;definition_revision:number;value:string};
export async function parentRecords(user:string,workspace:string){
 const args=[user,workspace],activities=(await db().prepare('SELECT id,revision,created_at FROM kids_parent_activities WHERE owner_user_id=? AND workspace_id=? ORDER BY id').bind(...args).all<ActivityRow>()).results,versions=(await db().prepare('SELECT activity_id,revision,effective_from,definition FROM kids_parent_activity_versions WHERE owner_user_id=? AND workspace_id=? ORDER BY activity_id,revision').bind(...args).all<VersionRow>()).results,rows=(await db().prepare('SELECT activity_id,day,child_id,revision,definition_revision,value FROM kids_parent_activity_occurrences WHERE owner_user_id=? AND workspace_id=? ORDER BY activity_id,day,child_id').bind(...args).all<OccurrenceRow>()).results;
 return {activities:activities.map(a=>({id:a.id,revision:a.revision,createdAt:a.created_at,versions:versions.filter(v=>v.activity_id===a.id).map(v=>({revision:v.revision,effectiveFrom:v.effective_from,definition:v.definition?parentDefinition.parse(JSON.parse(v.definition)):null}))})),occurrences:rows.map(o=>({activityId:o.activity_id,day:o.day,childId:o.child_id,revision:o.revision,definitionRevision:o.definition_revision,...JSON.parse(o.value)}) as ParentOccurrence)};
}
export async function readParentBoard(user:string,workspace:string){const r=await parentRecords(user,workspace);return projectParentActivities(r.activities,r.occurrences);}
export async function guardParentChildren(user:string,k:Kids){const r=await parentRecords(user,k.id),ids=new Set(k.children.map(c=>c.id));if(r.activities.some(a=>a.versions.some(v=>v.definition&&!ids.has(v.definition.childId)))||r.occurrences.some(o=>!ids.has(o.childId)))throw new KidsError('Keep the child profiles used by parent-entered activities and session history.',409);}
export type ParentChange={result:Record<string,unknown>;receipt:Record<string,unknown>;fence:{sql:string;values:(string|number)[]};activity?:ParentActivity;version?:ParentVersion;occurrence?:ParentOccurrence;creating?:boolean};
export async function prepareParentChange(user:string,k:Kids,input:unknown):Promise<ParentChange>{
 const parsed=parentActivityCommand.safeParse(input);if(!parsed.success)throw new KidsError(parsed.error.issues[0]?.message??'Check the activity details.');const a=parsed.data;
 if(k.step!=='board')throw new KidsError('Open your saved board before adding or changing an activity.',409);
 const records=await parentRecords(user,k.id),today=kidsToday();let activity:ParentActivity,version:ParentVersion|undefined,occurrence:ParentOccurrence|undefined,creating=false;
 const baseFence={sql:'1=1',values:[] as (string|number)[]};
 if(a.action==='add'){
  if(records.activities.length>=parentLimits.activities)throw new KidsError('This board has 100 parent-entered activities. Export and review them before adding more; nothing was removed.',413);
  activity={id:crypto.randomUUID(),revision:1,createdAt:new Date().toISOString(),versions:[]};creating=true;
 }else{const found=records.activities.find(x=>x.id===a.activityId);if(!found)throw new KidsError('That parent-entered activity is outside this board.',404);activity=structuredClone(found);baseFence.sql='EXISTS(SELECT 1 FROM kids_parent_activities WHERE owner_user_id=? AND workspace_id=? AND id=? AND revision=?)';baseFence.values=[user,k.id,activity.id,activity.revision];}
 if(a.action!=='session'){
  if(a.effectiveFrom<today)throw new KidsError('Choose today or a later effective date. Earlier sessions are preserved.',409);
  if(a.action!=='add'&&a.activityRevision!==activity.revision)throw new KidsError('This activity changed. Reopen it before editing.',409);
  if(a.action!=='end'){
   if(!k.children.some(c=>c.id===a.definition.childId))throw new KidsError('Choose a child from this board.',403);
   const schedule=a.definition.schedule;if(schedule.type==='once'?schedule.date<a.effectiveFrom:!!schedule.until&&schedule.until<a.effectiveFrom)throw new KidsError('The activity must have a session on or after its effective date.');
  }
  version={revision:creating?1:activity.revision+1,effectiveFrom:a.effectiveFrom,definition:a.action==='end'?null:a.definition};
  activity.revision=version.revision;activity.versions.push(version);
  if(activity.versions.length>parentLimits.versionsPerActivity||records.activities.reduce((n,x)=>n+x.versions.length,0)+(creating?1:1)>parentLimits.versions)throw new KidsError('The retained activity-version limit is reached. Export and review earlier work; nothing was removed.',413);
 }else{
  const session=parentSession(activity,records.occurrences,a.day,a.proof.childId);if(!session||JSON.stringify(session.proof)!==JSON.stringify(a.proof))throw new KidsError('This session changed. Reopen its saved version before changing it.',409);
  const prior=records.occurrences.find(o=>o.activityId===activity.id&&o.day===a.day&&o.childId===a.proof.childId);
  if(a.change.type==='complete'&&session.completed||a.change.type==='reopen'&&!session.completed)throw new KidsError('This session is already in that state.',409);
  occurrence={activityId:activity.id,day:a.day,childId:a.proof.childId,revision:(prior?.revision??0)+1,definitionRevision:session.proof.definitionRevision,definition:session.definition,completed:a.change.type==='complete'?true:a.change.type==='reopen'?false:session.completed,pinned:session.pinned||a.change.type==='complete'||a.change.type==='reopen',travel:a.change.type==='travel'?{...session.travel,[a.change.direction]:a.change.mode}:session.travel};
  if(!prior&&records.occurrences.length>=parentLimits.occurrences)throw new KidsError('The 5,000 retained session limit is reached. Export and review earlier work; nothing was removed.',413);
  baseFence.sql+=' AND '+(prior?'EXISTS':'NOT EXISTS')+'(SELECT 1 FROM kids_parent_activity_occurrences WHERE owner_user_id=? AND workspace_id=? AND activity_id=? AND day=? AND child_id=?'+(prior?' AND revision=?':'')+')';baseFence.values.push(user,k.id,activity.id,a.day,a.proof.childId,...(prior?[prior.revision]:[]));
 }
 const prospective={activities:creating?[...records.activities,activity]:records.activities.map(x=>x.id===activity.id?activity:x),occurrences:occurrence?[...records.occurrences.filter(o=>!(o.activityId===occurrence.activityId&&o.day===occurrence.day&&o.childId===occurrence.childId)),occurrence]:records.occurrences};
 if(new TextEncoder().encode(JSON.stringify(prospective)).length>parentLimits.bytes)throw new KidsError('The retained activity history has reached 4 MiB. Export and review earlier work; nothing was removed.',413);
 const result={action:a.action,activityId:activity.id,activityRevision:activity.revision,createdAt:activity.createdAt,...(version?{version}:{}),...(occurrence?{occurrence}:{})};
 return {creating,activity,version,occurrence,result,receipt:{kind:'parent-activity-v1',result},fence:baseFence};
}
const occurrenceValue=(o:ParentOccurrence)=>JSON.stringify({definition:o.definition,completed:o.completed,pinned:o.pinned,travel:o.travel});
export function parentStatements(user:string,workspace:string,nonce:string,operation:string,p:ParentChange){
 const active='EXISTS(SELECT 1 FROM kids_state WHERE user_id=? AND id=? AND last_write_nonce=?)',tail=[user,workspace,nonce],statements:D1PreparedStatement[]=[];
 if(p.version&&p.activity){const a=p.activity,v=p.version;
  statements.push(p.creating?db().prepare(`INSERT INTO kids_parent_activities(owner_user_id,workspace_id,id,revision,created_at,last_parent_operation_id) SELECT ?,?,?,?,?,? WHERE ${active}`).bind(user,workspace,a.id,a.revision,a.createdAt,operation,...tail):db().prepare(`UPDATE kids_parent_activities SET revision=?,last_parent_operation_id=? WHERE owner_user_id=? AND workspace_id=? AND id=? AND ${active}`).bind(a.revision,operation,user,workspace,a.id,...tail));
  statements.push(db().prepare(`INSERT INTO kids_parent_activity_versions(owner_user_id,workspace_id,activity_id,revision,effective_from,definition,last_parent_operation_id) SELECT ?,?,?,?,?,?,? WHERE ${active}`).bind(user,workspace,a.id,v.revision,v.effectiveFrom,v.definition?JSON.stringify(v.definition):null,operation,...tail));
 }
 if(p.occurrence){const o=p.occurrence;statements.push(db().prepare(`INSERT INTO kids_parent_activity_occurrences(owner_user_id,workspace_id,activity_id,day,child_id,revision,definition_revision,value,last_parent_operation_id) SELECT ?,?,?,?,?,?,?,?,? WHERE ${active} ON CONFLICT(owner_user_id,workspace_id,activity_id,day,child_id) DO UPDATE SET revision=excluded.revision,definition_revision=excluded.definition_revision,value=excluded.value,last_parent_operation_id=excluded.last_parent_operation_id`).bind(user,workspace,o.activityId,o.day,o.childId,o.revision,o.definitionRevision,occurrenceValue(o),operation,...tail));}
 return statements;
}
export async function parentOriginalResult(user:string,workspace:string,operation:string){const r=await db().prepare('SELECT source_authority,committed_revision FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,workspace,operation).first<{source_authority:string;committed_revision:number}>();try{const proof=JSON.parse(r?.source_authority??'null');if(proof?.kind==='parent-activity-v1'&&proof.result&&r)return {...proof.result,committedRevision:r.committed_revision};}catch{}throw new KidsError('The saved activity result is unavailable. Reopen the board.',409);}
export const emptyParentBoard=()=>projectParentActivities([],[],parentRange());
