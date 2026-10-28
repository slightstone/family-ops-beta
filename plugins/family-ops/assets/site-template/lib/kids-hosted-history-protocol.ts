import {z} from 'zod';
// Pinned Unipile V2 2.61.0 projection. Strip senders, capabilities, URLs and
// response extras before hashing/retaining any approved Message evidence.
const id=z.string().min(1).max(180),attachment=z.object({object:z.literal('Attachment'),id:z.string().min(1).max(512),type:z.string().min(1).max(80),mimetype:z.string().max(200),is_inline:z.boolean(),file_size:z.number().finite().nonnegative().optional(),is_unavailable:z.boolean().optional()});
const messageShape=z.object({object:z.literal('Message'),id,chat_id:id,provider:z.literal('whatsapp'),timestamp:z.string().datetime({offset:true}),text:z.string().max(16000).optional(),is_hidden:z.boolean(),is_deleted:z.boolean(),is_edited:z.boolean(),attachments:z.array(attachment).max(100)});
export const hostedMessageSchema=messageShape.refine(m=>m.text!==undefined||m.attachments.length>0||m.is_hidden||m.is_deleted);
export type HostedMessage=z.infer<typeof hostedMessageSchema>;
const pageSchema=z.object({data:z.array(messageShape).max(20),next_cursor:z.string().max(2000).refine(s=>!/[\u0000-\u001f]/.test(s)).optional(),total_count:z.number().int().nonnegative().optional()});
export type HistoryPosition={since:number;until:number;cursor:string|null;offset:number;seen_count:number;total_count:number|null;page_count:number};
export function parseHistoryPage(input:unknown,scan:HistoryPosition,chat:string,usedCursors:ReadonlySet<string>){
 const page=pageSchema.parse(input),ids=new Map<string,string>();let newest:number|null=null,oldest:number|null=null,last=Infinity;
 for(const m of page.data){const time=Date.parse(m.timestamp),body=JSON.stringify(m);if(m.chat_id!==chat||time>last)throw new Error('history_identity_or_order');last=time;if(ids.has(m.id)&&ids.get(m.id)!==body)throw new Error('history_duplicate_conflict');ids.set(m.id,body);if(time>=scan.since&&time<scan.until){newest=newest===null?time:Math.max(newest,time);oldest=oldest===null?time:Math.min(oldest,time);}}
 const next=page.next_cursor||null,seen=scan.seen_count+page.data.length,total=page.total_count??scan.total_count;
 if(page.total_count!==undefined&&scan.total_count!==null&&page.total_count!==scan.total_count)throw new Error('history_total_changed');
 if(next&&(usedCursors.has(next)||next===scan.cursor))throw new Error('history_cursor_repeated');
 if(total!==null&&(seen>total||next&&seen>=total))throw new Error('history_pagination_conflict');
 if(!page.data.length&&(next||total!==null&&seen!==total))throw new Error('history_empty_before_end');
 // Verified records remain useful without a proof of complete history. Stop
 // incomplete rather than guessing another offset or discarding this page.
 const paginationUnproved=!next&&(total===null||scan.cursor!==null&&seen!==total);
 if(scan.cursor===null&&!next&&(scan.offset!==scan.seen_count||total!==null&&scan.offset+page.data.length>total))throw new Error('history_offset_conflict');
 const status=paginationUnproved?'capped':!next&&seen===total?'exhausted':scan.page_count+1>=5?'capped':'pending';
 const eligible=page.data.filter(m=>Date.parse(m.timestamp)>=scan.since&&Date.parse(m.timestamp)<scan.until),unsupported=(m:HostedMessage)=>m.text===undefined&&!m.attachments.length&&!m.is_hidden&&!m.is_deleted;
 const messages=[...new Map(eligible.filter(m=>!unsupported(m)).map(m=>[m.id,m])).values()];
 return {canonical:page,messages,unsupported:eligible.filter(unsupported).length,paginationUnproved,oldest,newest,seen,total,next,offset:next||scan.cursor?scan.offset:seen,status:status as 'pending'|'exhausted'|'capped',outside:page.data.filter(m=>Date.parse(m.timestamp)<scan.since||Date.parse(m.timestamp)>=scan.until).length};
}
export function historyRequest(account:string,chat:string,scan:HistoryPosition){const query=new URLSearchParams({after:new Date(scan.since-1).toISOString(),before:new Date(scan.until).toISOString(),limit:'20',...(scan.cursor?{cursor:scan.cursor}:{offset:String(scan.offset)})});return '/v2/'+encodeURIComponent(account)+'/chats/'+encodeURIComponent(chat)+'/messages?'+query;}
