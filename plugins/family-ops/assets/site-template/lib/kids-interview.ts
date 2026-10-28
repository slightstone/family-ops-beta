import {z} from 'zod/v4';

// The conversational input has optional IDs for new children; stored profiles always have IDs.
export const kidsInterviewAnswers=z.object({
  children:z.array(z.object({
    id:z.string().uuid().optional(),
    name:z.string().trim().min(1).max(200),
    age:z.number().int().min(0).max(21),
    school:z.string().max(200).default(''),
    activities:z.string().max(300).default(''),
  }).strict()).min(1).max(12),
  language:z.enum(['English','Hebrew']),
  exclusions:z.string().max(1000).default(''),
}).strict();
