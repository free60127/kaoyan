import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const compiled=await build({entryPoints:[root+'lib/card-timing.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const {createCardTimer,saveCardTiming,flushCardTiming,validateTimingRecords,readTimingRecords,timingComparisons,timingContentKey,timingEnabled,setTimingEnabled}=api;
const base={id:'attempt',cardId:'c1',label:'问题',contentKey:timingContentKey('问题','答案'),kind:'new',startedAt:'2026-10-08T10:00:00.000Z'};
const row=(id,ms,status='completed',extra={})=>({...base,id,elapsedMs:ms,days:{'2026-10-08':ms},updatedAt:base.startedAt,status,...(status!=='interrupted'?{grade:'good'}:{}),...extra});
function memory(){const data=new Map();return {data,fail:false,getItem:k=>data.get(k)??null,setItem(k,v){if(this.fail)throw Error('quota');data.set(k,v);}};}
test('flip/checkpoint keeps same attempt, pause excludes background and completion is idempotent',()=>{
  let mono=0,wall=Date.parse(base.startedAt);const timer=createCardTimer(base,()=>({monotonic:mono,wall}));const advance=n=>{mono+=n;wall+=n;};
  timer.resume();advance(12500);assert.equal(timer.checkpoint().elapsedMs,12500);
  advance(7500);timer.pause();advance(120000);timer.pause();timer.resume();advance(10000);
  const done=timer.finish('good');assert.equal(done.elapsedMs,30000);assert.equal(done.status,'completed');assert.equal(timer.finish('again'),null);
});
test('date buckets split midnight instead of attributing all time to last day',()=>{
  let wall=new Date(2026,9,8,23,59,50).getTime(),monotonic=0;
  const timer=createCardTimer({...base,startedAt:new Date(wall).toISOString()},()=>({monotonic,wall}));timer.resume();wall+=30000;monotonic+=30000;
  const done=timer.finish('hard');assert.deepEqual(done.days,{'2026-10-08':10000,'2026-10-09':20000});assert.equal(done.elapsedMs,30000);
});
test('wall clock changes cannot create negative or inflated duration',()=>{
  let wall=Date.parse(base.startedAt),monotonic=0;const timer=createCardTimer(base,()=>({monotonic,wall}));timer.resume();wall-=3600000;monotonic+=2300;assert.equal(timer.finish().elapsedMs,2300);
});
test('fractional checkpoints do not accumulate rounding loss',()=>{
  let mono=0;const timer=createCardTimer(base,()=>({monotonic:mono,wall:Date.parse(base.startedAt)+mono}));timer.resume();for(let i=0;i<10;i++){mono+=0.6;timer.checkpoint();}assert.equal(timer.finish().elapsedMs,5);
});
test('writes upsert attempt IDs, preserve other tabs and safely retry quota failure',()=>{
  const store=memory();saveCardTiming(store,'825',row('a',4000));saveCardTiming(store,'825',row('b',5000));saveCardTiming(store,'825',row('a',7000));
  assert.equal(Object.keys(readTimingRecords(store,'825')).length,2);assert.equal(readTimingRecords(store,'825').a.elapsedMs,7000);
  store.fail=true;assert.equal(saveCardTiming(store,'825',row('a',9000),'A'),false);store.fail=false;
  assert.equal(flushCardTiming(store,'825','B'),true);assert.equal(readTimingRecords(store,'825').a.elapsedMs,7000);
  assert.equal(flushCardTiming(store,'825','A'),true);assert.equal(readTimingRecords(store,'825').a.elapsedMs,9000);
});
test('damaged persistent history is not overwritten, short mount probes omitted',()=>{
  const store=memory();assert.equal(saveCardTiming(store,'333',row('probe',3,'interrupted')),true);assert.equal(store.data.size,0);
  store.data.set(api.cardTimingKey('333'),'bad json');assert.equal(saveCardTiming(store,'333',row('valid',5000)),false);assert.equal(store.data.get(api.cardTimingKey('333')),'bad json');
});
test('invalid times, ID mismatch, dangerous IDs and inconsistent sums rejected',()=>{
  for(const r of [row('a',-1),row('a',Infinity),row('a',1000,'completed',{startedAt:'2026-02-30T12:00:00Z'}),row('a',1000,'completed',{days:{'2026-02-30':1000}}),row('a',1000,'completed',{days:{'2026-10-08':900}}),row('a',1000,'completed',{grade:undefined}),row('a',1000,'completed',{cardId:'__proto__'})])assert.throws(()=>validateTimingRecords({a:r}));
  assert.throws(()=>validateTimingRecords({b:row('a',1000)}));assert.deepEqual(validateTimingRecords({a:row('a',1000)}).a,row('a',1000));
});
test('comparison excludes partial/undone and resets after content changes',()=>{
  const rows=[row('a',60000),row('b',45000,'completed',{startedAt:'2026-10-08T11:00:00Z'}),row('c',90000,'undone',{startedAt:'2026-10-08T12:00:00Z'}),row('d',3000,'interrupted',{startedAt:'2026-10-08T13:00:00Z'})];
  assert.equal(timingComparisons(rows)[0].improvement,25);assert.equal(timingComparisons(rows)[0].history.length,4);
  rows.push(row('e',12000,'completed',{contentKey:'changed',startedAt:'2026-10-08T14:00:00Z'}));assert.equal(timingComparisons(rows)[0].improvement,null);assert.equal(timingComparisons(rows)[0].completedCount,1);
});
test('timer switch defaults on, persists off and fails without claiming success',()=>{
  const store=memory();assert.equal(timingEnabled(store),true);assert.equal(setTimingEnabled(store,false),true);assert.equal(timingEnabled(store),false);store.fail=true;assert.equal(setTimingEnabled(store,true),false);assert.equal(timingEnabled(store),false);
});
test('backup round trips timing history and switch, rejects bad totals before writes',async()=>{
  const out=await build({entryPoints:[root+'lib/study-backup.ts'],bundle:true,write:false,platform:'node',format:'esm'});
  const backup=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  const catalogs=await backup.loadBackupCatalogs(), source=memory();source.removeItem=k=>source.data.delete(k);
  saveCardTiming(source,'825',row('archive',51000));setTimingEnabled(source,false);
  const snapshot=backup.collectStudyBackup(source,catalogs,new Date(base.startedAt));const target=memory();target.removeItem=k=>target.data.delete(k);
  backup.applyStudyBackup(target,snapshot,catalogs);assert.equal(timingEnabled(target),false);assert.deepEqual(readTimingRecords(target,'825'),readTimingRecords(source,'825'));
  assert.ok(backup.buildBackupDocument(snapshot,catalogs).blocks.some(b=>b.text.includes('51 秒')));
  snapshot.records[api.cardTimingKey('825')].archive.elapsedMs=12;assert.throws(()=>backup.applyStudyBackup(target,snapshot,catalogs),/不一致/);
});
