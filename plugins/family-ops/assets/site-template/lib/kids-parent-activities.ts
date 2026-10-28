import {z} from 'zod/v4';
import {shiftKidsDay,kidsPlanningSelection} from './kids-planning';

const id=z.string().min(1).max(180),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s=>Number.isFinite(Date.parse(s+'T12:00:00Z'))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s,'Choose a valid date.'),time=z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^$/);
const weekly=z.object({type:z.literal('weekly'),days:z.array(z.number().int().min(0).max(6)).min(1).max(7).refine(v=>new Set(v).size===v.length,'Choose each weekday once.').transform(v=>[...v].sort()),start:day,until:day.nullable()}).strict().refine(s=>!s.until||s.until>=s.start,'The end date must follow the start.');
export const parentDefinition=z.object({title:z.string().trim().min(1).max(160),childId:id,schedule:z.discriminatedUnion('type',[z.object({type:z.literal('once'),date:day}).strict(),weekly]),startTime:time.default(''),endTime:time.default(''),location:z.string().trim().max(200).default('')}).strict().refine(d=>!d.startTime||!d.endTime||d.endTime>d.startTime,'End time must be after start time on the same day.');
export type ParentDefinition=z.infer<typeof parentDefinition>;
export const sessionProof=z.object({childId:id,definitionRevision:z.number().int().min(1),occurrenceRevision:z.number().int().min(0)}).strict();
export const parentActivityCommand=z.discriminatedUnion('action',[
 z.object({action:z.literal('add'),effectiveFrom:day,definition:parentDefinition}).strict(),
 z.object({action:z.literal('edit'),activityId:z.string().uuid(),activityRevision:z.number().int().min(1),effectiveFrom:day,definition:parentDefinition}).strict(),
 z.object({action:z.literal('end'),activityId:z.string().uuid(),activityRevision:z.number().int().min(1),effectiveFrom:day}).strict(),
 z.object({action:z.literal('session'),activityId:z.string().uuid(),day,proof:sessionProof,change:z.discriminatedUnion('type',[z.object({type:z.literal('complete')}).strict(),z.object({type:z.literal('reopen')}).strict(),z.object({type:z.literal('travel'),direction:z.enum(['outbound','return']),mode:z.enum(['walk_bike','we_drive','someone_else']).nullable()}).strict()])}).strict(),
]);
export type ParentCommand=z.infer<typeof parentActivityCommand>;
export type ParentVersion={revision:number;effectiveFrom:string;definition:ParentDefinition|null};
export type ParentOccurrence={activityId:string;day:string;childId:string;revision:number;definitionRevision:number;definition:ParentDefinition;completed:boolean;pinned:boolean;travel:{outbound:'walk_bike'|'we_drive'|'someone_else'|null;return:'walk_bike'|'we_drive'|'someone_else'|null}};
export type ParentActivity={id:string;revision:number;createdAt:string;versions:ParentVersion[]};
export type ParentSession={id:string;activityId:string;day:string;definition:ParentDefinition;completed:boolean;pinned:boolean;travel:ParentOccurrence['travel'];proof:z.infer<typeof sessionProof>};
export type ParentBoard={range:{first:string;last:string;today:string};activities:{id:string;revision:number;current:ParentVersion|null;latest:ParentVersion;editableDefinition:ParentDefinition;pending:{revision:number;effectiveFrom:string;title:string|null}[]}[];sessions:ParentSession[];limits:{activities:number;versionsPerActivity:number;versions:number;occurrences:number;bytes:number}};
export const parentLimits={activities:100,versionsPerActivity:100,versions:2000,occurrences:5000,bytes:4*1024*1024};
export function parentRange(now=new Date()){const p=kidsPlanningSelection(now);return {first:p.thisWeek,last:shiftKidsDay(p.thisWeek,13),today:p.today};}
export function parentVersionFor(activity:ParentActivity,day:string){return activity.versions.filter(v=>v.effectiveFrom<=day).sort((a,b)=>b.revision-a.revision)[0]??null;}
export function parentDefinitionOn(d:ParentDefinition,day:string){return d.schedule.type==='once'?d.schedule.date===day:d.schedule.start<=day&&(!d.schedule.until||d.schedule.until>=day)&&d.schedule.days.includes(new Date(day+'T12:00:00Z').getUTCDay());}
export function parentSession(activity:ParentActivity,occurrences:ParentOccurrence[],day:string,childId:string):ParentSession|null{
 const occurrence=occurrences.find(o=>o.activityId===activity.id&&o.day===day&&o.childId===childId),version=parentVersionFor(activity,day),pinned=occurrence?.pinned===true;
 const definition=pinned?occurrence.definition:version?.definition;
 if(!definition||definition.childId!==childId||!pinned&&!parentDefinitionOn(definition,day))return null;
 return {id:JSON.stringify([activity.id,day,childId]),activityId:activity.id,day,definition,completed:occurrence?.completed??false,pinned,travel:occurrence?.travel??{outbound:null,return:null},proof:{childId,definitionRevision:pinned?occurrence.definitionRevision:version!.revision,occurrenceRevision:occurrence?.revision??0}};
}
export function projectParentActivities(activities:ParentActivity[],occurrences:ParentOccurrence[],range=parentRange()):ParentBoard{
 const sessions:ParentSession[]=[];
 for(let day=range.first;day<=range.last;day=shiftKidsDay(day,1))for(const activity of activities){const scopes=new Set([parentVersionFor(activity,day)?.definition?.childId,...occurrences.filter(o=>o.activityId===activity.id&&o.day===day&&o.pinned).map(o=>o.childId)].filter((v):v is string=>!!v));for(const child of scopes){const s=parentSession(activity,occurrences,day,child);if(s)sessions.push(s);}}
 return {range,activities:activities.map(a=>({id:a.id,revision:a.revision,current:parentVersionFor(a,range.today),latest:a.versions.reduce((x,y)=>x.revision>y.revision?x:y),editableDefinition:[...a.versions].sort((x,y)=>y.revision-x.revision).find(v=>v.definition)!.definition!,pending:a.versions.filter(v=>v.effectiveFrom>range.today&&!a.versions.some(newer=>newer.revision>v.revision&&newer.effectiveFrom<=v.effectiveFrom)).map(v=>({revision:v.revision,effectiveFrom:v.effectiveFrom,title:v.definition?.title??null}))})),sessions,limits:{...parentLimits}};
}
