import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {parse} from 'csv-parse/sync';
import {fields,type Profile} from '../shared/contracts';
import {Store,normalize} from './store';
const aliases={question:['question','prompt','السؤال','سؤال'],answer:['answer','correctanswer','الإجابة','الجواب'],difficulty:['difficulty','level','المستوى','الصعوبة'],source:['source','المصدر'],image:['image','imagepath','الصورة']};
export async function infer(format:string,bytes:Buffer){
 let rows:Record<string,unknown>[];
 if(format==='csv')rows=parse(bytes,{columns:true,bom:true,skip_empty_lines:true});
 else if(format==='json'){const obj=JSON.parse(bytes.toString());rows=Array.isArray(obj)?obj:obj.questions}
 else if(format==='xlsx'){const book=new ExcelJS.Workbook();const archive=await JSZip.loadAsync(bytes);let size=0;for(const entry of Object.values(archive.files)){size+=(entry as any)._data?.uncompressedSize||0}if(size>20e6)throw new Error('ملف Excel كبير بعد الفك');await book.xlsx.load(bytes as any);const sheet=book.worksheets[0];if(!sheet||sheet.rowCount>10000||sheet.columnCount>150)throw new Error('حجم الجدول غير مدعوم');const header=(sheet.getRow(1).values as unknown[]).slice(1).map(String);rows=[];sheet.eachRow((row,i)=>{if(i>1)rows.push(Object.fromEntries(header.map((h,j)=>[h,row.getCell(j+1).text])))})}
 else throw new Error('صيغة غير مدعومة');
 if(!Array.isArray(rows)||!rows.length||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new Error('يلزم جدول سجلات مع صف بيانات');
 const keys=[...new Set(rows.slice(0,50).flatMap(Object.keys))];
 const mapping:Profile['mapping']={};for(const field of fields){const k=keys.find(k=>aliases[field].some(a=>normalize(k).replace(/ /g,'')===normalize(a)));if(k)mapping[field]=k}
 return {columns:keys.map(name=>({name,type:typeof rows.find(r=>r[name]!=null)?.[name]})),mapping,rows:rows.length};
}
export async function output(db:Store,id:string,format:string){
 const profile=db.profile(id);if(!profile)throw new Error('ملف اللعبة غير موجود');
 const qs=db.questions(id),headers=fields.map(f=>profile.mapping[f]??f);
 const rows=qs.map(q=>fields.map(f=>f==='image'?(q.image?'images/'+q.image+'.png':''):q[f]));
 const json=JSON.stringify(rows.map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]]))),null,2);
 if(format==='json')return Buffer.from(json);
 if(format==='csv'){const escape=(s:string)=>'"'+(/^[\s]*[=+@-]|^[\t\r]/.test(s)?"'":"")+s.replaceAll('"','""')+'"';return Buffer.from('\uFEFF'+[headers,...rows].map(r=>r.map(escape).join(',')).join('\r\n'))}
 if(format==='xlsx'){const book=new ExcelJS.Workbook();const sheet=book.addWorksheet('Questions');sheet.addRows([headers,...rows]);return Buffer.from(await book.xlsx.writeBuffer())}
 if(format!=='zip')throw new Error('صيغة غير مدعومة');
 const zip=new JSZip();zip.file('questions.json',json);const used=new Set(qs.map(q=>q.image).filter(Boolean));const assets=db.assets().filter(a=>used.has(a.id));for(const a of assets)zip.file('images/'+a.id+'.png',db.asset(a.id)!);
 zip.file('credits.json',JSON.stringify(assets,null,2));zip.file('evidence.json',JSON.stringify(qs.map(q=>({question:q.question,url:q.source,quote:q.quote})),null,2));return zip.generateAsync({type:'nodebuffer'});
}
