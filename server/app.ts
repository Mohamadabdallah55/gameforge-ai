import express from 'express';
import {z} from 'zod';
import {Store,uid} from './store';
import {Worker} from './worker';
import {planSchema,profileSchema,type Provider} from '../shared/contracts';
import {Gemini} from './provider';
import {output,infer} from './files';
import {information,pictures} from './search';
import {transform,styles} from './media';
export function createApp(db:Store,ai:Provider=new Gemini()){
 const app=express(),worker=new Worker(db,ai);
 const api=express.Router();
 api.use((req,res,next)=>{const origin=req.get('origin');if(req.method!=='GET'&&origin&&new URL(origin).host!==req.get('host')){res.sendStatus(403);return}next()});
 api.use(express.json({limit:'20mb'}));
 const term=z.string().trim().min(1).max(2000);
 const id=z.string().regex(/^(default|[0-9a-f-]{36})$/);
 const profile=(v:unknown)=>{const k=id.parse(v);if(!db.profile(k))throw new Error('ملف اللعبة غير موجود');return k};
 const encoded=z.string().min(4).max(16e6).regex(/^[A-Za-z0-9+/]+={0,2}$/);
 api.get('/health',(_,r)=>r.json({ok:true,geminiConfigured:!!process.env.GEMINI_API_KEY}));
 api.get('/profiles',(_,r)=>r.json(db.profiles()));
 api.post('/profiles',(q,r)=>{const p=profileSchema.parse(q.body),k=uid();db.saveProfile(k,p);r.status(201).json({id:k,...p})});
 api.get('/questions',(q,r)=>r.json(db.questions(profile(q.query.profileId))));
 api.post('/interpret',async(q,r)=>r.json(await ai.interpret(term.parse(q.body.request))));
 api.get('/search',async(q,r)=>{const kind=z.enum(['facts','images']).parse(q.query.kind),t=term.parse(q.query.q);r.json(await(kind==='facts'?information(t):pictures(t)))});
 api.get('/jobs',(_,r)=>r.json(db.jobs()));
 api.post('/jobs',(q,r)=>{const j=worker.enqueue(profile(q.body.profileId),planSchema.parse(q.body.plan));r.status(202).json(j);void worker.drain()});
 api.post('/jobs/:id/retry',(q,r)=>{const j=db.job(q.params.id);if(!j){r.sendStatus(404);return}if(j.status!=='failed'){r.status(409).json({error:'المهمة ليست متوقفة'});return}j.status='queued';j.error='';db.saveJob(j);r.status(202).json(j);void worker.drain()});
 api.get('/assets',(_,r)=>r.json(db.assets()));
 api.get('/assets/:id',(q,r)=>{const png=db.asset(q.params.id);if(!png){r.sendStatus(404);return}r.type('png').send(png)});
 const getAsset=(v:unknown)=>{const k=id.parse(v),png=db.asset(k);if(!png)throw new Error('الصورة غير موجودة');return png};
 api.post('/assets',async(q,r)=>{const input=z.object({data:encoded,rights:z.literal(true),credit:term,origin:term.default('upload')}).parse(q.body);const png=await transform(Buffer.from(input.data,'base64'),'original'),meta={id:uid(),credit:input.credit,origin:input.origin,license:'user-authorized'};db.putAsset(meta,png);r.status(201).json(meta)});
 api.post('/assets/transform',async(q,r)=>{const k=id.parse(q.body.assetId),png=await transform(getAsset(k),z.enum(styles).parse(q.body.style));const source=db.assets().find(a=>a.id===k)!;const meta={...source,id:uid()};db.putAsset(meta,png);r.status(201).json(meta)});
 api.post('/assets/generate',async(q,r)=>{const prompt=term.parse(q.body.prompt),source=q.body.assetId?db.assets().find(a=>a.id===q.body.assetId):null;const png=await transform(await ai.image(prompt,q.body.assetId?getAsset(q.body.assetId):undefined),'original');const meta={id:uid(),credit:source?.credit||'Gemini',origin:source?.origin||'generated',license:source?.license||'AI-generated'};db.putAsset(meta,png);r.status(201).json(meta)});
 api.post('/templates/infer',async(q,r)=>r.json(await infer(z.enum(['json','csv','xlsx']).parse(q.body.format),Buffer.from(encoded.parse(q.body.data),'base64'))));
 api.get('/export/:format',async(q,r)=>{const f=z.enum(['json','csv','xlsx','zip']).parse(q.params.format);r.attachment('questions.'+f).send(await output(db,profile(q.query.profileId),f))});
 api.use((_,r)=>r.status(404).json({error:'مسار غير موجود'}));
 api.use((e:Error,q:express.Request,r:express.Response,next:express.NextFunction)=>{r.status(e instanceof z.ZodError?400:/HTTP|Gemini|Wikimedia/.test(e.message)?502:400).json({error:e instanceof z.ZodError?e.issues.map(i=>i.path.join('.')+' '+i.message).join(', '):e.message})});
 app.use('/api',api);return {app,worker}
}
