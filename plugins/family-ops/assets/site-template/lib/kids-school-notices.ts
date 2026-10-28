import type {resolveSchoolDay} from './kids-school';
type Day=ReturnType<typeof resolveSchoolDay>;
/** The compact board shows dated source notices, never a baseline alone. */
export function schoolBoardNotices(days:Day[],date:string,child=''){
 return days.filter(d=>d.date===date&&(!child||d.childId===child)&&(d.notices.length>0||d.reported.length>0||d.needsReview.length>0))
  .map(d=>({...d,status:d.notices.length||d.needsReview.length?d.status:'unknown' as const}));
}
