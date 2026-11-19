import {slots,type Provider,type Asset,type Plan} from '../shared/contracts';
import {information,pictures,downloadHit} from './search';
import {Store,uid,normalize,type Job} from './store';
import {transform} from './media';
export class Worker{
 private busy=false;
 constructor(private db:Store,private ai:Provider,private research=information){}
 enqueue(profileId:string,plan:Plan){if(!this.db.profile(profileId))throw new Error('ملف اللعبة غير موجود');const j:Job={id:uid(),plan,profileId,status:'queued',done:0,error:''};this.db.saveJob(j);return j}
 async drain(){if(this.busy)return;this.busy=true;try{for(;;){const j=this.db.jobs().find(j=>j.status==='queued'||j.status==='running');if(!j)break;try{await this.run(j)}catch(e){j.status='failed';j.error=e instanceof Error?e.message:String(e);this.db.saveJob(j)}}}finally{this.busy=false}}
 private async run(j:Job){j.status='running';this.db.saveJob(j);
 const sources=await this.research(j.plan.topic);if(!sources.length)throw new Error('لم يعثر البحث على أدلة للموضوع');
 const schedule=slots(j.plan),rules=this.db.profile(j.profileId)!.rules;
 for(const slot of schedule.slice(j.done)){
 const avoid=this.db.questions(j.profileId).slice(-25).map(q=>q.question);
 let accepted=false;
 for(let attempt=0;attempt<3;attempt++){
 const c=await this.ai.draft(j.plan.topic,slot.level,rules,sources,avoid);avoid.push(c.question);
 const source=sources[c.sourceIndex];
 if(!source||!normalize(c.quote)||!normalize(source.text).includes(normalize(c.quote))||!await this.ai.verify(j.plan.topic,c,source))continue;
 const vector=await this.ai.embed(c.question);if(this.db.duplicate(j.profileId,c.question,vector))continue;
 let media:{meta:Asset;png:Buffer}|undefined;
 if(slot.image){const [hit]=await pictures(c.imageQuery);if(!hit)throw new Error('لا توجد صورة مطابقة للبحث '+c.imageQuery);media={meta:{id:uid(),origin:hit.origin,credit:hit.credit,license:hit.license},png:await transform(await downloadHit(hit),'original')}}
 const next={...j,done:j.done+1};
 this.db.transaction(()=>{if(media)this.db.putAsset(media.meta,media.png);this.db.add({id:uid(),profileId:j.profileId,question:c.question,answer:c.answer,difficulty:slot.level,source:source.url,quote:c.quote,image:media?.meta.id??null},vector);this.db.saveJob(next)});
 j.done=next.done;accepted=true;break;
 }if(!accepted)throw new Error('رُفضت ثلاث محاولات لضعف الدليل أو تكرار السؤال');
 }j.status='complete';this.db.saveJob(j)}
}
