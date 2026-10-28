import {z} from 'zod/v4';
import {KidsError} from './kids';

const uuid=z.uuid(),id=z.string().min(1).max(500),label=z.string().min(1).max(200);
export const googleHash=z.string().regex(/^[a-f0-9]{64}$/);
const date=z.iso.date(),instant=z.iso.datetime({offset:true});
const zone=z.string().min(1).max(100).refine(v=>{try{new Intl.DateTimeFormat('en',{timeZone:v});return true;}catch{return false;}},'Use an IANA time zone.');
const children=z.array(uuid).min(1).max(12).refine(v=>new Set(v).size===v.length);
const base={operation_id:uuid,workspace_id:uuid,expected_revision:z.number().int().min(1)};
export const googleStageSchema=z.strictObject({...base,parent_confirmed:z.literal(true),consent_version:z.literal('google-calendar-v1-2026-10-25'),selection:z.strictObject({link_id:id,calendar_id:id,account_label:label,calendar_label:label,child_ids:children,role:z.enum(['reported','school']),replaces_id:uuid.nullable()})});
export const googleReadSchema=z.strictObject({workspace_id:uuid,grant_id:uuid.optional(),run_id:uuid.optional(),event_id:uuid.optional(),after:uuid.optional(),grants_after:uuid.optional(),runs_after:uuid.optional(),week_start:date.optional(),child_id:uuid.optional()}).refine(a=>a.week_start?![a.grant_id,a.run_id,a.event_id,a.after,a.grants_after,a.runs_after].some(Boolean):!a.child_id,'Use only workspace, week_start and optional child_id for a saved planning week.');
export const googleBeginSchema=z.strictObject({...base,grant_id:uuid,window_start:instant,window_end:instant}).refine(a=>Date.parse(a.window_end)>Date.parse(a.window_start)&&Date.parse(a.window_end)-Date.parse(a.window_start)<=32*86400000,'Use a positive window of at most32days.');
export const googleAbandonSchema=z.strictObject({...base,run_id:uuid});
const timing=z.discriminatedUnion('type',[
 z.strictObject({type:z.literal('all_day'),start:date,end_exclusive:date,timezone:zone}).refine(a=>a.end_exclusive>a.start),
 z.strictObject({type:z.literal('timed'),start:instant,end:instant,timezone:zone}).refine(a=>Date.parse(a.end)>Date.parse(a.start)),
]);
const school=z.strictObject({status:z.enum(['open','closed','changed_hours']),start_time:z.string().regex(/^(|[0-2][0-9]:[0-5][0-9])$/),end_time:z.string().regex(/^(|[0-2][0-9]:[0-5][0-9])$/),timezone:zone.optional()}).refine(a=>(!a.start_time||a.start_time<'24:00')&&(!a.end_time||a.end_time<'24:00')&&(a.status==='closed'?!a.start_time&&!a.end_time:a.status==='changed_hours'?!!a.start_time&&!!a.end_time&&a.start_time<a.end_time:(!a.start_time&&!a.end_time)||(!!a.start_time&&!!a.end_time&&a.start_time<a.end_time)));
const content=z.strictObject({original_title:z.string().max(1000),english_title:label,description_excerpt:z.string().max(2000),description_truncated:z.boolean(),location:z.string().max(500),timing,kind:z.enum(['activity','school_notice']),school_value:school.nullable(),child_ids:children}).refine(a=>a.kind==='school_notice'||a.school_value===null);
export const googleEventSchema=z.strictObject({event_id:id,event_scope:z.enum(['single','instance','master']),series_id:z.string().max(500),original_start:z.union([date,instant,z.literal('')]),status:z.enum(['confirmed','tentative','cancelled']),provider_updated:z.union([instant,z.literal('')]),content:content.nullable()}).refine(a=>(a.event_scope==='instance'?!!a.series_id&&!!a.original_start:!a.series_id&&!a.original_start)&&(a.status==='cancelled'||!!a.content),'Instance identity and non-cancelled event content are required.');
export const googleImportSchema=z.strictObject({...base,run_id:uuid,run_request_hash:googleHash,pagination_terminal:z.boolean(),events:z.array(googleEventSchema).max(50),known_checks:z.array(z.strictObject({event_id:id,outcome:z.enum(['missing','forbidden','unavailable','capped'])})).max(50),gaps:z.array(z.string().min(1).max(200)).max(20)});
const webBase={operationId:uuid,workspaceId:uuid,baseRevision:z.number().int().min(1)};
const travel=z.enum(['walk_bike','we_drive','someone_else']).nullable();
const parentPatch=z.discriminatedUnion('field',[
 z.strictObject({field:z.literal('title'),value:z.string().trim().min(1).max(200).nullable()}),
 z.strictObject({field:z.literal('travel'),direction:z.enum(['outbound','return']),value:travel}),
 z.strictObject({field:z.literal('ignored'),value:z.boolean()}),
]);
export const googleWebSchema=z.discriminatedUnion('action',[
 z.strictObject({...webBase,action:z.literal('edit'),eventId:uuid,sourceHash:googleHash,sequence:z.number().int().min(1),patch:parentPatch}),
 z.strictObject({...webBase,action:z.literal('confirm'),grantId:uuid,proposalHash:googleHash,confirmed:z.literal(true)}),
 z.strictObject({...webBase,action:z.literal('pause'),grantId:uuid,grantRevision:z.number().int().min(1)}),
 z.strictObject({...webBase,action:z.literal('abandon'),runId:uuid}),
 z.strictObject({...webBase,action:z.literal('prune'),previewHash:googleHash,runIds:z.array(uuid).max(100),grantIds:z.array(uuid).max(100),confirmed:z.literal(true)}),
]);
export type GoogleEvent=z.infer<typeof googleEventSchema>;
export type GoogleSelection=z.infer<typeof googleStageSchema>['selection'];
export type GoogleHead={id:string;event_id:string;head_sequence:number;source_hash:string;event_scope:string;series_id:string;original_start:string};
export const googleBytes=(value:unknown)=>new TextEncoder().encode(typeof value==='string'?value:JSON.stringify(value)).length;
export async function googleSha(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(v=>v.toString(16).padStart(2,'0')).join('');}
export function googleParse<T>(schema:z.ZodType<T>,raw:unknown):T{if(googleBytes(raw)>40000)throw new KidsError('Calendar packet exceeds40,000encoded bytes. Use a narrower window; nothing was truncated.',413);const r=schema.safeParse(raw);if(!r.success)throw new KidsError('Calendar input is incomplete or unsupported. Check exact IDs, dates, instance identity and source scope.',400);return r.data;}
// Convert the local calendar date itself, including the offset at midnight.
function midnight(date:string,timezone:string){const target=Date.parse(date+'T00:00:00Z');let value=target;const format=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});for(let i=0;i<4;i++){const p=Object.fromEntries(format.formatToParts(value).map(x=>[x.type,x.value])),local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`),next=value+target-local;if(next===value)return value;value=next;}throw new KidsError('This calendar date cannot be resolved in its supplied time zone.',400);}
export function googleEventWindow(event:GoogleEvent){const t=event.content?.timing;if(!t)throw new KidsError('A new event needs explicit dates.',400);return t.type==='timed'?{start:Date.parse(t.start),end:Date.parse(t.end)}:{start:midnight(t.start,t.timezone),end:midnight(t.end_exclusive,t.timezone)};}
