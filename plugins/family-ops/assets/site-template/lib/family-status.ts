import {z} from 'zod';

const stamp=z.string().datetime({offset:true});
export const connectionStatusSchema=z.object({
  schemaVersion:z.literal(1),app:z.literal('Family Ops'),status:z.literal('ok'),
  checkedAt:stamp,mode:z.enum(['preview','beta']),storage:z.literal('available'),
  workspace:z.enum(['present','absent']),revision:z.number().int().positive().safe().nullable(),lastSavedAt:stamp.nullable(),
}).strip().refine(s=>s.workspace==='present'?s.revision!==null&&s.lastSavedAt!==null:s.revision===null&&s.lastSavedAt===null);
export const connectionReasons=['SIGN_IN_REQUIRED','STORAGE_UNAVAILABLE','CONNECTION_UNAVAILABLE','INVALID_RESPONSE'] as const;
export type ConnectionReason=typeof connectionReasons[number];
export const connectionFailureSchema=z.object({schemaVersion:z.literal(1),app:z.literal('Family Ops'),status:z.literal('error'),checkedAt:stamp,reason:z.enum(connectionReasons)}).strip();
export type ConnectionStatus=z.infer<typeof connectionStatusSchema>;
export type ConnectionFailure=z.infer<typeof connectionFailureSchema>;
export type ConnectionReport=ConnectionStatus|ConnectionFailure;
export const connectionMessages:Record<ConnectionReason,{title:string;body:string}>={
  SIGN_IN_REQUIRED:{title:'Sign in to check your connection.',body:'Open the workspace with your invited account, then check again. This page cannot grant an invitation.'},
  STORAGE_UNAVAILABLE:{title:'The storage check is unavailable.',body:'We could not confirm access to saved plans. Wait a moment and check again. This check has not changed your workspace.'},
  CONNECTION_UNAVAILABLE:{title:'We couldn’t reach the connection check.',body:'Check your internet connection and try again. Your original workspace tab keeps its own Retry controls.'},
  INVALID_RESPONSE:{title:'The connection check did not return a usable result.',body:'This can happen during sign-in or a service interruption. Open the workspace with your invited account, then check again.'},
};
export function connectionFailure(reason:ConnectionReason):ConnectionFailure{return {schemaVersion:1,app:'Family Ops',status:'error',checkedAt:new Date().toISOString(),reason};}
export function serializeConnectionReport(report:ConnectionReport){
  // Re-parse before download: unknown response properties can never enter the file.
  const safe=report.status==='ok'?connectionStatusSchema.parse(report):connectionFailureSchema.parse(report);
  return JSON.stringify(safe,null,2)+'\n';
}
