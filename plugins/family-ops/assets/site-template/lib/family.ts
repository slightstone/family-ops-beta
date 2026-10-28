import { z } from 'zod';

const id = z.string().min(1).max(100);
const label = z.string().trim().min(1).max(160);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Use a real date');
const optionalDay = z.union([day,z.literal('')]);
const personSchema = z.object({id,name:label,color:z.string().max(20),archived:z.boolean()}).strict();
const taskSchema = z.object({id,title:label,personId:z.string().max(100),done:z.boolean(),due:optionalDay,sourceId:z.string().max(100),edited:z.boolean()}).strict();
const sectionSchema = z.object({id,title:label,kind:z.enum(['tasks','packing','notes']),hidden:z.boolean(),archived:z.boolean(),notes:z.string().max(8000),items:z.array(taskSchema).max(200)}).strict();
const fieldSchema = z.object({id,label,type:z.enum(['text','number','boolean','date','enum','person']),options:z.array(label).max(30),archived:z.boolean()}).strict();
const eventSchema = z.object({id,title:label,kind:z.enum(['camping','travel','blank']),date:optionalDay,endDate:optionalDay,location:z.string().max(300),description:z.string().max(8000),archived:z.boolean(),sections:z.array(sectionSchema).max(30),values:z.record(z.union([z.string().max(2000),z.number().finite(),z.boolean()])),sourceIds:z.array(id).max(100)}).strict();
const proposalSchema = z.object({id,title:label,date:optionalDay,location:z.string().max(300),text:z.string().max(12000),confirmed:z.boolean(),status:z.enum(['pending','approved','dismissed']),eventId:z.string().max(100),createdAt:z.string()}).strict();
export const workspaceSchema = z.object({schemaVersion:z.literal(1),id,name:label,synthetic:z.boolean(),people:z.array(personSchema).min(1).max(20),settings:z.object({theme:z.enum(['forest','clay']),defaultView:z.enum(['today','plans']),personFilter:z.string().max(100),plansLabel:label,instructions:z.string().max(1200),viewOrder:z.array(z.enum(['today','plans','sources'])).length(3)}).strict(),fields:z.array(fieldSchema).max(30),events:z.array(eventSchema).max(150),inbox:z.array(proposalSchema).max(100),source:z.object({scope:z.enum(['selected','all-synced']),selectedChats:z.array(label).max(50),cloudConsent:z.boolean(),enabled:z.boolean(),cursor:z.number().int().min(0),gap:z.boolean()}).strict()}).strict();
export type Workspace = z.infer<typeof workspaceSchema>;
export type FamilyEvent = Workspace['events'][number];
export type Section = FamilyEvent['sections'][number];
export type Item = Section['items'][number];
export type Field = Workspace['fields'][number];
export type Policy = {state:'trial'|'active'|'cancel_at_period_end'|'suspended'|'ended';paidThrough:number;trialEnd:number;verifiedAt:number;providerRevision:number;revision:number;quota:number;used:number;events:string[];jobs:{id:string;status:'pending'|'paused'|'confirmed';cursor:number;sourceLabel:string}[]};
export class FamilyError extends Error { status:number; retryAfter?:number; constructor(message:string,status=400,retryAfter?:number){super(message);this.status=status;this.retryAfter=retryAfter;} }
export const uid = () => crypto.randomUUID();
export const dateAfter = (n:number,now=Date.now()) => new Date(now+n*86400000).toISOString().slice(0,10);
const clean = (v:unknown) => label.parse(v);
export const templates = {
  camping:{label:'Camping trip',description:'A little fresh air. A lot less to remember.',sections:[['Prepare','tasks'],['Packing','packing'],['Trip notes','notes']]},
  travel:{label:'Family getaway',description:'Flights, bags and the details between.',sections:[['Before we go','tasks'],['Packing','packing'],['Itinerary','notes']]},
  blank:{label:'Something else',description:'Make room for whatever life brings.',sections:[['To do','tasks'],['Notes','notes']]}
} as const;
export function newPolicy(now=Date.now()):Policy { return {state:'trial',paidThrough:now+86400000,trialEnd:now+86400000,verifiedAt:now,providerRevision:1,revision:1,quota:25,used:0,events:[],jobs:[]}; }
export function serviceAccess(p:Policy,now=Date.now()):{allowed:boolean;reason:string} {
  if(p.state==='suspended'||p.state==='ended')return {allowed:false,reason:'Connected service is paused. Your plans and export are still available.'};
  if(now >= (p.state==='trial'?p.trialEnd:p.paidThrough))return {allowed:false,reason:'The service period has ended. Your saved work is still here.'};
  if(now-p.verifiedAt>=300000)return {allowed:false,reason:'Service verification is out of date. Refresh the synthetic policy in the preview lab.'};
  if(p.used>=p.quota)return {allowed:false,reason:'The preview processing allowance is used up.'};
  return {allowed:true,reason:'Synthetic processing is available. No live account is connected.'};
}
export function createEvent(kind:keyof typeof templates, title:string, people:Workspace['people'], now=Date.now()):FamilyEvent {
  const sections:Section[]=templates[kind].sections.map(([title,kind])=>({id:uid(),title,kind,hidden:false,archived:false,notes:'',items:[]}));
  const ev:FamilyEvent={id:uid(),title:clean(title),kind,date:'',endDate:'',location:'',description:'',archived:false,sections,values:{},sourceIds:[]};
  if(kind!=='blank') {
    ev.date=dateAfter(2,now);ev.endDate=dateAfter(4,now);
    const prep=sections[0]; prep.items=['Check the reservation','Plan food for the first evening'].map(title=>({id:uid(),title,personId:'',done:false,due:dateAfter(1,now),sourceId:'',edited:false}));
    if(kind==='travel') prep.items[0].title='Confirm travel documents';
    const pack=sections.find(s=>s.kind==='packing')!;
    pack.items=[{id:uid(),title:kind==='camping'?'First aid kit':'Travel documents',personId:'',done:false,due:'',sourceId:'',edited:false},...people.filter(p=>!p.archived).flatMap(p=>['Water bottle',kind==='camping'?'Warm layer':'Spare clothes'].map(title=>({id:uid(),title,personId:p.id,done:false,due:'',sourceId:'',edited:false})))];
  }
  return ev;
}
export function newWorkspace(name:string,names:string[],sample=false,now=Date.now()):Workspace {
  const people=names.map((name,i)=>({id:uid(),name:clean(name),color:['sage','peach','gold','lavender','blue'][i%5],archived:false}));
  if(!people.length)throw new FamilyError('Add at least one person.');
  const w:Workspace={schemaVersion:1,id:uid(),name:clean(name),synthetic:sample,people,settings:{theme:'forest',defaultView:'today',personFilter:'',plansLabel:'Family plans',instructions:'Suggest changes for review. Never send messages.',viewOrder:['today','plans','sources']},fields:[],events:[],inbox:[],source:{scope:'selected',selectedChats:[],cloudConsent:false,enabled:false,cursor:0,gap:false}};
  if(sample){
    const camp=createEvent('camping','A weekend under the stars',people,now);camp.location='Pinewood campsite · fictional';camp.description='Two nights outside. Phones down, marshmallows ready.';camp.sections[0].items[0].done=true;camp.sections[2].notes='Arrive before sunset. The fictional campsite has drinking water and picnic tables.';
    const daily=createEvent('blank','The everyday little things',people,now);daily.date=dateAfter(0,now);daily.description='A place for the things that keep the day moving.';daily.sections[0].items=[{id:uid(),title:'Library books back in the bag',personId:people[2]?.id??people[0].id,done:false,due:dateAfter(0,now),sourceId:'',edited:false},{id:uid(),title:'Pick up something for dinner',personId:people[0].id,done:false,due:dateAfter(0,now),sourceId:'',edited:false}];
    w.events=[camp,daily];
  } return validateWorkspace(w);
}
function validateWorkspace(w:Workspace):Workspace {
  const parsed=workspaceSchema.parse(w);const ids=new Set<string>();
  const add=(v:string)=>{if(ids.has(v))throw new FamilyError('Import contains duplicate IDs.');ids.add(v);};
  const people=new Set(w.people.map(p=>p.id));w.people.forEach(p=>add(p.id));
  if(w.settings.personFilter&&!people.has(w.settings.personFilter))throw new FamilyError('Unknown person filter.');
  if(new Set(w.settings.viewOrder).size!==3)throw new FamilyError('Each view must appear once.');
  if(/\b(send|reply|execute|shell|grant|credential|http)\b/i.test(w.settings.instructions.replace('Never send messages.','')))throw new FamilyError('Instructions may describe planning preferences, not executable actions or permissions.');
  const fields=new Map(w.fields.map(f=>[f.id,f]));w.fields.forEach(f=>add(f.id));
  for(const e of w.events){add(e.id);if(e.date&&e.endDate&&e.endDate<e.date)throw new FamilyError('End date must follow the start date.');
    for(const [k,v] of Object.entries(e.values)){const f=fields.get(k);if(!f)throw new FamilyError('Unknown custom field.');validateValue(f,v,people);}
    e.sections.forEach(s=>{add(s.id);s.items.forEach(t=>{add(t.id);if(t.personId&&!people.has(t.personId))throw new FamilyError('Task refers to an unknown person.');});});}
  const eventIds=new Set(w.events.map(e=>e.id));w.inbox.forEach(p=>{add(p.id);if(p.eventId&&!eventIds.has(p.eventId))throw new FamilyError('Source refers to an unknown plan.');});
  return parsed;
}
function validateValue(f:Field,v:unknown,people:Set<string>){
  const valid = f.type==='text'?typeof v==='string':f.type==='number'?typeof v==='number'&&Number.isFinite(v):f.type==='boolean'?typeof v==='boolean':f.type==='date'?optionalDay.safeParse(v).success:f.type==='enum'?typeof v==='string'&&(v===''||f.options.includes(v)):typeof v==='string'&&(v===''||people.has(v));
  if(!valid)throw new FamilyError(`Check the value for ${f.label}.`);
}
const target = z.object({eventId:id}).strict();
export const commandSchemas = {
  createEvent:z.object({kind:z.enum(['camping','travel','blank']),title:label}).strict(),
  editEvent:target.extend({patch:z.object({title:label.optional(),date:optionalDay.optional(),endDate:optionalDay.optional(),location:z.string().max(300).optional(),description:z.string().max(8000).optional(),archived:z.boolean().optional()}).strict()}).strict(),
  addSection:target.extend({title:label,kind:z.enum(['tasks','packing','notes'])}).strict(),
  editSection:target.extend({sectionId:id,patch:z.object({title:label.optional(),notes:z.string().max(8000).optional(),hidden:z.boolean().optional(),archived:z.boolean().optional()}).strict()}).strict(),
  moveSection:target.extend({sectionId:id,direction:z.enum(['up','down'])}).strict(),
  addItem:target.extend({sectionId:id,title:label,personId:z.string().max(100),due:optionalDay}).strict(),
  editItem:target.extend({sectionId:id,itemId:id,patch:z.object({title:label.optional(),personId:z.string().max(100).optional(),due:optionalDay.optional(),done:z.boolean().optional()}).strict()}).strict(),
  settings:z.object({name:label.optional(),theme:z.enum(['forest','clay']).optional(),defaultView:z.enum(['today','plans']).optional(),personFilter:z.string().max(100).optional(),plansLabel:label.optional(),instructions:z.string().max(1200).optional(),viewOrder:z.array(z.enum(['today','plans','sources'])).length(3).optional()}).strict(),
  person:z.object({id:z.string().max(100).optional(),name:label,archived:z.boolean().optional()}).strict(),
  field:z.object({id:z.string().max(100).optional(),label,type:z.enum(['text','number','boolean','date','enum','person']),options:z.array(label).max(30),archived:z.boolean().optional()}).strict(),
  fieldValue:target.extend({fieldId:id,value:z.union([z.string().max(2000),z.number().finite(),z.boolean()])}).strict(),
  sourceConsent:z.object({scope:z.enum(['selected','all-synced']),selectedChats:z.array(label).max(50),cloudConsent:z.boolean(),enabled:z.boolean()}).strict(),
  importWorkspace:z.object({data:workspaceSchema}).strict(),
  extract:z.object({text:z.string().min(10).max(12000),sourceLabel:label}).strict(),
  review:z.object({proposalId:id,decision:z.enum(['approve','dismiss']),title:label,date:optionalDay,location:z.string().max(300),confirmed:z.boolean()}).strict(),
  policyFixture:z.object({fixture:z.enum(['trial','active','cancel_at_period_end','expired','suspended','ended','stale','quota','renew','duplicate','late'])}).strict(),
  queue:z.object({sourceLabel:label}).strict(),dispatch:z.object({jobId:id}).strict(),
} as const;
export type CommandName = keyof typeof commandSchemas;
export type Command = {type:CommandName;args:Record<string,unknown>};
export function applyCommand(w0:Workspace,p0:Policy,type:CommandName,raw:unknown,now=Date.now()):{workspace:Workspace;policy:Policy;result:Record<string,unknown>} {
  const schema=commandSchemas[type];if(!schema)throw new FamilyError('Unsupported operation.');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Each command's arguments are validated by its strict schema before dispatch.
  const a:any=schema.parse(raw);const w=structuredClone(w0),p=structuredClone(p0);let result:Record<string,unknown>={};
  const event=()=>{const e=w.events.find(e=>e.id===a.eventId);if(!e)throw new FamilyError('Plan not found.',404);return e;};
  const section=()=>{const s=event().sections.find(s=>s.id===a.sectionId);if(!s)throw new FamilyError('Section not found.',404);return s;};
  const requireService=(sourceLabel:string)=>{const access=serviceAccess(p,now);if(!access.allowed)throw new FamilyError(access.reason,402);if(!w.source.enabled||!w.source.cloudConsent)throw new FamilyError('Enable the synthetic source and give processing consent first.',403);if(w.source.scope==='selected'&&!w.source.selectedChats.includes(sourceLabel))throw new FamilyError('This source is outside your selected processing scope.',403);};
  switch(type){
    case 'createEvent':{const e=createEvent(a.kind,a.title,w.people,now);w.events.push(e);result={eventId:e.id};break;}
    case 'editEvent':{const e=event();if(a.patch.date!==undefined&&a.patch.date!==e.date){const previous=e.date?dateAfter(-1,Date.parse(e.date+'T12:00:00Z')):'';const next=a.patch.date?dateAfter(-1,Date.parse(a.patch.date+'T12:00:00Z')):'';e.sections.forEach(s=>s.items.forEach(t=>{if(!t.edited&&t.due&&t.due===previous)t.due=next;}));}Object.assign(e,a.patch);break;}
    case 'addSection':{const s:Section={id:uid(),title:a.title,kind:a.kind,hidden:false,archived:false,notes:'',items:[]};event().sections.push(s);result={sectionId:s.id};break;}
    case 'editSection':Object.assign(section(),a.patch);break;
    case 'moveSection':{const e=event();const i=e.sections.findIndex(s=>s.id===a.sectionId);if(i<0)throw new FamilyError('Section not found.',404);const j=i+(a.direction==='up'?-1:1);if(j>=0&&j<e.sections.length)[e.sections[i],e.sections[j]]=[e.sections[j],e.sections[i]];break;}
    case 'addItem':{const s=section();const t:Item={id:uid(),title:a.title,personId:a.personId,done:false,due:a.due,sourceId:'',edited:true};s.items.push(t);result={itemId:t.id};break;}
    case 'editItem':{const t=section().items.find(t=>t.id===a.itemId);if(!t)throw new FamilyError('Item not found.',404);Object.assign(t,a.patch,{edited:true});break;}
    case 'settings':{if(a.name){w.name=a.name;delete a.name;}Object.assign(w.settings,a);break;}
    case 'person':{if(a.id){const person=w.people.find(x=>x.id===a.id);if(!person)throw new FamilyError('Person not found.',404);Object.assign(person,{name:a.name,archived:!!a.archived});}else w.people.push({id:uid(),name:a.name,color:['sage','peach','gold','lavender','blue'][w.people.length%5],archived:false});break;}
    case 'field':{if(a.type==='enum'&&!a.options.length)throw new FamilyError('Add at least one choice.');if(a.id){const f=w.fields.find(f=>f.id===a.id);if(!f)throw new FamilyError('Field not found.',404);if(f.type!==a.type)throw new FamilyError('Create a new field to change its type safely.');Object.assign(f,{label:a.label,options:a.options,archived:!!a.archived});}else w.fields.push({id:uid(),label:a.label,type:a.type,options:a.options,archived:false});break;}
    case 'fieldValue':{const f=w.fields.find(f=>f.id===a.fieldId&&!f.archived);if(!f)throw new FamilyError('Field not found.',404);validateValue(f,a.value,new Set(w.people.map(p=>p.id)));event().values[a.fieldId]=a.value;break;}
    case 'sourceConsent':{const hadSource=w.source.enabled;const changed=JSON.stringify({scope:w.source.scope,selectedChats:w.source.selectedChats,cloudConsent:w.source.cloudConsent,enabled:w.source.enabled})!==JSON.stringify(a);Object.assign(w.source,a);if(!a.enabled||!a.cloudConsent||(changed&&hadSource)){w.source.gap=true;p.jobs.forEach(j=>{if(j.status==='pending')j.status='paused';});}break;}
    case 'importWorkspace':{
      if(w.events.length||w.fields.length||w.inbox.length)throw new FamilyError('Import into a blank workspace to preserve existing plans.',409);
      const imported=validateWorkspace(a.data);if(imported.source.enabled||imported.source.cloudConsent)throw new FamilyError('Exports cannot import source authority.');
      const retainedId=w.id;Object.assign(w,imported,{id:retainedId,source:{...imported.source,enabled:false,cloudConsent:false,selectedChats:[],cursor:0,gap:true}});break;
    }
    case 'extract':{
      requireService(a.sourceLabel);const text=a.text as string;let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);const sourceId=`source-${h>>>0}`;
      const existing=w.inbox.find(x=>x.id===sourceId);if(existing&&existing.text!==text)throw new FamilyError('This source conflicts with an earlier notice.',409);if(existing){result={proposalId:existing.id,duplicate:true};break;}
      const title=text.match(/^Trip:\s*(.+)$/im)?.[1]?.trim()??'Travel details to confirm';
      const date=text.match(/^Date:\s*(\d{4}-\d{2}-\d{2})\s*$/im)?.[1]??'';const location=text.match(/^Place:\s*(.+)$/im)?.[1]?.trim()??'';
      w.inbox.push({id:sourceId,title:clean(title),date:date&&day.safeParse(date).success?date:'',location,text,confirmed:false,status:'pending',eventId:'',createdAt:new Date(now).toISOString()});p.used++;w.source.cursor++;result={proposalId:sourceId};break;
    }
    case 'review':{
      const prop=w.inbox.find(x=>x.id===a.proposalId);if(!prop)throw new FamilyError('Notice not found.',404);if(prop.status!=='pending'){result={eventId:prop.eventId,duplicate:true};break;}
      if(a.decision==='dismiss'){prop.status='dismissed';break;}
      if(!a.confirmed||!a.date)throw new FamilyError('Confirm the date and details before adding this plan.');
      const e=createEvent('travel',a.title,w.people,now);Object.assign(e,{date:a.date,endDate:'',location:a.location,sourceIds:[prop.id]});e.sections.forEach(s=>s.items.forEach(t=>{if(t.due)t.due=dateAfter(-1,Date.parse(a.date+'T12:00:00Z'));}));e.sections.find(s=>s.kind==='notes')!.notes=`Reviewed source:\n${prop.text}`;
      w.events.push(e);Object.assign(prop,{title:a.title,date:a.date,location:a.location,confirmed:true,status:'approved',eventId:e.id});result={eventId:e.id};break;
    }
    case 'policyFixture':{
      const f=a.fixture as string;
      // This endpoint is a visible synthetic preview laboratory, never a paid entitlement grant.
      if(f==='duplicate'||f==='late'){const eventId=f==='duplicate'?`fixture-${p.providerRevision}`:'fixture-obsolete';if(!p.events.includes(eventId))p.events.push(eventId);result={reconciledRevision:p.providerRevision,ignoredObsolete:true};break;}
      p.revision++;p.providerRevision++;p.events.push(`fixture-${p.providerRevision}`);p.verifiedAt=now;p.used=0;p.quota=25;p.paidThrough=now+86400000;p.trialEnd=now+86400000;
      p.state=['expired','stale','quota','renew'].includes(f)?'active':f as Policy['state'];
      if(f==='expired')p.paidThrough=now;if(f==='stale')p.verifiedAt=now-300000;if(f==='quota')p.used=p.quota;
      if(!serviceAccess(p,now).allowed){w.source.gap=true;p.jobs.forEach(j=>{if(j.status==='pending')j.status='paused';});}
      break;
    }
    case 'queue':requireService(a.sourceLabel);{const job={id:uid(),status:'pending' as const,cursor:w.source.cursor,sourceLabel:a.sourceLabel};p.jobs.push(job);result={jobId:job.id};}break;
    case 'dispatch':{
      const job=p.jobs.find(j=>j.id===a.jobId);if(!job)throw new FamilyError('Job not found.',404);if(job.status==='confirmed'){result={duplicate:true};break;}
      if(job.status==='paused')throw new FamilyError('This job was paused. Review the source and queue a new job.',409);requireService(job.sourceLabel);job.status='confirmed';w.source.cursor++;p.used++;result={claimedAt:new Date(now).toISOString(),entitlementRevision:p.revision};break;
    }
  }
  return {workspace:validateWorkspace(w),policy:p,result};
}
export function exportWorkspace(w:Workspace):Workspace {const exported=structuredClone(w);exported.source={...exported.source,enabled:false,cloudConsent:false,selectedChats:[],cursor:0,gap:true};return exported;}
export type DeploymentMode = 'preview'|'beta';
export function deploymentMode(value:unknown):DeploymentMode {return value==='preview'?'preview':'beta';}
export function deploymentCapabilities(mode:DeploymentMode){return {manualPlanning:true,importExport:true,readOnlyMcp:true,previewControls:mode==='preview',connectedServices:false};}
const previewOnlyCommands=new Set(['policyFixture','sourceConsent','extract','review','queue','dispatch']);
export function requireModeCommand(mode:DeploymentMode,type:string){
  if(mode!=='preview'&&previewOnlyCommands.has(type))throw new FamilyError('Connected services and preview controls are unavailable in the manual beta. Your saved plans and export are still available.',403);
}
export function publicPolicy(p:Policy,now=Date.now(),mode:DeploymentMode='preview'){return {...p,access:mode==='preview'?serviceAccess(p,now):{allowed:false,reason:'Connected services are unavailable in the manual beta.'},synthetic:true};}

export const familyStorageLimits={workspace:256*1024,operations:512*1024,policy:64*1024,policyEvents:256,policyJobs:128} as const;
export function assertSerializedLimit(value:string,limit:number,label:string){
  if(new TextEncoder().encode(value).byteLength>limit)throw new FamilyError(`${label} storage limit reached. Nothing was saved. Export your earlier work before making a smaller change.`,413);
}
export function serializeFamilyWrite(workspace:Workspace,policy:Policy,operations:Record<string,unknown>){
  const serialized={document:JSON.stringify(workspace),policy:JSON.stringify(policy),operations:JSON.stringify(operations)};
  assertSerializedLimit(serialized.document,familyStorageLimits.workspace,'Workspace');
  assertSerializedLimit(serialized.policy,familyStorageLimits.policy,'Service history');
  assertSerializedLimit(serialized.operations,familyStorageLimits.operations,'Change history');
  if(policy.events.length>familyStorageLimits.policyEvents||policy.jobs.length>familyStorageLimits.policyJobs)throw new FamilyError('Service history limit reached. Nothing was saved. Your earlier work and export are still available.',413);
  return serialized;
}
