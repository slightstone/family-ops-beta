'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckCircle2,Download,RefreshCw,ShieldCheck,WifiOff,Clock3} from 'lucide-react';
import {connectionStatusSchema,connectionMessages,connectionFailure,serializeConnectionReport,type ConnectionReport} from '../../lib/family-status';
type CheckState={kind:'checking'}|{kind:'done';report:ConnectionReport};
export default function ConnectionCheck(){
  const [state,setState]=useState<CheckState>({kind:'checking'}),[downloaded,setDownloaded]=useState(false),[downloadError,setDownloadError]=useState(false);
  const lifecycle=useRef({sequence:0,request:null as AbortController|null,checking:false});
  const check=useCallback(async()=>{
    const active=lifecycle.current;if(active.checking)return;active.checking=true;
    const id=++active.sequence;active.request?.abort();const controller=new AbortController();active.request=controller;
    setState({kind:'checking'});setDownloaded(false);setDownloadError(false);
    const timeout=window.setTimeout(()=>controller.abort(),10000);
    let report:ConnectionReport;
    try{
      const response=await fetch('/api/family/status',{cache:'no-store',signal:controller.signal});
      if(response.status===401)report=connectionFailure('SIGN_IN_REQUIRED');
      else {
        let body:unknown;try{body=await response.json();}catch{body=null;}
        if(response.status===503&&body!==null&&typeof body==='object'&&'code'in body&&body.code==='STORAGE_UNAVAILABLE')report=connectionFailure('STORAGE_UNAVAILABLE');
        else if(!response.ok)report=connectionFailure('CONNECTION_UNAVAILABLE');
        else {const parsed=connectionStatusSchema.safeParse(body);report=parsed.success?parsed.data:connectionFailure('INVALID_RESPONSE');}
      }
    }catch{report=connectionFailure('CONNECTION_UNAVAILABLE');}
    finally{window.clearTimeout(timeout);}
    if(id===active.sequence){active.checking=false;setState({kind:'done',report});}
  },[]);
  useEffect(()=>{const active=lifecycle.current;void check();return()=>{active.sequence++;active.checking=false;active.request?.abort();};},[check]);
  const report=state.kind==='done'?state.report:null,ok=report?.status==='ok',message=report?.status==='error'?connectionMessages[report.reason]:null;
  const download=()=>{if(!report||state.kind!=='done')return;try{const blob=new Blob([serializeConnectionReport(report)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='family-ops-connection-report.json';link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setDownloaded(true);setDownloadError(false);}catch{setDownloadError(true);}};
  return <section className={`section-card help-check ${report?.status==='error'?'help-check-error':''}`} aria-labelledby="connection-title" aria-busy={state.kind==='checking'}>
    <div className="help-check-heading"><span className="help-status-icon" aria-hidden="true">{state.kind==='checking'?<Clock3 size={24}/>:ok?<CheckCircle2 size={25}/>:<WifiOff size={25}/>}</span><div><div className="eyebrow">Connection check</div><h2 id="connection-title">{state.kind==='checking'?'Checking your connection…':ok?(report.workspace==='present'?'Your saved space is reachable.':'Ready for your first workspace.'):message?.title}</h2></div></div>
    <div role="status" aria-live="polite" className="help-check-result">{state.kind==='checking'?<p>Checking sign-in and storage access. Nothing is being saved.</p>:ok?<><p>Storage is available. {report.workspace==='present'?'Your account has a saved workspace.':'No workspace has been created for this account yet.'}</p><dl className="help-status-grid"><div><dt>Version in use</dt><dd>{report.mode==='preview'?'Private preview':'Free planning beta'}</dd></div><div><dt>Last saved revision</dt><dd>{report.revision??'No workspace yet'}</dd></div><div><dt>Last saved</dt><dd>{report.lastSavedAt?new Date(report.lastSavedAt).toLocaleString():'Not saved yet'}</dd></div><div><dt>Check completed</dt><dd>{new Date(report.checkedAt).toLocaleTimeString()}</dd></div></dl><p className="help-check-caution">This checks the connection. It does not confirm a pending change was saved.</p></>:<p>{message?.body}</p>}</div>
    <div className="help-check-actions"><button className="button secondary small" aria-disabled={state.kind==='checking'} onClick={()=>{if(state.kind!=='checking')void check();}}><RefreshCw size={17}/>{state.kind==='checking'?'Checking…':'Check again'}</button><button className="button secondary small" disabled={!report} onClick={download}><Download size={17}/>Download connection report</button></div>
    <p className="help-report-note"><ShieldCheck size={16}/>The report includes the check result and, when available, the last saved revision and time. It contains no account identifiers, names, plans or messages. It is not a workspace export or backup. Nothing is sent.</p>{downloaded&&<p className="help-download-feedback" role="status">Download requested. Share the file yourself only if you want to.</p>}{downloadError&&<p className="form-error" role="alert">The report could not be downloaded. Check again and retry the download.</p>}
  </section>;
}
