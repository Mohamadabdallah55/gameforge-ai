import {z} from 'zod';
export const levels = ['easy','medium','hard'] as const;
export type Level = typeof levels[number];
const count=z.number().int().min(0).max(100);
export const planSchema=z.object({topic:z.string().trim().min(1).max(1000),easy:count,medium:count,hard:count,imagePercent:z.number().int().min(0).max(100)}).refine(p=>p.easy+p.medium+p.hard>0,'يلزم سؤال واحد على الأقل');
export type Plan=z.infer<typeof planSchema>;
export const fields=['question','answer','difficulty','image','source'] as const;
export const profileSchema=z.object({name:z.string().trim().min(1).max(100),rules:z.string().max(2000).default(''),mapping:z.partialRecord(z.enum(fields),z.string().trim().min(1).max(100)).default({})}).refine(p=>new Set(fields.map(k=>p.mapping[k]??k)).size===fields.length,'أسماء الحقول متكررة');
export type Profile=z.infer<typeof profileSchema>;
export interface Evidence {title:string;url:string;text:string}
export interface Asset {id:string;origin:string;credit:string;license:string}
export interface Question {id:string;profileId:string;question:string;answer:string;difficulty:Level;source:string;quote:string;image:string|null}
export interface Candidate {question:string;answer:string;sourceIndex:number;quote:string;imageQuery:string}
export interface Provider {
 interpret(request:string):Promise<Plan>;
 draft(topic:string,level:Level,rules:string,sources:Evidence[],avoid:string[]):Promise<Candidate>;
 verify(topic:string,candidate:Candidate,source:Evidence):Promise<boolean>;
 embed(text:string):Promise<number[]>;
 image(prompt:string,input?:Buffer):Promise<Buffer>;
}
export function slots(plan:Plan){const sequence=levels.flatMap(k=>Array<Level>(plan[k]).fill(k));const n=sequence.length,target=Math.round(n*plan.imagePercent/100);return sequence.map((level,i)=>({level,image:Math.floor((i+1)*target/n)>Math.floor(i*target/n)}))}
