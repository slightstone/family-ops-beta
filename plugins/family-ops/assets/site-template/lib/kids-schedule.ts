import type {KidsContext} from './kids';

export function kidsToday(now:Date=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const value=(type:string)=>parts.find(p=>p.type===type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
export function kidsWeek(now:Date=new Date()){
  const first=kidsToday(now);
  return Array.from({length:7},(_,i)=>{const d=new Date(first+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+i);return d.toISOString().slice(0,10);});
}
export function kidsDayLabel(day:string,full=false){
  return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jerusalem',weekday:full?'long':'short',day:'numeric',...(full?{month:'long' as const}: {})}).format(new Date(day+'T12:00:00Z'));
}
export function kidsScheduleFor(contexts:KidsContext[],day:string,childId=''){
  return contexts.filter(c=>c.kind==='activity'&&!c.filed&&c.childIds.length>0&&new Set(c.childIds).size===c.childIds.length&&(!childId||c.childIds.includes(childId))&&c.date!==''&&c.date<=day&&(c.event?.endDate||c.date)>=day)
    .sort((a,b)=>(a.event?.startTime||'99:99').localeCompare(b.event?.startTime||'99:99')||a.key.localeCompare(b.key)||a.id.localeCompare(b.id));
}
export function kidsScheduleTime(c:KidsContext){
  const e=c.event;
  if(e?.endDate&&e.endDate!==c.date)return `Starts ${kidsDayLabel(c.date)}${e.startTime?' at '+e.startTime:''} · Ends ${kidsDayLabel(e.endDate)}${e.endTime?' at '+e.endTime:''} · Israel time`;
  if(e?.startTime&&e.endTime)return `${e.startTime}–${e.endTime} · Israel time`;
  if(e?.startTime)return `Starts ${e.startTime} · Israel time`;
  if(e?.endTime)return `Ends ${e.endTime} · Israel time`;
  return 'Time not given';
}
