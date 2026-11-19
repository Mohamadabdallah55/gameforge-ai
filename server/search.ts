import type {Evidence} from '../shared/contracts';
const headers=()=>({'User-Agent':process.env.WIKI_USER_AGENT||'GameForgeAI/0.1 (quiz research)'});
async function query(host:string,params:Record<string,string>){
 const url=new URL('https://'+host+'/w/api.php');url.search=new URLSearchParams({action:'query',format:'json',formatversion:'2',...params}).toString();
 const r=await fetch(url,{headers:headers(),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('Wikimedia HTTP '+r.status);
 const data=await r.json();if(data.error)throw new Error('Wikimedia '+data.error.code);
 return data.query?.pages??[];
}
export async function information(term:string):Promise<Evidence[]>{
 for(const lang of ['ar','en']){
 const pages=await query(lang+'.wikipedia.org',{generator:'search',gsrsearch:term,gsrlimit:'5',prop:'extracts|info',explaintext:'1',exchars:'5000',exlimit:'5',inprop:'url'});
 const evidence=pages.filter((p:{extract?:string})=>p.extract?.trim()).map((p:{title:string;fullurl:string;extract:string})=>({title:p.title,url:p.fullurl,text:p.extract}));
 if(evidence.length)return evidence;
 }return [];
}
export interface ImageHit{title:string;url:string;origin:string;credit:string;license:string}
export async function pictures(term:string):Promise<ImageHit[]>{
 const pages=await query('commons.wikimedia.org',{generator:'search',gsrsearch:term+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'8',prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'600'});
 return pages.flatMap((p:{title:string;imageinfo?:Record<string,any>[]})=>{const i=p.imageinfo?.[0],m=i?.extmetadata;if(!i?.thumburl||!m?.LicenseShortName?.value)return [];return [{title:p.title,url:i.thumburl,origin:i.descriptionurl,credit:String(m.Artist?.value||'See source').replace(/<[^>]+>/g,''),license:m.LicenseShortName.value}]});
}
export async function downloadHit(hit:ImageHit){
 const u=new URL(hit.url);if(u.protocol!=='https:'||u.hostname!=='upload.wikimedia.org')throw new Error('مصدر الصورة غير مسموح');
 const r=await fetch(u,{headers:headers(),redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!r.ok||!r.body)throw new Error('تعذر تنزيل الصورة '+r.status);
 const chunks:Buffer[]=[];let size=0;for await(const part of r.body as any){size+=part.length;if(size>8e6)throw new Error('صورة كبيرة');chunks.push(Buffer.from(part))}return Buffer.concat(chunks);
}
