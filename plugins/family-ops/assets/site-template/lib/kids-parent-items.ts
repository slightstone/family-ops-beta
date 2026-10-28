import {z} from 'zod/v4';
import {KidsError,type Kids,type KidsContext} from './kids';

const day=z.string().refine(v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v),'Use a valid calendar date.');
const title=z.string().trim().min(1).max(200),uuid=z.string().uuid();
const clock=z.string().regex(/^(?:|(?:[01]\d|2[0-3]):[0-5]\d)$/,'Use an exact 24-hour time or leave it empty.');
const parentEvent=z.object({startTime:clock,endTime:clock,endDate:day,location:z.string().trim().max(300),timeZone:z.literal('Asia/Jerusalem')}).strict();
export const parentItemDefinition=z.object({
 category:z.enum(['task','homework','test','reminder','preparation']),title,childIds:z.array(uuid).max(12),date:day,event:parentEvent.optional(),notes:z.string().max(4000),
 tasks:z.array(z.object({id:uuid.optional(),title,childId:z.union([uuid,z.literal('')]),due:day}).strict()).max(100),
}).strict();
export const parentItemCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),definition:parentItemDefinition}).strict(),
 z.object({action:z.literal('edit'),contextId:uuid,definition:parentItemDefinition}).strict(),
 z.object({action:z.literal('review'),contextId:uuid,review:z.enum(['acknowledge','unacknowledge','clear','restore'])}).strict(),
]);
export type ParentItemDefinition=z.infer<typeof parentItemDefinition>;
export type ParentItemResult={action:string;contextId:string;taskIds:string[]};
export type ParentItemReceipt={kind:'parent-item-v1';result:ParentItemResult};
export function changeParentItem(original:Kids,input:unknown,operationId:string){
 const parsed=parentItemCommand.safeParse(input);if(!parsed.success)throw new KidsError(parsed.error.issues[0]?.message??'Check the parent item.');const a=parsed.data,k=structuredClone(original),now=new Date().toISOString();
 let c:KidsContext|undefined=a.action==='create'?undefined:k.contexts.find(c=>c.id===a.contextId);
 if(a.action!=='create'&&(!c||!c.parentEntry))throw new KidsError('Only a parent-created item can be changed here. Source-backed work is kept.',403);
 if(a.action==='review'){
  const p=c!.parentEntry!;if(a.review==='acknowledge')p.acknowledgedAt??=now;else if(a.review==='unacknowledge')p.acknowledgedAt=null;else if(a.review==='clear')p.archivedAt??=now;else p.archivedAt=null;p.lastReviewOperation=operationId;
 }else{
  const d=a.definition,children=new Set(k.children.map(c=>c.id));
  if(new Set(d.childIds).size!==d.childIds.length||d.childIds.some(id=>!children.has(id))||d.tasks.some(t=>t.childId&&(!children.has(t.childId)||d.childIds.length>0&&!d.childIds.includes(t.childId))))throw new KidsError('Choose existing people from this board for the item and its tasks.');
  if(a.action==='create'&&d.tasks.some(t=>t.id))throw new KidsError('New checklist items cannot supply saved task IDs.');
  if(d.category==='task'&&d.childIds.length>1)throw new KidsError('A standalone task needs one child or Family.');
  if(d.category==='task'&&d.tasks.length)throw new KidsError('Use a task on its own, or choose another kind for a checklist.');
  if(!c){if(k.contexts.length>=120)throw new KidsError('This board has reached its context limit. Earlier work is kept.',413);const id=crypto.randomUUID();c={id,key:'parent-item:'+id,title:d.title,kind:'admin',workflow:'school',childIds:[],date:'',notes:'',words:[],missingMaterial:false,pinned:false,filed:false,edited:false,tasks:[],sourceIds:[],updatedAt:now,parentEntry:{category:d.category,createdAt:now,acknowledgedAt:null,archivedAt:null,lastReviewOperation:null}};k.contexts.push(c);}
  const old=c.tasks;
  let rows=d.category==='task'?[{...(old[0]?{id:old[0].id}:{}),title:d.title,childId:d.childIds[0]??'',due:d.date}]:d.tasks;
  if(new Set(rows.flatMap(t=>t.id?[t.id]:[])).size!==rows.filter(t=>t.id).length||rows.some(t=>t.id&&!old.some(x=>x.id===t.id))||old.some(t=>!rows.some(x=>x.id===t.id)))throw new KidsError('Retain every existing task ID and its history when editing this item.');
  c.tasks=rows.map(t=>{const prior=old.find(x=>x.id===t.id);return prior?{...prior,title:t.title,childId:t.childId,due:t.due,edited:true}:{id:crypto.randomUUID(),key:'parent-task:'+crypto.randomUUID(),title:t.title,childId:t.childId,due:t.due,acknowledgedAt:null,resolution:'open',edited:false,sourceIds:[]};});
  Object.assign(c,{title:d.title,kind:d.category==='homework'||d.category==='test'?'study':d.category==='preparation'?'trip':'admin',workflow:'school',childIds:d.childIds,date:d.date,event:d.event,notes:d.notes,edited:a.action==='edit',updatedAt:now});
  c.parentEntry!.category=d.category;
 }
 const result={action:a.action,contextId:c!.id,taskIds:c!.tasks.map(t=>t.id)};
 return {kids:k,receipt:{kind:'parent-item-v1' as const,result}};
}
