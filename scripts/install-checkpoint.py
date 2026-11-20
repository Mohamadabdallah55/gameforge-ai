from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import hashlib, os, re, shutil, subprocess

root = Path(os.environ.get("ENGINES_DIR") or "../../work/engines").resolve()
os.chdir(root)
url='https://huggingface.co/Comfy-Org/stable-diffusion-1.5/resolve/ce8e3e3657a9b767b33fc0171ff91fb04aed1b2f/v1-5-pruned-emaonly-fp16.safetensors'
digest='e9476a13728cd75d8279f6ec8bad753a66a1957ca375a1464dc63b37db6e3916'
out = root / 'comfy/models/checkpoints/v1-5-pruned-emaonly-fp16.safetensors'
if out.is_file():
    print(f'Checkpoint already present: {out}')
    raise SystemExit(0)
out.parent.mkdir(parents=True, exist_ok=True)
headers=subprocess.check_output(['curl','-fsSL','--max-time','45','-r','0-0','-D','-','-o','/dev/null',url+'?download=true'],text=True)
total=int(re.findall(r'content-range:\s*bytes 0-0/(\d+)',headers,re.I)[-1])

parts=Path('sd15-parts');parts.mkdir(exist_ok=True)
step=32*2**20
complete=sum(min(step,total-i) for i in range(0,total,step) if (parts/str(i)).exists() and (parts/str(i)).stat().st_size==min(step,total-i))
needed = (total - complete) + total + 3 * 2**30
free = shutil.disk_usage(root).free
if free < needed:
    raise SystemExit(f'Insufficient disk space: {free/2**30:.1f} GiB free, need {needed/2**30:.1f} GiB to resume while retaining 3 GiB.')
def download(start):
    end=min(start+step,total)-1
    target=parts/str(start)
    if target.exists() and target.stat().st_size==end-start+1:return target
    code=subprocess.check_output(['curl','-fsSL','--http1.1','--retry','4','--retry-all-errors','--max-time','400','-r',f'{start}-{end}','-w','%{http_code}','-o',str(target),url+f'?download=true&part={start}'],text=True)
    assert code=='206' and target.stat().st_size==end-start+1,(code,start)
    print(f'part {start//step+1}/{(total+step-1)//step}',flush=True)
    return target
with ThreadPoolExecutor(max_workers=8) as pool:
    files=list(pool.map(download,range(0,total,step)))
checksum=hashlib.sha256()
tmp=out.with_suffix('.joining')
with tmp.open('wb') as dst:
    for part in files:
        with part.open('rb') as src:
            while data:=src.read(2**20):
                dst.write(data);checksum.update(data)
assert checksum.hexdigest()==digest
tmp.replace(out)
for part in files:
    part.unlink()
parts.rmdir()
print('SD 1.5 SHA256 verified')
