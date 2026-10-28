'use client';
import {useEffect,useRef,useState} from 'react';
import {Copy,X,RefreshCw} from 'lucide-react';
import type {Kids} from '../../lib/kids';
import type {BoardActivity} from '../../lib/kids-calendar-projection';
import {kidsDaySummary} from '../../lib/kids-day-summary';

export default function DayShare({kids,activities,day,person,revision,ready,sourceManagedTasks}:{sourceManagedTasks:string[];kids:Kids;activities:BoardActivity[];day:string;person:string;revision:number;ready:boolean}){
 const [preview,setPreview]=useState<{key:string;text:string}|null>(null),[tasks,setTasks]=useState(false),[locations,setLocations]=useState(true),[result,setResult]=useState<{key:string;text:string;success:boolean}|null>(null);
 const panel=useRef<HTMLElement>(null),trigger=useRef<HTMLButtonElement>(null),key=JSON.stringify([kids.id,revision,day,person,ready,activities]),isOpen=!!preview;
 useEffect(()=>{if(!isOpen)return;panel.current?.focus({preventScroll:true});const escape=(e:KeyboardEvent)=>{if(e.key==='Escape'){setPreview(null);trigger.current?.focus();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[isOpen]);
 const prepare=(includeTasks=tasks,includeLocations=locations)=>{setPreview({key,text:kidsDaySummary(kids,activities,day,person,{tasks:includeTasks,locations:includeLocations,calendarReady:ready,sourceManagedTasks})});setResult(null);};
 const currentResult=result?.key===key&&result.text===preview?.text?result:null;
 const copy=async()=>{if(!preview)return;try{if(!navigator.clipboard?.writeText)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(preview.text);setResult({...preview,success:true});}catch{setResult({...preview,success:false});}};
 const stale=preview?.key!==key,close=()=>{setPreview(null);trigger.current?.focus();};
 return <div className="family-share"><button ref={trigger} className="kids-text-button" aria-expanded={isOpen} onClick={()=>preview?close():prepare()}><Copy size={15}/>Copy this day</button>{preview&&<section ref={panel} tabIndex={-1} className="family-share-preview" aria-label="Preview day summary">
  <div className="family-panel-title"><h2>Share a day’s plan</h2><button className="icon-button" aria-label="Close day summary" onClick={close}><X size={18}/></button></div>
  <div className="family-share-body"><p className="family-footnote">Review what you want to share, then copy it into WhatsApp or another app.</p><div className="family-share-options"><label><input type="checkbox" checked={locations} onChange={e=>{setLocations(e.target.checked);prepare(tasks,e.target.checked);}}/>Include places</label><label><input type="checkbox" checked={tasks} onChange={e=>{setTasks(e.target.checked);prepare(e.target.checked,locations);}}/>Include due and overdue tasks</label></div><label className="family-share-text">Text to copy<textarea readOnly value={preview.text} rows={8} onFocus={e=>e.currentTarget.select()}/></label></div>
  <footer className="family-share-footer">{stale&&<p className="kids-gap" role="status">The board or selected day changed. Refresh the preview before copying.</p>}{currentResult&&!currentResult.success&&<p className="kids-gap" role="alert">Copy is unavailable. Select and copy the text above.</p>}<div className="kids-school-actions">{stale?<button className="button secondary small" onClick={()=>prepare()}><RefreshCw size={14}/>Refresh preview</button>:<button className="button secondary small" disabled={preview.text.length>30000} onClick={()=>void copy()}><Copy size={14}/>{currentResult?.success?'Copied':'Copy summary'}</button>}<button className="kids-text-button" onClick={close}>Close</button></div>{currentResult?.success&&<p className="family-footnote" role="status">Summary copied. Choose where to paste it.</p>}{preview.text.length>30000&&<p className="kids-gap">This summary is too long. Choose a child or leave out tasks, then refresh.</p>}</footer>
 </section>}</div>;
}
