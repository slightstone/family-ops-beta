import type {ParentItemDefinition} from '../../lib/kids-parent-items';
import type {ParentDefinition} from '../../lib/kids-parent-activities';
type Person={id:string;name:string};
const person=(id:string,people:Person[])=>id?people.find(p=>p.id===id)?.name||'Selected person':'Family';
export const manualTime=(d:{startTime:string;endTime:string})=>d.startTime&&d.endTime?d.startTime+'–'+d.endTime:d.startTime?'Starts '+d.startTime:d.endTime?'Ends '+d.endTime:'Time not provided';
export function parentItemDraft(d:ParentItemDefinition,people:Person[]){
 const kind={task:'Task',homework:'Homework',test:'Test',reminder:'Reminder',preparation:'Preparation'}[d.category];
 return ['What: '+(d.title||'Untitled item'),'For: '+(d.childIds.length?d.childIds.map(id=>person(id,people)).join(', '):'Family'),'Kind: '+kind,'Date: '+(d.date||'Not provided'),d.event?manualTime(d.event):'Time not provided',d.event?.location?'Place: '+d.event.location:'',d.notes?'Notes:\n'+d.notes:'',...d.tasks.map((t,i)=>(i+1)+'. '+(t.title||'Untitled checklist item')+' — '+person(t.childId,people)+(t.due?' · Due '+t.due:''))].filter(Boolean).join('\n');
}
export function parentActivityDraft(d:ParentDefinition,people:Person[],effective:string,ending=false){const days=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];return [(ending?'End activity: ':'Activity: ')+(d.title||'Untitled activity'),'For: '+person(d.childId,people),'Apply from: '+effective,ending?'':d.schedule.type==='once'?'Date: '+d.schedule.date:'Weekly: '+d.schedule.days.map(n=>days[n]).join(', ')+' · from '+d.schedule.start+(d.schedule.until?' until '+d.schedule.until:''),ending?'':manualTime(d),!ending&&d.location?'Place: '+d.location:''].filter(Boolean).join('\n');}
