import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import type {Asset,Profile,Plan,Question} from '../shared/contracts';
export interface Job {id:string;profileId:string;plan:Plan;done:number;status:'queued'|'running'|'failed'|'complete';error:string}
export const uid=randomUUID;
export function normalize(s:string){return s.normalize('NFKC').toLowerCase().replace(/[\u064B-\u065F\u0670ـ]/g,'').replace(/[أإآ]/g,'ا').replace(/[^\p{L}\p{N}]+/gu,' ').trim()}
export function cosine(a:number[],b:number[]){if(a.length!==b.length)return 0;let dot=0,x=0,y=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];x+=a[i]**2;y+=b[i]**2}return dot/(Math.sqrt(x*y)||1)}
export class Store{
 db:DatabaseSync;
 constructor(dir:string){mkdirSync(dir,{recursive:true});this.db=new DatabaseSync(path.join(dir,'forge.sqlite'));this.db.exec(`
 PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS profiles(id TEXT PRIMARY KEY, body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,meta TEXT NOT NULL,png BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,profile TEXT REFERENCES profiles(id),body TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS questions(id TEXT PRIMARY KEY,profile TEXT REFERENCES profiles(id),norm TEXT NOT NULL,body TEXT NOT NULL,vector TEXT NOT NULL,UNIQUE(profile,norm));`);
 if(!this.profile('default'))this.saveProfile('default',{name:'لعبة المسابقات',rules:'',mapping:{}});
 }
 profile(id:string):Profile|undefined{const row=this.db.prepare('SELECT body FROM profiles WHERE id=?').get(id);return row&&JSON.parse(String(row.body))}
 profiles(){return this.db.prepare('SELECT * FROM profiles').all().map(r=>({id:r.id,...JSON.parse(String(r.body))}))}
 saveProfile(id:string,p:Profile){this.db.prepare('INSERT INTO profiles VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(id,JSON.stringify(p))}
 job(id:string):Job|undefined{const row=this.db.prepare('SELECT body FROM jobs WHERE id=?').get(id);return row&&JSON.parse(String(row.body))}
 jobs():Job[]{return this.db.prepare('SELECT body FROM jobs ORDER BY rowid').all().map(r=>JSON.parse(String(r.body)))}
 saveJob(j:Job){this.db.prepare('INSERT INTO jobs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(j.id,j.profileId,JSON.stringify(j))}
 questions(id:string):Question[]{return this.db.prepare('SELECT body FROM questions WHERE profile=? ORDER BY rowid').all(id).map(r=>JSON.parse(String(r.body)))}
 duplicate(profile:string,text:string,v:number[]){return this.db.prepare('SELECT norm,vector FROM questions WHERE profile=?').all(profile).some(r=>r.norm===normalize(text)||cosine(v,JSON.parse(String(r.vector)))>=0.92)}
 add(q:Question,v:number[]){this.db.prepare('INSERT INTO questions VALUES(?,?,?,?,?)').run(q.id,q.profileId,normalize(q.question),JSON.stringify(q),JSON.stringify(v))}
 assets():Asset[]{return this.db.prepare('SELECT meta FROM assets').all().map(r=>JSON.parse(String(r.meta)))}
 asset(id:string){const r=this.db.prepare('SELECT png FROM assets WHERE id=?').get(id);return r&&Buffer.from(r.png as Uint8Array)}
 putAsset(meta:Asset,png:Buffer){this.db.prepare('INSERT INTO assets VALUES(?,?,?)').run(meta.id,JSON.stringify(meta),png)}
 transaction(fn:()=>void){this.db.exec('BEGIN IMMEDIATE');try{fn();this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
}
