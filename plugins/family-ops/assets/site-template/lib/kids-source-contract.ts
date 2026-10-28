import {z} from 'zod/v4';
const uuid=z.string().uuid();
export const sourceConnectionProof=z.object({id:uuid,revision:z.number().int().min(1),sourceEpoch:z.number().int().min(0)}).strict();
export const sourceTrackingTarget=z.object({bindingId:uuid,revision:z.number().int().min(1),sourceEpoch:z.number().int().min(0),chatIds:z.array(z.string().min(1).max(180)).min(1).max(30)}).strict();
export const sourceSetupAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('prepare')}).strict(),
 z.object({action:z.literal('enable-discovery')}).strict(),
 z.object({action:z.literal('include-direct-titles'),connection:sourceConnectionProof,scanRevision:z.number().int().min(0)}).strict(),
 z.object({action:z.literal('add'),connection:sourceConnectionProof.optional()}).strict(),
 z.object({action:z.literal('reconnect'),connection:sourceConnectionProof}).strict(),
 z.object({action:z.literal('check-paired'),setupId:uuid}).strict(),
 z.object({action:z.literal('track'),targets:z.array(sourceTrackingTarget).min(1).max(2)}).strict(),
 z.object({action:z.literal('source'),connection:sourceConnectionProof,chatId:z.string().min(1).max(180),enabled:z.boolean()}).strict(),
 z.object({action:z.literal('pause'),connection:sourceConnectionProof}).strict(),
 z.object({action:z.literal('resume'),connection:sourceConnectionProof,resumeFrom:uuid.optional()}).strict(),
 z.object({action:z.literal('remove-connection'),connection:sourceConnectionProof}).strict(),
 z.object({action:z.literal('remove-all'),allConnections:z.literal(true)}).strict(),
]);
export type SourceSetupAction=z.infer<typeof sourceSetupAction>;
export const stageSourceSetupSchema=z.object({operation_id:uuid,workspace_id:uuid,expected_revision:z.number().int().min(1),change:sourceSetupAction}).strict();
export const sourceProposalKey=z.object({workspace_id:uuid,proposal_id:uuid,proposal_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export const approveSourceSetupSchema=sourceProposalKey.extend({approval:z.string().min(1).max(200)}).strict();
export type SourceProposalPreview={title:string;summary:string;accounts:{id:string;label:string;chats?:{id:string;title:string;person:string}[]}[];disclosure:string[]};
