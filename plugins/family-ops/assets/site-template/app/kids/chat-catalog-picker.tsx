'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,RefreshCw} from 'lucide-react';
import type {Kids} from '../../lib/kids';
import type {Change,Snapshot} from './kids-app';
import ChatTitle from './chat-title';

type Title={id:string;bindingId:string;title:string;kind:string;metadataHash:string;current:boolean;selectable:boolean;inReview:boolean;tracked:boolean};
type Catalog={bindingId:string;profileHash:string;needsRefresh:boolean;scan:{revision:number;generation:number;scope:'groups'|'all';status:string;canLoadMore:boolean};titles:Title[];cachedCount:number;matchingCount:number;nextCursor:string|null;coverage:string};
type Collection={bindingId:string;operationId:string;workspaceId:string;baseRevision:number;scanRevision:number;action:'continue'|'restart';scope:'groups'|'all';allTitlesConfirmed:boolean};
const endpoint='/api/kids/source/unipile/';
async function json<T>(url:string,signal:AbortSignal,body?:unknown){const r=await fetch(url,{cache:'no-store',signal,...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})}),value=await r.json() as T&{error?:string};if(!r.ok)throw new Error(value.error??'The saved title list is unavailable. Your choices are kept.');return value as T;}

export default function ChatCatalogPicker({kids,bindingId,busy,canCollect,change,accept,onWorking,onAdded}:{kids:Kids;bindingId:string;busy:boolean;canCollect:boolean;change:Change;accept:(value:Snapshot)=>void;onWorking:(busy:boolean)=>void;onAdded:(id:string)=>void}){
 const [open,setOpen]=useState(false),[search,setSearch]=useState(''),[type,setType]=useState('groups'),[data,setData]=useState<Catalog|null>(null),[titles,setTitles]=useState<Title[]>([]),[loading,setLoading]=useState(false),[error,setError]=useState(''),[allConsent,setAllConsent]=useState(false),[pendingPage,setPendingPage]=useState(false);
 const pageSize=canCollect?8:5;
 const active=useRef(false),generation=useRef(0),controller=useRef<AbortController|null>(null),pending=useRef<Collection|null>(null),focusRefresh=useRef(false),list=useRef<HTMLDivElement>(null),key='familyops.titlepage.v2:'+kids.id+':'+bindingId;
 useEffect(()=>{if(!loading&&focusRefresh.current){focusRefresh.current=false;(list.current?.querySelector<HTMLButtonElement>('button:not([disabled])')??list.current?.closest('.kids-catalog')?.querySelector<HTMLInputElement>('input[type="search"]'))?.focus();}},[loading,titles]);
 const invalidate=useCallback(()=>{generation.current++;controller.current?.abort();active.current=false;},[]);
 useEffect(()=>{try{const v=JSON.parse(sessionStorage.getItem(key)??'null');if(v?.workspaceId===kids.id&&v.bindingId===bindingId&&Number.isInteger(v.scanRevision)&&v.operationId){pending.current=v;queueMicrotask(()=>setPendingPage(true));}}catch{}return invalidate;},[kids.id,bindingId,key,invalidate]);
 const load=useCallback(async(cursor?:string)=>{
  if(active.current)return;active.current=true;const gen=++generation.current,c=new AbortController();controller.current?.abort();controller.current=c;setLoading(true);setError('');
  try{const value=await json<Catalog>(endpoint+'catalog?'+new URLSearchParams({workspace_id:kids.id,binding_id:bindingId,search,type,limit:String(pageSize),...(cursor?{cursor}:{})}),c.signal);if(gen===generation.current){setData(value);setTitles(old=>cursor?[...old,...value.titles]:value.titles);}}
  catch(e){if(!c.signal.aborted&&gen===generation.current)setError(e instanceof Error?e.message:'Could not open saved titles.');}
  finally{active.current=false;if(gen===generation.current)setLoading(false);}
 },[kids.id,bindingId,search,type,pageSize]);
 useEffect(()=>{if(!open)return;const timer=setTimeout(()=>void load(),250);return()=>{clearTimeout(timer);invalidate();};},[open,load,invalidate]);
 const collect=async(restart=false,all=false)=>{
  if(active.current||busy||!canCollect)return;active.current=true;const c=new AbortController();controller.current=c;const timer=setTimeout(()=>c.abort(),25000);setLoading(true);setError('');onWorking(true);
  try{
   if(!pending.current){const saved=await json<Snapshot>('/api/kids',c.signal),status=await json<Catalog>(endpoint+'catalog?'+new URLSearchParams({workspace_id:kids.id,binding_id:bindingId}),c.signal);if(saved.workspace?.id!==kids.id)throw new Error('Reopen the saved Kids workspace first.');pending.current={operationId:crypto.randomUUID(),workspaceId:kids.id,bindingId,baseRevision:saved.revision,scanRevision:status.scan.revision,action:restart?'restart':'continue',scope:all?'all':status.scan.scope,allTitlesConfirmed:all&&allConsent};sessionStorage.setItem(key,JSON.stringify(pending.current));setPendingPage(true);}
   const saved=await json<Snapshot>(endpoint+'chats',c.signal,pending.current);pending.current=null;setPendingPage(false);sessionStorage.removeItem(key);accept(saved);
   // A fresh cache read is separate from provider pagination.
   const value=await json<Catalog>(endpoint+'catalog?'+new URLSearchParams({workspace_id:kids.id,binding_id:bindingId,search,type,limit:String(pageSize)}),c.signal);focusRefresh.current=true;setData(value);setTitles(value.titles);
  }catch(e){setError(c.signal.aborted?'The response was interrupted. Retry the same title page to check its saved outcome.':e instanceof Error?e.message:'Titles could not be confirmed.');}
  finally{clearTimeout(timer);active.current=false;setLoading(false);onWorking(false);}
 };
 const add=async(t:Title)=>{if(!data)return;const ok=await change('addChatTitles',{bindingId:data.bindingId,scanRevision:data.scan.revision,generation:data.scan.generation,profileHash:data.profileHash,entries:[{id:t.id,metadataHash:t.metadataHash,childId:''}]});if(ok){onAdded(t.id);void load();}};
 const blocked=busy||loading;
 return <details className="kids-catalog" open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{canCollect?'Add another chat':'Search saved chat titles'} <span>Browse titles only</span></summary><div>
  {!canCollect&&<p className="kids-gap">New title collection and additions are paused. Your loaded titles are still available to search.</p>}
  <p>{canCollect?'Search loaded WhatsApp titles, then add a chat for review. Its messages stay unread until you confirm tracking.':'Adding chats is paused; you can still search saved titles.'}</p>
  <div className="kids-catalog-filters"><label>Find a chat<input type="search" value={search} maxLength={100} onChange={e=>setSearch(e.target.value)} placeholder="School, tutor, camping…"/></label><label>Chat type<select value={type} onChange={e=>setType(e.target.value)}><option value="groups">Groups</option><option value="direct">One-to-one</option><option value="all">All loaded titles</option></select></label></div>
  {error&&<div className="kids-error" role="alert"><p>{error}</p>{pendingPage?<><button className="button secondary small" disabled={blocked||!canCollect} onClick={()=>void collect()}>Retry this title page</button><button className="text-link" disabled={blocked} onClick={()=>{pending.current=null;setPendingPage(false);sessionStorage.removeItem(key);setError('');void load();}}>Check saved titles and discard request</button></>:<button className="button secondary small" disabled={blocked} onClick={()=>void load()}>Reopen loaded titles</button>}</div>}
  <p className="kids-hint" role="status">{loading?'Opening titles…':data?`${data.cachedCount} titles loaded · ${data.matchingCount} match this search`:'Open your saved chat titles.'}</p>
  {data?.needsRefresh&&<div className="kids-gap" role="status"><p>Your connection or interview changed. Refresh titles before adding another chat. Earlier names and tracking stay saved.</p><button className="button secondary small" disabled={blocked||!canCollect||pendingPage} onClick={()=>void collect(true)}>Refresh titles</button></div>}
  <div className="kids-catalog-list" ref={list}>{titles.map(t=><div key={t.bindingId+':'+t.id}><span><strong><ChatTitle title={t.title}/></strong><small>{!t.current?'From an earlier scan · refresh to add':!t.selectable?'This title cannot be tracked':t.tracked?'Already tracked':t.inReview||kids.candidates.some(c=>c.id===t.id)?'Already in your review list':'Messages not read'}</small></span><button className="button secondary small" disabled={blocked||!canCollect||data?.needsRefresh||!t.current||!t.selectable||t.inReview||kids.candidates.some(c=>c.id===t.id)} onClick={()=>void add(t)}>Add for review<ArrowRight size={14}/></button></div>)}</div>
  {data&&!titles.length&&!loading&&<p>No matching loaded titles. More may remain on WhatsApp.</p>}
  {data?.nextCursor&&<button className="text-link" disabled={blocked} onClick={()=>void load(data.nextCursor!)}>Show more loaded titles</button>}
  <p className="kids-hint">{data?.coverage}</p>
  {!pendingPage&&!data?.needsRefresh&&data?.scan.canLoadMore&&<button className="button secondary" disabled={blocked||!canCollect} onClick={()=>void collect()}>Load more titles from WhatsApp<ArrowRight size={16}/></button>}
  {!pendingPage&&data&&<details className="kids-catalog-extra"><summary>Refresh or include one-to-one titles</summary><p>Refreshing starts a new title scan and keeps earlier names and choices.</p><button className="text-link" disabled={blocked||!canCollect} onClick={()=>void collect(true)}>Refresh this title scan<RefreshCw size={14}/></button>{data.scan.scope!=='all'&&<><label className="kids-check"><input type="checkbox" checked={allConsent} disabled={blocked||!canCollect} onChange={e=>setAllConsent(e.target.checked)}/><span>Include one-to-one chat titles as well as groups. No message content is read.</span></label><button className="button secondary small" disabled={blocked||!canCollect||!allConsent} onClick={()=>void collect(true,true)}>Load group and one-to-one titles</button></>}</details>}
 </div></details>;
}
