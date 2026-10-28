'use client';
import {useEffect,useRef} from 'react';
export type BoardListState={showAllTasks:boolean;historyOpen:boolean;tasksOpen:boolean};
type Origin={token:string;record:string;url:string;y:number;invoker:string;at:number;ui:BoardListState};
const tokenPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const validURL=(url:unknown):url is string=>typeof url==='string'&&url.length<=1800&&/^\/kids(?:\?|$)/.test(url)&&new URL(url,'https://family.invalid').origin==='https://family.invalid'&&new URL(url,'https://family.invalid').pathname==='/kids';
/** Entry-specific, workspace-scoped navigation only; never replace router history fields. */
export function useBoardOrigin(workspace:string,url:string,record:string|null,token:string|null,ui:BoardListState,restoreUI:(state:BoardListState)=>void){
 const key='family-ops:list-origin:'+workspace,cache=useRef<{key:string;entries:Origin[]}>({key,entries:[]}),last=useRef<{record:string;token:string|null}|null>(null),fallbackTop=useRef(false),restore=useRef(restoreUI);restore.current=restoreUI;
 const read=()=>{
  if(cache.current.key!==key){cache.current={key,entries:[]};last.current=null;fallbackTop.current=false;}
  try{const text=sessionStorage.getItem(key)??'[]';const raw:unknown=text.length<=22000?JSON.parse(text):[];if(Array.isArray(raw))cache.current.entries=raw.filter((v):v is Origin=>!!v&&typeof v.token==='string'&&tokenPattern.test(v.token)&&typeof v.record==='string'&&v.record.length<=220&&validURL(v.url)&&Number.isFinite(v.y)&&v.y>=0&&v.y<=1000000&&typeof v.invoker==='string'&&v.invoker.length<=220&&Number.isFinite(v.at)&&Date.now()-v.at>=0&&Date.now()-v.at<86400000&&!!v.ui&&['showAllTasks','historyOpen','tasksOpen'].every(k=>typeof v.ui[k]==='boolean')).slice(-8);}catch{}return cache.current.entries;
 };
 const current=()=>read().find(x=>x.token===token&&x.record===record);
 const remember=(nextRecord:string,invoker?:string)=>{
  const prior=record?current():undefined;if(record&&!prior||!prior&&!validURL(url))return undefined;
  const nextToken=crypto.randomUUID(),entry:Origin=prior?{...prior,token:nextToken,record:nextRecord,at:Date.now()}:{token:nextToken,record:nextRecord,url,y:Math.min(1000000,Math.max(0,window.scrollY)),invoker:(invoker??document.activeElement?.id??'').slice(0,220),at:Date.now(),ui};
  cache.current.entries=[...read(),entry].slice(-8);try{sessionStorage.setItem(key,JSON.stringify(cache.current.entries));}catch{}return nextToken;
 };
 const destination=(fallback:string)=>{const entry=current();fallbackTop.current=!entry;return entry?.url??fallback;};
 useEffect(()=>{
  read();if(record){last.current={record,token};return;}
  const previous=last.current;last.current=null;const entry=previous?read().find(x=>x.token===previous.token&&x.record===previous.record&&x.url===url):undefined,top=fallbackTop.current;fallbackTop.current=false;if(!entry&&!top)return;
  if(entry)restore.current(entry.ui);
  let frame=0,stopped=false;const started=performance.now();const position=()=>{if(stopped)return;const invoker=entry?document.getElementById(entry.invoker):null,visible=invoker&&invoker.getClientRects().length>0&&!invoker.closest('details:not([open])'),target=visible?invoker:document.getElementById('family-board-heading');target?.focus({preventScroll:true});window.scrollTo(0,entry?.y??0);if(entry&&performance.now()-started<1800&&(!visible||Math.abs(window.scrollY-entry.y)>2))frame=requestAnimationFrame(position);};frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(position);});return()=>{stopped=true;cancelAnimationFrame(frame);};
 // Only route-entry transitions restore lists, never a save/source refresh.
 },[record,token,url,key]);
 return {remember,destination};
}
