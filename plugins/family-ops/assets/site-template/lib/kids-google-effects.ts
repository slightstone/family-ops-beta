import {z} from 'zod/v4';
import {KidsError} from './kids-error';
import type {KidsContext} from './kids';
import {googleBytes,googleHash} from './kids-google';

const uuid=z.uuid(),providerId=z.string().min(1).max(500),date=z.iso.date(),instant=z.iso.datetime({offset:true});
const zone=z.string().min(1).max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}});
const base={operation_id:uuid,workspace_id:uuid,expected_revision:z.number().int().min(1)};
const effectBase={...base,effect_id:uuid,effect_revision:z.number().int().min(1),proposal_hash:googleHash};
const floating=z.strictObject({type:z.literal('all_day'),start:date,end_exclusive:date});
const timed=z.strictObject({type:z.literal('timed'),start:instant,end:instant,timezone:zone});
function localParts(time:number,timezone:string){const p=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(time).map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;}
function coherent(v:{start:string;end:string;timezone:string|null}){return !v.timezone||[v.start,v.end].every(t=>localParts(Date.parse(t),v.timezone!)===t.slice(0,19));}
function interval(v:{type:string;start:string;end?:string;end_exclusive?:string}){const start=Date.parse(v.start),end=Date.parse(v.end??v.end_exclusive!);return end>start&&end-start<=32*86400000;}
export const effectPayloadSchema=z.strictObject({title:z.string().trim().min(1).max(200),description:z.string().max(1800).refine(s=>!s.includes('Family Ops reference:')),location:z.string().max(500),timing:z.discriminatedUnion('type',[floating.extend({timezone:zone}),timed]).refine(t=>interval(t)&&(t.type!=='timed'||coherent(t)))});
export const effectProviderSchema=z.strictObject({event_id:providerId,status:z.enum(['confirmed','tentative','cancelled']),title:z.string().max(1000),description:z.string().max(4000),location:z.string().max(1000),timing:z.discriminatedUnion('type',[floating,timed.extend({timezone:zone.nullable()})]).refine(t=>interval(t)&&(t.type!=='timed'||coherent(t))),attendee_count:z.number().int().min(0).nullable(),recurrence_count:z.number().int().min(0).nullable(),conference:z.boolean().nullable(),event_type:z.string().max(50).nullable(),visibility:z.string().max(50).nullable(),guests_can_modify:z.boolean().nullable(),reminders:z.strictObject({use_default:z.boolean().nullable(),override_count:z.number().int().min(0).nullable()}),updated:instant.nullable(),etag:z.string().max(200).nullable()}).refine(r=>googleBytes(r)<=12288);
const stageFields={parent_requested:z.literal(true),source_kind:z.enum(['context','google']),source_id:uuid,target_grant_id:uuid,mode:z.enum(['create','update']),previous_effect_id:uuid.nullable(),payload:effectPayloadSchema,provider_before:effectProviderSchema.nullable()};
const stagePair=(a:{mode:string;previous_effect_id:string|null;provider_before:unknown})=>a.mode==='create'?a.previous_effect_id===null&&a.provider_before===null:!!a.previous_effect_id&&!!a.provider_before;
export const effectStageSchema=z.strictObject({...base,...stageFields}).refine(stagePair);
export const effectApproveSchema=z.strictObject({...effectBase,approval_phrase:z.string().max(100)});
export const effectApprovalPhrase=(id:string)=>`Approve Calendar request ${id}`;
export const effectClaimSchema=z.strictObject({...effectBase,provider_before:effectProviderSchema.nullable()});
export const effectCheckSchema=z.strictObject(effectBase);
export const effectResultSchema=z.strictObject({...effectBase,claim_id:uuid,read_id:uuid,read_hash:googleHash,link_id:providerId,calendar_id:providerId,search_complete:z.boolean(),candidates:z.array(effectProviderSchema).max(5).refine(a=>new Set(a.map(r=>r.event_id)).size===a.length),gaps:z.array(z.string().min(1).max(200)).max(5)});
export const effectGetSchema=z.discriminatedUnion('mode',[
 z.strictObject({mode:z.literal('list'),workspace_id:uuid,after:uuid.optional()}),
 z.strictObject({mode:z.literal('detail'),workspace_id:uuid,effect_id:uuid}),
 z.strictObject({mode:z.literal('source'),workspace_id:uuid,source_kind:z.enum(['context','google']),source_id:uuid}),
]);
const web={operationId:uuid,workspaceId:uuid,baseRevision:z.number().int().min(1)};
const webEffect={...web,effectId:uuid,effectRevision:z.number().int().min(1),proposalHash:googleHash};
export const effectWebSchema=z.discriminatedUnion('action',[
 z.strictObject({...web,action:z.literal('stage'),...stageFields}).refine(stagePair),
 z.strictObject({...webEffect,action:z.literal('approve'),confirmed:z.literal(true)}),
 z.strictObject({...webEffect,action:z.literal('discard')}),
]);
export type EffectPayload=z.infer<typeof effectPayloadSchema>;
export type EffectProvider=z.infer<typeof effectProviderSchema>;
export type EffectSummary={id:string;status:string;revision:number;proposalHash:string;sourceKind:'context'|'google';sourceId:string;mode:'create'|'update';title:string;grantId:string;linkId:string;calendarId:string;reference:string;previousEffectId:string|null;providerEventId:string|null;createdAt:number;expiresAt:number;expired:boolean;checkCount:number};
export type SupportedTimings={allDay:EffectPayload['timing']|null;timed:EffectPayload['timing']|null;reasons:string[]};
export type EffectTarget={id:string;revision:number;linkId:string;calendarId:string;accountLabel:string;calendarLabel:string;pendingEffect:EffectSummary|null;latestLinkedEffect:EffectSummary|null};
export const referenceLine=(reference:string)=>`Family Ops reference: ${reference}`;
export function storedEffectPayload(p:EffectPayload,reference:string):EffectPayload{return {...p,description:p.description+'\n\n'+referenceLine(reference)};}
const canonicalZone=(v:string)=>new Intl.DateTimeFormat('en',{timeZone:v}).resolvedOptions().timeZone;
export function sameEffectTiming(p:EffectPayload['timing'],r:EffectProvider['timing']){return p.type===r.type&&(p.type==='all_day'&&r.type==='all_day'?p.start===r.start&&p.end_exclusive===r.end_exclusive:p.type==='timed'&&r.type==='timed'&&Date.parse(p.start)===Date.parse(r.start)&&Date.parse(p.end)===Date.parse(r.end)&&(!r.timezone||canonicalZone(p.timezone)===canonicalZone(r.timezone)));}
export function safeEffectProvider(r:EffectProvider){return r.status==='confirmed'&&r.attendee_count===0&&r.recurrence_count===0&&r.conference===false&&r.event_type==='default'&&r.visibility==='private'&&r.guests_can_modify===false&&r.reminders.use_default===false&&r.reminders.override_count===0;}
export function effectMatch(payload:EffectPayload,reference:string,candidates:EffectProvider[],complete:boolean,gaps:string[],requiredId:string|null){
 const bearing=candidates.filter(r=>r.description.split(/\r?\n/).includes(referenceLine(reference))),matches=bearing.filter(r=>safeEffectProvider(r)&&r.title===payload.title&&r.description===payload.description&&r.location===payload.location&&sameEffectTiming(payload.timing,r.timing)&&(!requiredId||r.event_id===requiredId));
 const outcome=!complete||gaps.length?'incomplete':bearing.length>1?'multiple':!bearing.length?'none':matches.length===1?'linked':'mismatch';
 return {outcome,eventId:outcome==='linked'?matches[0].event_id:null,referenceIds:bearing.map(r=>r.event_id),matchIds:matches.map(r=>r.event_id)};
}
export function effectNativeArgs(mode:string,link:string,calendar:string,p:EffectPayload,eventId:string|null){const timing=p.timing.type==='all_day'?{start_date:p.timing.start,end_date:p.timing.end_exclusive}:{start_time:p.timing.start,end_time:p.timing.end,timezone_str:p.timing.timezone};return {tool:mode==='create'?'create_event':'update_event',arguments:{link_id:link,calendar_id:calendar,...(mode==='create'?{attendees:[]}:{event_id:eventId,update_scope:'this_instance'}),title:p.title,description:p.description,location:p.location,...timing,add_google_meet:false,event_type:'default',visibility:'private',guests_can_modify:false,reminders:{use_default:false,overrides:[]}}};}
export function effectContextTiming(c:KidsContext,p:EffectPayload['timing']){
 if(!c.date)throw new KidsError('This view needs a known source date before Calendar preparation.',409);
 const last=c.event?.endDate||c.date,next=new Date(Date.parse(last+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 if(p.type==='all_day'){if(p.start!==c.date||p.end_exclusive!==next||canonicalZone(p.timezone)!==canonicalZone(c.event?.timeZone??'Asia/Jerusalem'))throw new KidsError('Use this view’s saved date range.',409);return;}
 const e=c.event;if(Date.parse(p.start)%60000||Date.parse(p.end)%60000||!e?.startTime||!e.endTime||p.timezone!==e.timeZone||p.start.slice(0,19)!==`${c.date}T${e.startTime}:00`||p.end.slice(0,19)!==`${last}T${e.endTime}:00`)throw new KidsError('Exact timed events need both saved clocks and time zone. Use all-day or clarify the source.',409);
 // A repeated local clock during DST is not a uniquely supported source instant.
 for(const value of [p.start,p.end])for(let delta=-180;delta<=180;delta+=15)if(delta&&localParts(Date.parse(value)+delta*60000,p.timezone)===value.slice(0,19))throw new KidsError('This source clock is ambiguous during a time-zone change. Use all-day or clarify it.',409);
}
export function effectWindow(p:EffectPayload){const t=p.timing;return {start:new Date(Date.parse(t.start)-86400000).toISOString(),end:new Date(Date.parse(t.type==='all_day'?t.end_exclusive:t.end)+86400000).toISOString()};}
function localInstant(day:string,clock:string,timezone:string){
 const wall=`${day}T${clock}:00`,naive=Date.parse(wall+'Z'),offsets=new Set<number>();
 for(let h=-48;h<=48;h+=6){const t=naive+h*3600000;offsets.add((Date.parse(localParts(t,timezone)+'Z')-t)/60000);}
 const possible=[...offsets].filter(offset=>Number.isInteger(offset)&&localParts(naive-offset*60000,timezone)===wall);if(possible.length!==1)return null;
 const offset=possible[0],abs=Math.abs(offset);return wall+(offset>=0?'+':'-')+String(Math.floor(abs/60)).padStart(2,'0')+':'+String(abs%60).padStart(2,'0');
}
export function supportedEffectTimings(context:KidsContext|null,saved:EffectPayload['timing']|null):SupportedTimings{
 const result:SupportedTimings={allDay:null,timed:null,reasons:[]};
 const accept=(t:EffectPayload['timing'])=>{const p=effectPayloadSchema.safeParse({title:'Source timing',description:'',location:'',timing:t});if(!p.success)return false;if(context){try{effectContextTiming(context,p.data.timing);}catch{return false;}}result[t.type==='all_day'?'allDay':'timed']=p.data.timing;return true;};
 if(!context){if(!saved||!accept(saved))result.reasons.push('The saved Calendar timing is unsupported or inconsistent. Clarify the source before preparing.');return result;}
 if(!context.date){result.reasons.push('This view needs a known source date.');return result;}
 const end=new Date(Date.parse((context.event?.endDate||context.date)+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 if(!accept({type:'all_day',start:context.date,end_exclusive:end,timezone:context.event?.timeZone??'Asia/Jerusalem'}))result.reasons.push('The saved date range exceeds the supported32days.');
 const e=context.event;
 if(e?.startTime&&e.endTime){const start=localInstant(context.date,e.startTime,e.timeZone),finish=localInstant(e.endDate||context.date,e.endTime,e.timeZone);if(!start||!finish||!accept({type:'timed',start,end:finish,timezone:e.timeZone}))result.reasons.push('The saved clocks are ambiguous, nonexistent or inconsistent. Use the supported all-day dates or clarify them.');}
 else result.reasons.push('Both source clocks and their time zone are needed for an exact timed event.');
 return result;
}
export const effectBytes=(e:{source_snapshot_json:string;payload_json:string;before_json:string|null;read_json:string;checks_json:string;reserved_bytes:number})=>512+googleBytes(e.source_snapshot_json)+googleBytes(e.payload_json)+googleBytes(e.before_json??'')+googleBytes(e.read_json)+googleBytes(e.checks_json)+e.reserved_bytes;
