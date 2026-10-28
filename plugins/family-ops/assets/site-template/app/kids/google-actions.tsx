'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {RefreshCw} from 'lucide-react';

type Endpoint='/api/kids/google'|'/api/kids/google-effects';
type Pending={endpoint:Endpoint;body:Record<string,unknown>;label:string;confirmed?:string};
export function useGoogleActions(refresh:()=>Promise<void>){
 const [pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[requiresReopen,setRequiresReopen]=useState(false),[message,setMessage]=useState(''),[generation,setGeneration]=useState(0),[resetGeneration,setResetGeneration]=useState(0);
 const lastResult=useRef<{operationId:string;effectId?:string}|null>(null),request=useRef<Pending|null>(null),flight=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const perform=useCallback(async(value:Pending)=>{if(flight.current)return false;if(request.current&&(request.current.endpoint!==value.endpoint||JSON.stringify(request.current.body)!==JSON.stringify(value.body)))return false;const captured=request.current??{endpoint:value.endpoint,body:JSON.parse(JSON.stringify(value.body)) as Record<string,unknown>,label:value.label,confirmed:value.confirmed};request.current=captured;setPending(captured);flight.current=true;setBusy(true);setError('');setRequiresReopen(false);setMessage('');try{const r=await fetch(captured.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(captured.body)});setRequiresReopen(r.status>=400&&r.status<500);const v=await r.json().catch(()=>({error:'The Calendar reply could not be read. Check the saved version before making another change.'})) as {saved?:boolean;effectId?:string;error?:string};if(!r.ok||v.saved!==true){throw new Error(v.error??'This Calendar change was not confirmed.');}if(alive.current){lastResult.current={operationId:String(captured.body.operationId),...(typeof v.effectId==='string'?{effectId:v.effectId}:{})};request.current=null;setPending(null);setMessage('Calendar change saved');setGeneration(x=>x+1);await refresh();}return true;}catch(e){if(alive.current)setError(e instanceof TypeError?'The reply was interrupted. Retry this exact request to check whether it saved.':e instanceof Error?e.message:'This Calendar change could not be confirmed.');return false;}finally{flight.current=false;if(alive.current)setBusy(false);}},[refresh]);
 const send=useCallback((body:Record<string,unknown>,label='Requested Calendar change',confirmed?:string,endpoint:Endpoint='/api/kids/google')=>perform({endpoint,body,label,confirmed}),[perform]);
 const retry=()=>!requiresReopen&&request.current?perform(request.current):Promise.resolve(false);
 const reopen=async()=>{if(flight.current)return;request.current=null;setPending(null);setError('');setRequiresReopen(false);setMessage('');setResetGeneration(x=>x+1);setGeneration(x=>x+1);await refresh();};
 return {pending,busy,error,requiresReopen,message,generation,resetGeneration,blocked:busy||!!pending,send,retry,reopen,lastResult};
}
export type GoogleActions=ReturnType<typeof useGoogleActions>;
export function GoogleRequestStatus({actions,location}:{actions:GoogleActions;location:string}){
 const box=useRef<HTMLDivElement>(null),route=useSearchParams().toString();
 useEffect(()=>{if(actions.error&&actions.pending){box.current?.scrollIntoView({block:'start'});box.current?.focus({preventScroll:true});}},[actions.error,actions.pending,route,location]);
 if(actions.error&&actions.pending)return <div className="kids-error" role="alert" ref={box} tabIndex={-1}><strong>Calendar change needs attention</strong><p>{actions.error}</p><p><strong>Requested: {actions.pending.label}</strong></p>{actions.pending.confirmed&&<p>Last confirmed: <strong>{actions.pending.confirmed}</strong></p>}<p>{actions.requiresReopen?'The saved version or access changed. Reopen the saved Calendar version before making a new change. Your earlier saved choices are kept.':'This request stays with you as you browse. An interrupted reply does not confirm whether it saved.'}</p><div>{!actions.requiresReopen&&<button className="button small" disabled={actions.busy} onClick={()=>void actions.retry()}><RefreshCw size={16}/>Retry this exact Calendar change</button>}<button className="button secondary small" disabled={actions.busy} onClick={()=>void actions.reopen()}>Reopen saved Calendar version (discard pending edit)</button></div></div>;
 return actions.pending?<p className="kids-school-saved" role="status">Saving Calendar change · {actions.pending.label}. Last confirmed choices remain shown.</p>:actions.message?<p className="kids-school-saved" role="status">{actions.message}</p>:null;
}
