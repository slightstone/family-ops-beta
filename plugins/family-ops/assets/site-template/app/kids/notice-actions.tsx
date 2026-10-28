'use client';
import {Check,Archive,RotateCcw,ChevronDown} from 'lucide-react';
import {DropdownMenu,DropdownMenuTrigger,DropdownMenuContent,DropdownMenuItem} from '../../components/ui/dropdown-menu';
import type {KidsNotice} from '../../lib/kids-notices';
import type {Change} from './kids-app';
export default function NoticeActions({contextId,title,notice,busy,change,parent=false}:{parent?:boolean;contextId:string;title:string;notice:KidsNotice;busy:boolean;change:Change}){
 const act=(action:string)=>void (parent?change('parentItem',{command:{action:'review',contextId,review:action}}):change('notice',{contextId,version:notice.version,action}));
 return <div className="family-notice-actions" data-notice-context={contextId} aria-label="Notice review">
  <span className={'family-notice-state'+(notice.updated?' updated':'')}>{notice.updated?<><span>Updated</span><span className="sr-only"> · not reviewed</span></>:notice.clearedAt?notice.acknowledgedAt?'Archived · seen':'Archived · not seen':notice.acknowledgedAt?<><Check size={13}/> Seen</>:'Not reviewed'}</span>
  {notice.clearedAt?<button className="kids-action" data-notice-primary disabled={busy} onClick={()=>act('restore')}><RotateCcw size={15}/>Restore</button>:!notice.acknowledgedAt&&<button className="kids-action primary" data-notice-primary disabled={busy} onClick={()=>act('acknowledge')}><Check size={15}/>Mark seen</button>}
  <DropdownMenu><DropdownMenuTrigger asChild><button className="kids-action" data-notice-more disabled={busy} aria-label={'More actions for '+title}>More<ChevronDown size={14}/></button></DropdownMenuTrigger><DropdownMenuContent className="family-notice-menu" align="end">{notice.acknowledgedAt&&<DropdownMenuItem disabled={busy} onSelect={()=>act('unacknowledge')}>Mark unseen</DropdownMenuItem>}{!notice.clearedAt&&<DropdownMenuItem disabled={busy} onSelect={()=>act('clear')}><Archive size={15}/>Archive</DropdownMenuItem>}{notice.clearedAt&&!notice.acknowledgedAt&&<DropdownMenuItem disabled={busy} onSelect={()=>act('acknowledge')}>Mark seen</DropdownMenuItem>}</DropdownMenuContent></DropdownMenu>
 </div>;
}
