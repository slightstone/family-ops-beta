import {z} from 'zod/v4';
import {KidsError} from './kids-error';
const uuid=z.string().uuid(),timestamp=z.string().datetime().nullable();
export const controlResultSchema=z.object({action:z.enum(['pause','resume']),connectionId:uuid,revision:z.number().int().min(1),sourceEpoch:z.number().int().min(0),paused:z.boolean(),discoveryConsent:z.boolean(),processingConsent:z.boolean(),confirmedAt:timestamp,needsReview:z.boolean(),resumeFrom:uuid.nullable()}).strict();
export const controlReceiptSchema=z.object({kind:z.literal('kids-connection-control-v1'),result:controlResultSchema,restore:z.object({workspaceEpoch:z.number().int().min(0),discoveryConsent:z.boolean(),processingConsent:z.boolean(),confirmedAt:timestamp}).strict().nullable()}).strict();
export type ControlReceipt=z.infer<typeof controlReceiptSchema>;
export const controlConflict=()=>new KidsError('This WhatsApp control changed. Reopen its current account settings; saved work is kept.',409);
type Row={operation_id:string;committed_revision:number;source_authority:string|null};
export async function latestKidsConnectionControl(db:D1Database,user:string,workspace:string,connection:string){
 const data="CASE WHEN json_valid(source_authority) THEN source_authority ELSE '{}' END";
 const row=await db.prepare(`SELECT operation_id,committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND json_extract(${data},'$.kind')='kids-connection-control-v1' AND json_extract(${data},'$.result.connectionId')=? ORDER BY committed_revision DESC,rowid DESC LIMIT 1`).bind(user,workspace,connection).first<Row>();
 if(!row)return null;const value=controlReceiptSchema.safeParse(JSON.parse(row.source_authority!));if(!value.success||value.data.result.connectionId!==connection)throw controlConflict();
 return {operationId:row.operation_id,committedRevision:row.committed_revision,receipt:value.data};
}
export async function originalKidsConnectionControl(db:D1Database,user:string,workspace:string,operation:string){
 const row=await db.prepare('SELECT operation_id,committed_revision,source_authority FROM kids_operation_receipts WHERE owner_user_id=? AND workspace_id=? AND operation_id=?').bind(user,workspace,operation).first<Row>();
 if(!row?.source_authority)throw controlConflict();let value;try{value=controlReceiptSchema.parse(JSON.parse(row.source_authority));}catch{throw controlConflict();}
 return {...value.result,committedRevision:row.committed_revision};
}
