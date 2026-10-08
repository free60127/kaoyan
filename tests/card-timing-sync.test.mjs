import test from 'node:test';
import assert from 'node:assert/strict';
import {cloud,device,settle,copy} from './support/sync-harness.mjs';
const key='yantu-card-timing-v1-825';
const row=(id,ms,status='completed')=>({id,cardId:'same-card',label:'问题',contentKey:'same',kind:'new',startedAt:'2026-10-08T12:00:00Z',updatedAt:'2026-10-08T12:01:00Z',elapsedMs:ms,days:{'2026-10-08':ms},status,...(status!=='interrupted'?{grade:'good'}:{})});
test('PC/phone simultaneous attempts on same card union, repeated sync does not double count',async()=>{
  const c=cloud(),a=device(c,{id:'PC'}),b=device(c,{id:'phone'});await a.init();await b.init();
  a.put(key,{pc:row('pc',60000)});b.put(key,{phone:row('phone',45000)});await Promise.all([a.sync(),b.sync()]);await a.sync();await b.sync();
  assert.deepEqual(a.read(key),b.read(key));assert.deepEqual(Object.keys(a.read(key)).sort(),['pc','phone']);for(let i=0;i<3;i++){await a.sync();await b.sync();}assert.equal(Object.values(b.read(key)).reduce((s,r)=>s+r.elapsedMs,0),105000);
});
test('checkpoint completion and later undo propagate, stale phone cannot revive completed row',async()=>{
  const c=cloud(),a=device(c,{id:'PC'}),b=device(c,{id:'phone'});await a.init();await b.init();
  a.put(key,{pc:row('pc',15000,'interrupted')});await a.sync();await b.sync();a.put(key,{pc:row('pc',30000)});await a.sync();await b.sync();
  assert.equal(b.read(key).pc.status,'completed');a.put(key,{pc:row('pc',30000,'undone')});await a.sync();await b.sync();assert.equal(b.read(key).pc.status,'undone');assert.equal(b.read(key).pc.elapsedMs,30000);
});
test('offline attempts survive device restart and reconnect alongside other device',async()=>{
  const c=cloud(),a=device(c,{id:'PC'}),b=device(c,{id:'phone'});await a.init();await b.init();a.flags.failPush=true;
  a.put(key,{pc:row('pc',20000)});await a.sync();b.put(key,{phone:row('phone',30000)});await b.sync();const restart=device(c,{id:'PC',disk:a.mem});await restart.init();await b.sync();assert.equal(Object.keys(b.read(key)).length,2);
});
test('switch is synchronized and account partitions isolate both settings and history',async()=>{
  const c=cloud(),a=device(c,{id:'PC'}),b=device(c,{id:'phone'});await a.init();await b.init();const setting='yantu-card-timing-settings-v1';a.put(setting,{enabled:false});a.put(key,{pc:row('pc',20000)});await a.sync();await b.sync();assert.equal(b.read(setting).enabled,false);
  await a.api.syncSignOut();await settle();await a.api.syncSignIn('B','pw');await settle();await a.sync();assert.equal(a.read(key),null);assert.equal(a.read(setting),null);
  await a.api.syncSignOut();await settle();await a.api.syncSignIn('A','pw');await settle();await a.sync();assert.equal(a.read(setting).enabled,false);assert.equal(a.read(key).pc.elapsedMs,20000);
});
test('account-changing event precedes final capture and partition save',async()=>{
  const c=cloud(),a=device(c,{id:'PC'});await a.init();a.window.addEventListener('yantu-account-changing',()=>a.put(key,{final:row('final',12345)}),{once:true});await a.api.syncSignOut();await settle();
  await a.api.syncSignIn('A','pw');await settle();await a.sync();assert.equal(a.read(key).final.elapsedMs,12345);
});
test('concurrent toggle changes prefer off, explicitly enabling after merge resolves it',async()=>{
  const c=cloud(),a=device(c,{id:'PC'}),b=device(c,{id:'phone'}),key='yantu-card-timing-settings-v1';await a.init();await b.init();
  a.put(key,{enabled:false});b.put(key,{enabled:true});await Promise.all([a.sync(),b.sync()]);await a.sync();await b.sync();assert.equal(b.read(key).enabled,false);
  b.put(key,{enabled:true});await b.sync();await a.sync();assert.equal(a.read(key).enabled,true);
});
test('restoring already-active authenticated account does not interrupt the current timer',async()=>{
  const c=cloud(),a=device(c,{id:'PC',disk:[['yantu-sync-active-partition','A']]});let changing=0;a.window.addEventListener('yantu-account-changing',()=>changing++);await a.init();assert.equal(changing,0);
});

test('failed account partition save reports recovery event and retains original timing history',async()=>{
 const c=cloud(),a=device(c,{id:'PC'});await a.init();a.put(key,{pc:row('pc',20000)});
 let failed=0;a.window.addEventListener('yantu-account-change-failed',()=>failed++);
 a.flags.failOnceKey='yantu-partition-v1';
 await a.api.syncSignOut();await settle();
 assert.equal(failed,1);assert.equal(a.mem.get('yantu-sync-active-partition'),'A');assert.equal(a.read(key).pc.elapsedMs,20000);
 await a.api.syncSignIn('A','pw');await settle();await a.sync();assert.equal(a.read(key).pc.elapsedMs,20000);
 await a.api.syncSignOut();await settle();assert.equal(a.read(key),null);
});
