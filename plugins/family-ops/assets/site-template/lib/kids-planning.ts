import {kidsToday} from './kids-schedule';

export function shiftKidsDay(day:string,offset:number){const value=new Date(day+'T12:00:00Z');value.setUTCDate(value.getUTCDate()+offset);return value.toISOString().slice(0,10);}
/** Date-only Sunday–Saturday planning, independent of Israel's changing UTC offset. */
export function kidsPlanningSelection(now:Date=new Date(),requested:string|null=null){
 const today=kidsToday(now),weekday=new Date(today+'T12:00:00Z').getUTCDay(),thisWeek=shiftKidsDay(today,-weekday),nextWeek=shiftKidsDay(thisWeek,7),last=shiftKidsDay(thisWeek,13);
 const real=requested&&/^\d{4}-\d{2}-\d{2}$/.test(requested)&&Number.isFinite(Date.parse(requested+'T12:00:00Z'))&&new Date(requested+'T12:00:00Z').toISOString().slice(0,10)===requested;
 const selected=real&&requested>=thisWeek&&requested<=last?requested:today,isNextWeek=selected>=nextWeek,start=isNextWeek?nextWeek:thisWeek;
 return {today,thisWeek,nextWeek,selected,isNextWeek,days:Array.from({length:7},(_,i)=>shiftKidsDay(start,i))};
}
