import {kidsTaskNeeded,kidsTaskRemainingChildren,type Kids} from './kids';
import {boardActivitiesFor,type BoardActivity} from './kids-calendar-projection';

/** Same selected-day projection as Today. This only prepares text, never sends it. */
export function kidsDaySummary(kids:Kids,activities:BoardActivity[],day:string,child:string,options:{tasks:boolean;locations:boolean;calendarReady:boolean;sourceManagedTasks:readonly string[]}){
 const sourceManaged=new Set(options.sourceManagedTasks);
 const date=new Intl.DateTimeFormat('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Jerusalem'}).format(new Date(day+'T12:00:00Z'));
 const names=(ids:string[])=>ids.map(id=>kids.children.find(c=>c.id===id)?.name??'Family').join(' & ');
 const scope=child?kids.children.find(c=>c.id===child)?.name??'Family':'Everyone';
 const items=boardActivitiesFor(activities,day,child),lines=[`Family plan · ${date}`,scope,''];
 for(const a of items){
  const timing=a.startTime&&a.endTime?`${a.startTime}–${a.endTime}`:a.startTime?`Starts ${a.startTime}`:a.endTime?`Ends ${a.endTime}`:'Time not given';
  lines.push(`• ${timing} · ${a.title} · ${names(a.childIds)}${a.sourceKind==='parent'?a.session.completed?' · Parent-entered · Done':' · Parent-entered':''}`);
  if(options.locations&&a.location)lines.push(`  ${a.location}`);
  const travel=(direction:'outbound'|'return')=>a.travel[direction]==='we_drive'?(direction==='outbound'?'We drop off':'We pick up'):a.travel[direction]==='walk_bike'?'Walk / bike':a.travel[direction]==='someone_else'?'Someone else':'';
  const there=travel('outbound'),home=travel('return');if(there||home)lines.push(`  ${[there&&`There: ${there}`,home&&`Home: ${home}`].filter(Boolean).join(' · ')}`);
 }
 if(!items.length)lines.push(options.calendarReady?'No activities recorded for this day.':'No activities in the available saved records; Calendar check incomplete.');
 for(const c of kids.contexts.filter(c=>c.parentEntry&&c.parentEntry.category!=='task'&&!c.parentEntry.archivedAt&&!c.filed&&c.date===day&&(!child||!c.childIds.length||c.childIds.includes(child))))lines.push(`• ${c.title} · ${c.childIds.length?names(c.childIds):'Family'} · Parent-entered${c.event?.startTime?' · '+c.event.startTime+(c.event.endTime?'–'+c.event.endTime:''):''}`);
 if(options.tasks){
  const due=kids.contexts.flatMap(c=>c.tasks.filter(t=>t.resolution==='open'&&!!t.due&&t.due<=day&&kidsTaskNeeded(c,t,sourceManaged,child)).map(t=>({c,t})));
  if(due.length){lines.push('','To do · due by this day');for(const {c,t}of due)lines.push(`• ${t.title} · ${t.childId?names([t.childId]):kidsTaskRemainingChildren(c,t,sourceManaged)?.length?names(kidsTaskRemainingChildren(c,t,sourceManaged)!):'Everyone'}${t.due<day?` · overdue (${t.due})`:''}${c.filed?' · from a filed update':''}`);}
 }
 lines.push('','Israel time · saved plan, not a live attendance check.',options.calendarReady?'Check the latest messages for changes.':'Calendar check incomplete; other activities may be missing.');
 return lines.join('\n');
}
