export async function base64(blob:Blob):Promise<string>{
 if(blob.size>12e6)throw new Error('الحد الأقصى للصورة أو النموذج 12 MB');
 return new Promise((ok,fail)=>{const reader=new FileReader();reader.onerror=()=>fail(new Error('تعذر قراءة الملف'));reader.onload=()=>ok(String(reader.result).split(',')[1]);reader.readAsDataURL(blob)});
}
export async function frame(file:File,time:number):Promise<Blob>{
 const v=document.createElement('video'),url=URL.createObjectURL(file);v.muted=true;v.preload='auto';
 try{await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>finish(new Error('انتهت مهلة قراءة الفيديو')),20000);
 function finish(error?:Error){clearTimeout(timer);v.onloadeddata=null;v.onseeked=null;v.onerror=null;error?fail(error):ok()}
 v.onerror=()=>finish(new Error('ترميز فيديو غير مدعوم'));v.onloadeddata=()=>{if(!Number.isFinite(time)||time<0||time>=v.duration)return finish(new Error('الزمن خارج المقطع'));if(time===0)return finish();v.onseeked=()=>finish();v.currentTime=time};v.src=url});
 const c=document.createElement('canvas'),scale=Math.min(1,1400/Math.max(v.videoWidth,v.videoHeight));c.width=Math.max(1,Math.round(v.videoWidth*scale));c.height=Math.max(1,Math.round(v.videoHeight*scale));c.getContext('2d')!.drawImage(v,0,0,c.width,c.height);
 return await new Promise<Blob>((ok,fail)=>c.toBlob(b=>b?ok(b):fail(new Error('تعذر استخراج الإطار')),'image/png'));
 }finally{v.removeAttribute('src');v.load();URL.revokeObjectURL(url)}
}
