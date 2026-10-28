import type {ParentSession} from './kids-parent-activities';
import type {KidsContext} from './kids';
import type {GoogleEvent} from './kids-google';
import {kidsToday} from './kids-schedule';
import {shiftKidsDay} from './kids-planning';

export type TravelMode='walk_bike'|'we_drive'|'someone_else';
export const travelMode=(v:unknown):TravelMode|null=>v==='walk_bike'||v==='we_drive'||v==='someone_else'?v:null;
export type GooglePlanningEvent={id:string;grantId:string;sourceHash:string;sequence:number;title:string;location:string;childIds:string[];first:string;last:string;startTime:string;endTime:string;allDay:boolean;kind:'activity'|'school_notice';schoolValue:NonNullable<GoogleEvent['content']>['school_value'];eventScope:GoogleEvent['event_scope'];status:GoogleEvent['status'];needsReview:boolean;grantStatus:string;role:string;serviceActive:boolean;readComplete:boolean;observedAt:number;ignored:boolean;travel:{outbound:TravelMode|null;return:TravelMode|null}};
type Common={id:string;title:string;location:string;childIds:string[];first:string;last:string;startTime:string;endTime:string;travel:{outbound:TravelMode|null;return:TravelMode|null}};
export type BoardActivity=Common&({sourceKind:'whatsapp';context:KidsContext}|{sourceKind:'google-calendar';calendar:GooglePlanningEvent}|{sourceKind:'parent';session:ParentSession});
const time=(value:number)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(value);
export function googlePlanningEvent(row:{id:string;grant_id:string;source_hash:string;head_sequence:number;source_json:string;needs_review:number;overrides_json:string;observed_at:number;grant_status:string;role:string;read_complete:number},serviceActive:boolean):GooglePlanningEvent|null{
 const source=JSON.parse(row.source_json) as GoogleEvent,c=source.content;if(!c)return null;
 const o=JSON.parse(row.overrides_json) as Record<string,unknown>,travel=o.travel&&typeof o.travel==='object'?o.travel as Record<string,unknown>:{},t=c.timing;
 const first=t.type==='all_day'?t.start:kidsToday(new Date(t.start)),last=t.type==='all_day'?shiftKidsDay(t.end_exclusive,-1):kidsToday(new Date(Date.parse(t.end)-1));
 return {id:row.id,grantId:row.grant_id,sourceHash:row.source_hash,sequence:row.head_sequence,title:typeof o.title==='string'&&o.title.trim()?o.title:c.english_title,location:c.location,childIds:c.child_ids,first,last,startTime:t.type==='timed'?time(Date.parse(t.start)):'',endTime:t.type==='timed'?(kidsToday(new Date(t.end))!==last&&time(Date.parse(t.end))==='00:00'?'24:00':time(Date.parse(t.end))):'',allDay:t.type==='all_day',kind:c.kind,schoolValue:c.school_value,eventScope:source.event_scope,status:source.status,needsReview:!!row.needs_review,grantStatus:row.grant_status,role:row.role,serviceActive,readComplete:!!row.read_complete,observedAt:row.observed_at,ignored:o.ignored===true,travel:{outbound:travelMode(travel.outbound),return:travelMode(travel.return)}};
}
export function boardActivities(contexts:KidsContext[],events:GooglePlanningEvent[],parent:ParentSession[]=[]):BoardActivity[]{
 return [...contexts.filter(c=>!c.parentEntry&&(c.kind==='activity'||c.kind==='trip')&&!c.filed&&c.childIds.length>0&&new Set(c.childIds).size===c.childIds.length&&!!c.date).map(c=>({sourceKind:'whatsapp' as const,id:c.id,context:c,title:c.title,location:c.event?.location??'',childIds:c.childIds,first:c.date,last:c.event?.endDate||c.date,startTime:c.event?.startTime??'',endTime:c.event?.endTime??'',travel:{outbound:c.travel?.outbound??null,return:c.travel?.return??null}})),...events.filter(e=>e.kind==='activity'&&e.eventScope!=='master'&&e.status!=='cancelled'&&!e.ignored).map(e=>({sourceKind:'google-calendar' as const,id:e.id,calendar:e,title:e.title,location:e.location,childIds:e.childIds,first:e.first,last:e.last,startTime:e.startTime,endTime:e.endTime,travel:e.travel})),...parent.map(session=>({sourceKind:'parent' as const,id:session.id,session,title:session.definition.title,location:session.definition.location,childIds:[session.definition.childId],first:session.day,last:session.day,startTime:session.definition.startTime,endTime:session.definition.endTime,travel:session.travel}))];
}
export function boardActivitiesFor(activities:BoardActivity[],day:string,child=''){
 return activities.filter(a=>a.first<=day&&a.last>=day&&(!child||a.childIds.includes(child))).map(a=>({...a,startTime:day===a.first?a.startTime:'',endTime:day===a.last?a.endTime:''})).sort((a,b)=>(a.startTime||'99:99').localeCompare(b.startTime||'99:99')||a.sourceKind.localeCompare(b.sourceKind)||a.id.localeCompare(b.id));
}
