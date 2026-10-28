'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowRight,CheckCircle2,RefreshCw,ShieldCheck} from 'lucide-react';
import type {Kids} from '../../lib/kids';
import type {Change,Snapshot} from './kids-app';

type Setup={workspaceId?:string;setupId?:string;status:string;connected:boolean;syncStatus:string;expiresAt?:number;retryAt?:number|null;serverNow?:number;message:string;recovery?:string|null;pairedCheck?:boolean;allowNewQr?:boolean;canRecover?:boolean;recoveryResult?:string|null;recoveryRequest?:AuthRequest;link?:string};
type RequestBody={operationId:string;workspaceId:string;baseRevision:number};
type AuthRequest=RequestBody&{consentVersion:string;vendorSyncConfirmed:true;recover?:string};
type DiscoveryRequest=RequestBody&{scanRevision:number;action:'continue';scope:'groups'|'all';allTitlesConfirmed:false};
type Journal={auth?:AuthRequest;discovery?:RequestBody|DiscoveryRequest};
type Action='status'|'connect'|'resume'|'restart'|'recover'|'discover'|'reopen';
const endpoint='/api/kids/source/unipile/',consentVersion='unipile-v2-2026-10-23';
function loadJournal(key:string,workspaceId:string):Journal{try{const v=JSON.parse(sessionStorage.getItem(key)??'{}');if(!v||typeof v!=='object'||Array.isArray(v))return {};const valid=(b:RequestBody)=>b&&/^[a-f0-9-]{36}$/i.test(b.operationId)&&b.workspaceId===workspaceId&&Number.isSafeInteger(b.baseRevision)&&b.baseRevision>0;return {...(valid(v.auth)&&v.auth.consentVersion===consentVersion&&v.auth.vendorSyncConfirmed===true?{auth:v.auth}:{}),...(valid(v.discovery)?{discovery:v.discovery}:{})};}catch{return {};}}
function saveJournal(key:string,journal:Journal){try{sessionStorage.setItem(key,JSON.stringify(journal));}catch{/* Owned server status and the saved board also support recovery. */}}
async function json<T>(url:string,signal:AbortSignal,body?:unknown){const r=await fetch(url,{cache:'no-store',signal,...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const value=await r.json() as T&{error?:string};if(!r.ok)throw new Error(value.error??'This setup could not be confirmed. Check its saved status before trying again.');return value;}

export default function HostedSetup({kids,data,disabled,change,accept,onWorking}:{kids:Kids;data:Snapshot;disabled:boolean;change:Change;accept:(value:Snapshot)=>void;onWorking:(busy:boolean)=>void}){
 const [consent,setConsent]=useState(false),[setup,setSetup]=useState<Setup|null>(null),[error,setError]=useState(''),[phase,setPhase]=useState(''),[checked,setChecked]=useState(false);
 const alive=useRef(false),generation=useRef(0),inFlight=useRef(false),controller=useRef<AbortController|null>(null),errorRef=useRef(false),failedDiscovery=useRef(false),setupRef=useRef<Setup|null>(null);
 const key='familyops.hosted.v1:'+kids.id,journal=useRef<Journal>(null);if(journal.current===null)journal.current=loadJournal(key,kids.id);
 const run=useCallback(async(action:Action,automatic=false)=>{
  if(inFlight.current)return;inFlight.current=true;const gen=++generation.current,c=new AbortController();controller.current?.abort();controller.current=c;const timer=setTimeout(()=>c.abort(),25000);let parentBusy=false;
  const current=()=>alive.current&&generation.current===gen&&!c.signal.aborted;
  const working=(label:string)=>{if(current()){setPhase(label);onWorking(true);parentBusy=true;}};
  const fresh=async()=>{const saved=await json<Snapshot>('/api/kids',c.signal);if(saved.workspace?.id!==kids.id)throw new Error('This Kids workspace changed. Reopen its saved version before connecting.');return saved;};
  if(!automatic){errorRef.current=false;setError('');}
  try{
   if(action==='reopen'){working('Reopening saved Kids…');const saved=await fresh();journal.current!.discovery=undefined;saveJournal(key,journal.current!);failedDiscovery.current=true;if(current())accept(saved);return;}
   let result:Setup;
   if(action==='connect'||action==='restart'){
    if(!consent)throw new Error('Confirm the WhatsApp connection and storage details first.');working('Preparing your connection…');let saved=await fresh();
    if(!saved.hostedSetupEnabled)throw new Error('Hosted WhatsApp setup is not available for this account yet. Your board is saved.');
    if(saved.workspace!.mode!=='live'||!saved.workspace!.discoveryConsent){if(!await change('liveDiscovery',{consent:true}))return;saved=await fresh();}
    const savedDraft=journal.current!.auth,draft=action==='connect'||savedDraft?.operationId!==setupRef.current?.setupId?savedDraft:undefined;
    const body=draft??{operationId:crypto.randomUUID(),workspaceId:kids.id,baseRevision:saved.revision,consentVersion,vendorSyncConfirmed:true as const};
    if(action==='restart')journal.current!.discovery=undefined;journal.current!.auth=body;saveJournal(key,journal.current!);result=await json<Setup>(endpoint+'auth',c.signal,body);
   }else if(action==='recover'){
    if(!consent)throw new Error('Confirm the WhatsApp connection and storage details first.');
    working('Checking paired WhatsApp…');const owned=setupRef.current;if(!owned?.setupId)throw new Error('Check your saved setup first.');
    const saved=await fresh(),draft=journal.current!.auth;
    const body:AuthRequest=draft?.recover&&draft.recover===owned.setupId?draft:{operationId:crypto.randomUUID(),workspaceId:kids.id,baseRevision:saved.revision,consentVersion,vendorSyncConfirmed:true,recover:owned.setupId};
    journal.current!.auth=body;saveJournal(key,journal.current!);result=await json<Setup>(endpoint+'auth',c.signal,body);
   }else if(action==='resume'){
    working(setupRef.current?.pairedCheck?'Checking paired WhatsApp…':'Checking your saved connection…');const owned=setupRef.current;if(!owned?.setupId)throw new Error('Check your saved setup before continuing.');result=await json<Setup>(endpoint+'auth',c.signal,{resume:owned.setupId});
   }else result=await json<Setup>(endpoint+'auth',c.signal);
   if(!current())return;if(result.workspaceId&&result.workspaceId!==kids.id)throw new Error('This setup belongs to another saved Kids workspace. Reopen Kids before continuing.');setupRef.current=result;setSetup(result);setChecked(true);if(result.recoveryRequest){journal.current!.auth=result.recoveryRequest;saveJournal(key,journal.current!);}if(result.status==='removed'){journal.current={};saveJournal(key,{});setConsent(false);}if(result.status==='not_started'){journal.current!.auth=undefined;saveJournal(key,journal.current!);}
   if(result.connected&&(action==='discover'||!failedDiscovery.current)){
    let saved=await fresh();if(!saved.workspace!.discoveryConsent){if(action!=='discover'||!consent)return;working('Restoring chat-title discovery…');if(!await change('liveDiscovery',{consent:true}))return;saved=await fresh();journal.current!.discovery=undefined;}
    working('Loading chat titles…');const status=await json<{scan:{revision:number;scope:'groups'|'all'}}> (endpoint+'catalog?workspace_id='+kids.id,c.signal);const body=journal.current!.discovery??{operationId:crypto.randomUUID(),workspaceId:kids.id,baseRevision:saved.revision,scanRevision:status.scan.revision,action:'continue' as const,scope:status.scan.scope,allTitlesConfirmed:false as const};journal.current!.discovery=body;saveJournal(key,journal.current!);
    let discovered:Snapshot;try{discovered=await json<Snapshot>(endpoint+'chats',c.signal,body);}catch(e){failedDiscovery.current=true;throw e;}
    if(!current())return;failedDiscovery.current=false;journal.current={};saveJournal(key,{});accept(discovered);await change('step',{step:'chats'});return;
   }
   if(result.link&&action!=='status'){
    const link=new URL(result.link);if(link.protocol!=='https:'||link.hostname!=='auth.unipile.com'||link.port||link.username||link.password)throw new Error('The WhatsApp connection link could not be verified. Check setup again.');
    // The auth capability stays in this response/navigation only, never storage.
    working('Opening WhatsApp connection…');window.location.assign(link.href);
   }
  }catch(e){if(alive.current&&generation.current===gen){errorRef.current=true;setError(c.signal.aborted||e instanceof TypeError?'The connection was interrupted. Your saved board is kept. Check setup or retry this same step to confirm its outcome.':e instanceof Error?e.message:'This setup could not be confirmed. Check its saved status.');}}
  finally{clearTimeout(timer);if(parentBusy)onWorking(false);if(alive.current&&generation.current===gen)setPhase('');inFlight.current=false;}
 },[kids.id,consent,key,change,accept,onWorking]);
 const runRef=useRef(run);useEffect(()=>{runRef.current=run;},[run]);
 const invalidate=useCallback(()=>{alive.current=false;generation.current++;controller.current?.abort();},[]);
 useEffect(()=>{alive.current=true;if(data.hostedSetupEnabled)void runRef.current('status',true);const timer=setInterval(()=>{if(data.hostedSetupEnabled&&!errorRef.current&&!inFlight.current&&!['connected','removed'].includes(setupRef.current?.status??''))void runRef.current('status',true);},5000);return()=>{invalidate();clearInterval(timer);};},[kids.id,data.hostedSetupEnabled,invalidate]);
 const busy=!!phase,blocked=disabled||busy,exists=setup&&setup.status!=='not_started',expired=setup?.recovery==='check_expired_setup',unresolvedScope=setup?.status==='scope_unknown'||setup?.status==='scope_creating',removing=data.hostedConnection.pending||setup?.status==='removing',canRecover=!!setup?.canRecover,restartAllowed=setup?.status==='removed'||!!setup?.allowNewQr||setup?.status!=='removing'&&expired&&!unresolvedScope&&!canRecover&&!setup?.pairedCheck,pairedWaiting=setup?.pairedCheck&&setup.status==='verifying'&&!!setup.retryAt&&setup.retryAt>(setup.serverNow??0);
 return <div className="kids-panel kids-live-panel kids-hosted-panel">
  <span className="tag light">{data.hostedSetupEnabled?'Private hosted setup':'Not enabled yet'}</span><h2>Connect your WhatsApp</h2>
  <p>Scan the connection QR with WhatsApp on your phone, then review the relevant chats. No computer app to install.</p>
  {!data.hostedSetupEnabled?<div className="kids-gap" role="status"><strong>WhatsApp setup is paused</strong><p>{data.service.active?'Hosted connections are not enabled in this private build.':data.service.message}</p><p>Your saved board and export remain available.</p></div>:<>
   {!exists&&!checked&&<p className="kids-hint" role="status">Checking for an earlier setup…</p>}
   {exists&&<div className="kids-hosted-status" role="status"><div>{setup.connected?<CheckCircle2 size={21}/>:<ShieldCheck size={21}/>}<strong>{setup.connected?'WhatsApp account verified':setup.status==='removed'?'Connection removed':setup.status==='removing'?'Connection removal in progress':setup.allowNewQr?'No paired account found':canRecover?'Did you scan the QR?':setup.pairedCheck?'Check paired WhatsApp':expired?'This setup expired':setup.status==='ready'?'Your connection is ready to continue':setup.status==='verifying'?'Checking your WhatsApp account':setup.status.endsWith('unknown')?'Connection outcome needs checking':'Preparing your connection'}</strong></div><p>{setup.message}</p>{setup.connected&&<p>History sync: {setup.syncStatus}. Chat names and a verified account do not confirm complete message coverage.</p>}</div>}
   {(!exists||restartAllowed||canRecover||setup?.connected&&!kids.discoveryConsent)&&<div className="kids-hosted-disclosure"><strong>{setup?.connected?'Before you resume suggestions':canRecover?'Before you check the paired account':'Before you connect'}</strong><p>Unipile hosts the WhatsApp connection in the cloud. It can sync and store wider WhatsApp history until the linked account is removed. Choosing chats here limits what Family Ops processes; it does not limit that wider provider sync.</p><p>We load chat titles for review and discard any message previews returned with them. You’ll confirm selected chats before originals go to your AI provider and saved board. Nothing sends replies or marks messages read.</p><p><a className="text-link" href="/privacy#kids-hosted">Connection privacy and removal details</a></p><label className="kids-check"><input type="checkbox" checked={consent} disabled={blocked} onChange={e=>setConsent(e.target.checked)}/><span>{setup?.connected?'Allow Family Ops chat-name suggestions again. Earlier tracking stays paused until I confirm it.':'I approve this hosted connection and chat-name discovery, including the provider storage described above.'}</span></label></div>}
   {error&&<div className="kids-error" role="alert"><strong>{error}</strong><p>A lost response does not tell us whether setup or chat names were saved. Retry checks the same request.</p></div>}
   {removing?<p className="kids-hint">Continue the saved removal in WhatsApp connection below.</p>:<div className="kids-hosted-actions">
    {setup?.connected?<button className="button" disabled={blocked||!kids.discoveryConsent&&!consent} onClick={()=>void run('discover')}>{busy?phase:kids.discoveryConsent?'Open chat title review':'Find my chats again'}<ArrowRight size={17}/></button>:!exists?<button className="button" disabled={blocked||!consent||!checked} onClick={()=>void run('connect')}>{busy?phase:'Connect WhatsApp'}<ArrowRight size={17}/></button>:canRecover?<button className="button" disabled={blocked||!consent} onClick={()=>void run('recover')}>{busy?phase:error&&setup?.pairedCheck?'Retry paired check':'Check paired WhatsApp'}<ArrowRight size={17}/></button>:restartAllowed?<button className="button" disabled={blocked||!consent} onClick={()=>void run('restart')}>{busy?phase:error?'Retry this connection setup':setup?.allowNewQr?'Get a new QR':'Start a new connection'}<ArrowRight size={17}/></button>:<button className="button" disabled={blocked||pairedWaiting||setup?.status==='verifying'&&!setup.recovery&&!setup.pairedCheck||expired&&!unresolvedScope} onClick={()=>void run('resume')}>{busy?phase:setup?.pairedCheck?pairedWaiting?'Paired check in progress…':'Retry paired check':setup?.status==='ready'?'Continue to WhatsApp':setup?.recovery==='retry_same_verification'?'Retry account verification':'Check this connection'}<ArrowRight size={17}/></button>}
    <button className="button secondary" disabled={blocked} onClick={()=>void run('status')}><RefreshCw size={16}/>Check saved setup</button>
    {error&&<button className="button secondary" disabled={blocked} onClick={()=>void run('reopen')}>Reopen saved Kids</button>}
   </div>}
   {busy&&<p className="kids-hint" role="status">{phase}</p>}
  </>}
  <p className="kids-hint">A verified connection is the first step. Automatic AI board updates are still being tested in this private build.</p>
 </div>;
}
