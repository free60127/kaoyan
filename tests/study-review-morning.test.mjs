import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
async function module(path){const b=await build({entryPoints:[fileURLToPath(new URL(path,import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const s=await module('../lib/study-scheduler.ts'),u=await module('../lib/use-study-review.ts');
const morning=(day)=>new Date(2026,9,day,6,30).toISOString();
const at=(day,hour,minute=0)=>new Date(2026,9,day,hour,minute);
const catalog=['a','b','c'].map(id=>({id,book:'book',chapter:1}));
const base=s.previewSchedule(undefined,'good',at(9,12));
const row=(dueAt,extra={})=>({...base,dueAt,...extra});
const progress=cards=>({...s.createEmptyProgress(at(9,12)),cards,scopes:[{bookId:'book',chapters:[1]}],newScopes:[]});
function storage(value){const disk=new Map([['yantu-srs-v1-333',JSON.stringify(value)]]);return {disk,writes:0,fail:false,getItem:k=>disk.get(k)??null,setItem(k,v){this.writes++;if(this.fail)throw Error('quota');disk.set(k,v);}};}

test('new cards rated at different hours have shared next-day and fourth-day morning starts',()=>{
 for(const hour of [0,6,12,23])for(const [grade,day]of [['good',10],['easy',13]]){
  const preview=s.previewSchedule(undefined,grade,at(9,hour,47));assert.equal(preview.dueAt,morning(day));
  assert.equal(s.applyRating(progress({}),'a',grade,at(9,hour,47)).cards.a.dueAt,preview.dueAt);
 }
});
test('mature hard/good/easy day intervals open at 06:30 and retain interval and study history',()=>{
 const old=row(morning(9),{intervalDays:10,reps:5,ease:2.5});
 for(const [grade,days]of [['hard',12],['good',25],['easy',32.5]]){
  const next=s.previewSchedule(old,grade,at(9,12,47)),due=new Date(next.dueAt);
  assert.equal(next.intervalDays,days);assert.equal(due.getHours(),6);assert.equal(due.getMinutes(),30);assert.equal(due.getSeconds(),0);
  assert.equal(next.firstStudiedAt,old.firstStudiedAt);assert.equal(next.lastReviewedAt,at(9,12,47).toISOString());
 }
 assert.equal(s.previewSchedule(base,'hard',at(9,12,47)).dueAt,morning(10));
});
test('minute learning and mature again remain exactly 1/5 minutes even when crossing midnight',()=>{
 const late=at(9,23,59);
 for(const [old,grade,minutes]of [[undefined,'again',1],[undefined,'hard',5],[base,'again',1]]){
  const next=s.previewSchedule(old,grade,late);assert.equal(Date.parse(next.dueAt)-late.getTime(),minutes*60000);
  assert.equal(next.intervalDays,minutes/1440);
 }
});
test('old scattered day schedules enter the queue together exactly at 06:30',()=>{
 const saved=progress({a:row(at(10,12,48).toISOString()),b:row(at(10,23,15).toISOString()),c:row(at(10,0,3).toISOString(),{stage:'learning',intervalDays:5/1440})});
 const before=s.buildStudyQueue(catalog,saved,new Date(2026,9,10,6,29,59,999));
 assert.deepEqual(before.items.map(x=>x.cardId),['c']);assert.equal(before.nextDueAt,morning(10));
 const after=s.buildStudyQueue(catalog,saved,at(10,6,30));assert.deepEqual(after.items.map(x=>x.cardId),['c','a','b']);
});
test('automatic migration changes due times only, preserves unknown history and damaged rows, and writes once',()=>{
 const saved=progress({a:row(at(10,12,48).toISOString()),b:row(at(9,12,52).toISOString(),{stage:'learning',intervalDays:5/1440}),retired:row(at(13,20).toISOString()),broken:{dueAt:'bad'}});
 saved.custom='keep';const original=structuredClone(saved),disk=storage(saved);
 const controller=u.createStudyReviewSync('333',catalog,disk,()=>at(9,12));assert.equal(controller.ready,true);assert.equal(controller.storageError,'');
 const migrated=JSON.parse(disk.getItem('yantu-srs-v1-333'));assert.equal(migrated.cards.a.dueAt,morning(10));assert.equal(migrated.cards.retired.dueAt,morning(13));
 migrated.cards.a.dueAt=original.cards.a.dueAt;migrated.cards.retired.dueAt=original.cards.retired.dueAt;assert.deepEqual(migrated,original);
 controller.refresh();controller.storageChanged({key:'yantu-srs-v1-333'});assert.equal(disk.writes,1);assert.deepEqual(saved,original);
});
test('failed migration retains visible history and warning until persistence recovers',()=>{
 const disk=storage(progress({a:row(at(10,12,48).toISOString())}));disk.fail=true;
 const controller=u.createStudyReviewSync('333',catalog,disk,()=>at(9,12));assert.equal(controller.ready,true);assert.equal(controller.session.progress.cards.a.dueAt,morning(10));assert.ok(controller.storageError);assert.equal(controller.hasPendingWrites,true);
 assert.equal(controller.rateCard('a','good'),null);assert.ok(controller.storageError);
 disk.fail=false;controller.refresh();assert.equal(controller.storageError,'');assert.equal(controller.hasPendingWrites,false);assert.equal(JSON.parse(disk.getItem('yantu-srs-v1-333')).cards.a.dueAt,morning(10));
});
test('day schedules use calendar dates through month/year/leap-day and daylight-saving transitions',()=>{
 for(const now of [new Date(2026,0,31,23,55),new Date(2028,1,28,12),new Date(2026,11,31,12),new Date(2026,10,1,0,30),new Date(2026,2,8,0,30)]){
  const expected=new Date(now);expected.setDate(expected.getDate()+1);expected.setHours(6,30,0,0);
  assert.equal(s.previewSchedule(undefined,'good',now).dueAt,expected.toISOString());
 }
});
