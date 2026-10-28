import {z} from 'zod';

export const boardTabIds=['today','updates','activities'] as const;
export type BoardTabId=typeof boardTabIds[number];
export const boardTabDefaults:Record<BoardTabId,string>={today:'Today',updates:'School',activities:'Chugim'};
const label=z.string().transform(s=>s.normalize('NFC').trim()).pipe(z.string().min(1).max(24).refine(s=>!/[\p{Cc}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(s),'Use a single-line tab name without control characters.')).nullable();
export const boardPreferencesSchema=z.object({schemaVersion:z.literal(1),labels:z.object({today:label,updates:label,activities:label}).strict(),order:z.array(z.enum(boardTabIds)).length(3),defaultSection:z.enum(boardTabIds)}).strict().superRefine((p,ctx)=>{
 if(new Set(p.order).size!==3)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Include each tab exactly once.',path:['order']});
 if(new Set(boardTabIds.map(id=>(p.labels[id]??boardTabDefaults[id]).toLocaleLowerCase('en-US'))).size!==3)ctx.addIssue({code:z.ZodIssueCode.custom,message:'Give each tab a different name.',path:['labels']});
});
export type BoardPreferences=z.infer<typeof boardPreferencesSchema>;
export const defaultBoardPreferences=():BoardPreferences=>({schemaVersion:1,labels:{today:null,updates:null,activities:null},order:[...boardTabIds],defaultSection:'today'});
export const boardTabLabel=(p:BoardPreferences,id:BoardTabId)=>p.labels[id]??boardTabDefaults[id];
