import fs from 'node:fs/promises';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url), {build}=require('esbuild');
const root=fileURLToPath(new URL('../../',import.meta.url));
const source=await fs.readFile(root+'/lib/sync/engine.ts','utf8');
const compiled=await build({stdin:{contents:source+'\nexport * as stats from "../stats"; export * as mistakes from "../mistakes"; export * as personal from "../personal-cards"; export * as document from "./document";',resolveDir:root+'/lib/sync',loader:'ts'},bundle:true,write:false,format:'iife',globalName:'Engine',platform:'node',plugins:[{name:'transport',setup(b){b.onResolve({filter:/^@supabase\/supabase-js$/},()=>({path:'client',namespace:'test'}));b.onLoad({filter:/.*/,namespace:'test'},()=>({contents:'export const createClient = () => globalThis.testClient;',loader:'js'}));}}]});
export const copy=v=>JSON.parse(JSON.stringify(v));
export function cloud(){return {rows:new Map(),calls:[],put(key,value,uid='A'){this.rows.set(uid+'|'+key,{user_id:uid,key,value:copy(value)});}};}
export function device(cloud,{uid='A',id=Math.random().toString(36),disk}={}){
  const mem=new Map(disk), flags={failPush:false,failPull:false,failWrite:false,holdPush:false,failSignOut:false,failPage:false}, callbacks=[],intervals=[],releases=[],channels=[];
  const storage={get length(){return mem.size;},key:i=>[...mem.keys()][i]??null,getItem:k=>mem.get(k)??null,setItem:(k,v)=>{if(flags.failWrite)throw Error('quota');mem.set(k,String(v));},removeItem:k=>{if(flags.failWrite)throw Error('quota');mem.delete(k);}};
  mem.set('yantu-sync-config',JSON.stringify({url:'https://test.supabase.co',anonKey:'sb_publishable_test'})); mem.set('yantu-device-id',id);
  const client={auth:{getSession:async()=>({data:{session:uid?{user:{id:uid,email:uid+'@test'}}:null}}),onAuthStateChange:cb=>callbacks.push(cb),signOut:async options=>{cloud.calls.push({type:'signOut',options});if(flags.failSignOut)return {error:Error('logout unavailable')};uid=null;callbacks.forEach(cb=>cb('SIGNED_OUT',null));return {error:null};},signInWithPassword:async({email})=>{uid=email;callbacks.forEach(cb=>cb('SIGNED_IN',{user:{id:uid,email}}));return {error:null};}},
    from:()=>({select:()=>({eq:(_field,user)=>{const query={order:()=>query,range:async(from,to)=>{cloud.calls.push({type:'pull',user,from,to});return flags.failPull||flags.failPage&&from>0?{error:{message:'offline'}}:{data:[...cloud.rows.values()].filter(r=>r.user_id===user).sort((a,b)=>a.key.localeCompare(b.key)).slice(from,to+1).map(copy),error:null};}};return query;}}),upsert:async row=>{cloud.calls.push({type:'push',row:copy(row)});if(flags.holdPush)await new Promise(resolve=>releases.push(resolve));if(flags.failPush)return {error:{message:'offline'}};cloud.rows.set(row.user_id+'|'+row.key,copy(row));return {error:null};}}),
    channel:()=>{const ch={on:(_type,_opts,callback)=>{channels.push(callback);return ch;},subscribe:()=>ch};return ch;},removeChannel:async()=>{}};
  class StorageEvent extends Event {constructor(type,options){super(type);Object.assign(this,options);}}
  const win=new EventTarget(),doc=new EventTarget(); doc.visibilityState='visible';
  const context=vm.createContext({testClient:client,localStorage:storage,window:win,document:doc,location:{href:'http://test'},Event,StorageEvent,CustomEvent:class extends Event{constructor(t,o){super(t);this.detail=o?.detail;}},Date,Math,console,setInterval:fn=>{intervals.push(fn);return fn;},clearInterval:fn=>{const i=intervals.indexOf(fn);if(i>=0)intervals.splice(i,1);}});
  vm.runInContext(compiled.outputFiles[0].text,context);
  const api=context.Engine;
  return {api,mem,flags,intervals,releases,channels,window:win,put:(k,v)=>storage.setItem(k,JSON.stringify(v)),read:k=>copy(JSON.parse(storage.getItem(k)||'null')),init:async()=>{await api.initSync();await api.syncNow();},sync:()=>api.syncNow()};
}
export const settle=async()=>{for(let i=0;i<40;i++)await Promise.resolve();};
export const srs=(cards={})=>({version:1,cards,scopes:[],newScopes:[],dailyNewLimit:20,daily:{date:'2026-10-08',admitted:Object.keys(cards)}});
