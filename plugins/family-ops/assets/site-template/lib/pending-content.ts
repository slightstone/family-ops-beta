'use client';
import {useSyncExternalStore} from 'react';
// Coordination only: no family content, identity, invitation or request body is stored here.
// A separate key per request avoids cross-tab read/modify/write lost updates.
const prefix='family-ops-unconfirmed-content-v1:',event='family-ops-unconfirmed-content-change';
function keys(){const found:string[]=[];for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix))found.push(key);}return found;}
function changed(){window.dispatchEvent(new Event(event));}
export function pendingEntries(){try{return keys().length;}catch{return -1;}}
export function markPending(id:string){localStorage.setItem(prefix+id,'pending');changed();}
export function clearPending(id:string){localStorage.removeItem(prefix+id);changed();}
export function clearAllPending(){for(const key of keys())localStorage.removeItem(key);changed();}
export function hasPending(id:string){try{return localStorage.getItem(prefix+id)!==null;}catch{return true;}}
export function listenPending(fn:()=>void){const listener=()=>fn();window.addEventListener('storage',listener);window.addEventListener(event,listener);return()=>{window.removeEventListener('storage',listener);window.removeEventListener(event,listener);};}

const unavailableOnServer=()=>-1;
export function usePendingEntries(){return useSyncExternalStore(listenPending,pendingEntries,unavailableOnServer);}
