import assert from 'node:assert/strict';
import test from 'node:test';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {cloud,device,copy} from './support/sync-harness.mjs';
const K='yantu-mistakes-v1';
const converge=async(...clients)=>{for(let i=0;i<4;i++)for(const client of clients)await client.sync();};
const again=d=>{const token=d.api.mistakes.captureMistakeUndo('333','card','one');assert.equal(d.api.mistakes.recordMistake('333','card','one','one'),true);return token;};
const visible=d=>copy(d.api.mistakes.readVisibleMistakes());
const compiled=await build({entryPoints:[fileURLToPath(new URL('../lib/study-backup.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
const backup=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const catalogs=await backup.loadBackupCatalogs();
const exportBackup=d=>backup.collectStudyBackup({getItem:k=>d.mem.get(k)||null},catalogs,new Date());

test('round8: twice rating and undo leaves no wrongs, quota-independent backup is restorable',async()=>{
 const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();
 for(let i=0;i<2;i++){const token=again(a);assert.equal(a.api.mistakes.undoMistake(token),true);assert.equal(a.api.mistakes.undoMistake(token),false);assert.equal(visible(a).length,0);await converge(a,b);assert.equal(visible(b).length,0);}
 const value=exportBackup(a);assert.equal(value.records[K][0].wrongCount,0);assert.equal(backup.validateStudyBackup(value,catalogs).records[K][0].wrongCount,0);
 const fresh=device(c);await fresh.init();assert.equal(visible(fresh).length,0);
});

test('round8: undo preserves prior errors and restores a previously deleted entry',async()=>{
 const c=cloud(),a=device(c);await a.init();again(a);const second=again(a);a.api.mistakes.undoMistake(second);assert.equal(visible(a)[0].wrongCount,1);
 a.api.mistakes.removeMistake('333:card:one');const third=again(a);assert.equal(visible(a)[0].wrongCount,2);a.api.mistakes.undoMistake(third);assert.equal(visible(a).length,0);await a.sync();
 const fresh=device(c);await fresh.init();assert.equal(visible(fresh).length,0);assert.equal(fresh.read(K)[0].wrongCount,1);
});

test('round8: concurrent phone error survives PC undo, in either sync order',async()=>{
 for(const reverse of [false,true]){
  const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();again(a);await converge(a,b);
  const token=again(a);again(b);a.api.mistakes.undoMistake(token);await converge(...(reverse?[b,a]:[a,b]));
  assert.equal(visible(a)[0].wrongCount,2);assert.deepEqual(a.read(K),b.read(K));assert.equal(visible(b)[0].wrongCounts.pc,1);assert.equal(visible(b)[0].wrongCounts.phone,1);
 }
});

test('round8: undo restoring a deleted entry does not hide a concurrent new phone error',async()=>{
 const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();again(a);a.api.mistakes.removeMistake('333:card:one');await converge(a,b);
 const token=again(a);again(b);a.api.mistakes.undoMistake(token);await converge(a,b);assert.equal(visible(b)[0].wrongCount,2);assert.equal(visible(a)[0].wrongCounts.pc,1);
 // Explicit deletion remains stronger than a concurrent increment.
 a.api.mistakes.removeMistake('333:card:one');again(b);await converge(a,b);assert.equal(visible(a).length,0);
});

test('round8: old whole-row v3 counters keep causal clocks and do not revive an undone increment',async()=>{
 const c=cloud(),id='333:card:one',value={id,subject:'333',kind:'card',refId:'one',label:'one',wrongCount:2,wrongCounts:{pc:2},lastAt:'2026-10-08T00:00:00Z'};
 c.put(K,{protocol:'yantu-sync-v3',cells:{[JSON.stringify([id])]:[{clock:{pc:7},value}]}});
 const a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();const token=again(a);a.api.mistakes.undoMistake(token);again(b);await converge(a,b);assert.equal(visible(a)[0].wrongCount,3);assert.equal(visible(a)[0].wrongCounts.pc,2);
 const fresh=device(c);await fresh.init();assert.equal(visible(fresh)[0].wrongCount,3);
});

test('round8: legacy inconsistent local counts are repaired for reads/export but malformed imports fail',()=>{
 const a=device(cloud());a.put(K,[{id:'333:card:one',subject:'333',kind:'card',refId:'one',label:'one',wrongCount:1,wrongCounts:{pc:2},lastAt:'2026-10-08T00:00:00Z'}]);
 assert.equal(visible(a)[0].wrongCounts.pc,1);const value=exportBackup(a);assert.equal(value.records[K][0].wrongCounts.pc,1);
 const bad=copy(value);bad.records[K][0].wrongCounts.pc=2;assert.throws(()=>backup.validateStudyBackup(bad,catalogs),/与错题总次数不一致/);
});

test('round8: whole-row legacy tombstone survives migration, and a new error does not inherit removed counters',async()=>{
 const c=cloud(),id='333:card:one',value={id,subject:'333',kind:'card',refId:'one',label:'one',wrongCount:4,wrongCounts:{old:4},lastAt:'2026-10-08T00:00:00Z'};
 const doc={protocol:'yantu-sync-v3',cells:{[JSON.stringify([id])]:[{clock:{old:1},value},{clock:{old:2},value:null,deleted:true}]}};c.put(K,doc);
 const a=device(c,{id:'pc'});await a.init();assert.equal(visible(a).length,0);again(a);await a.sync();assert.equal(visible(a)[0].wrongCount,1);
 const fresh=device(c);await fresh.init();assert.equal(visible(fresh)[0].wrongCount,1);
});

test('round8: manual pending review is not a wrong answer, and cancellation survives cold reload',async()=>{
 const c=cloud(),a=device(c),b=device(c);await a.init();await b.init();a.api.mistakes.markPendingReview('825','quiz','manual','manual');await converge(a,b);
 assert.equal(visible(b)[0].pendingOnly,true);assert.equal(visible(b)[0].wrongCount,0);const value=exportBackup(a);assert.equal(backup.validateStudyBackup(value,catalogs).records[K][0].pendingOnly,true);
 b.api.mistakes.removeMistake('825:quiz:manual');await converge(a,b);const fresh=device(c);await fresh.init();assert.equal(visible(fresh).length,0);
});

test('round8: applying only bold to marked text is idempotent with stable plain offsets',()=>{
 const a=device(cloud()),r=a.api.rich,original='⟦s|Creativity⟧ helps. 后文';
 const field=copy(r.textbookEditContent({text:original,runs:[]}));assert.equal(field.text,'Creativity helps. 后文');field.runs=[{start:11,end:16,kind:'b'}];
 const saved=r.reinjectTextbookMarkers(original,field.text);assert.equal(saved,original);assert.equal(r.reinjectTextbookMarkers(original,saved),original);
 const segments=copy(r.renderRichSegments(saved,field.runs));assert.equal(segments.filter(x=>x.b).map(x=>x.text).join(''),'helps');assert.ok(segments.some(x=>x.textbook==='hl-s'));
 const reopened=copy(r.textbookEditContent({text:saved,runs:field.runs}));assert.deepEqual(reopened,field);
});

test('round8: old nested overlays and raw drafts repair formatting without damaging notes',()=>{
 const a=device(cloud()),r=a.api.rich,marked='⟦s|Alpha⟧ tail';
 const raw={text:marked,runs:[{start:10,end:14,kind:'b'}]};assert.equal(r.textbookEditContent(raw,true).text,'Alpha tail');
 const nested={text:'⟦s|⟦s|Alpha⟧⟧ tail',runs:raw.runs};const repaired=copy(r.repairNestedTextbookContent(nested));assert.equal(repaired.text,marked);
 assert.equal(r.renderRichSegments(repaired.text,repaired.runs).filter(x=>x.b).map(x=>x.text).join(''),'tail');
 const literal={text:'我的文字 ⟦unknown|literal⟧',runs:[]};assert.deepEqual(copy(r.repairNestedTextbookContent(literal)),literal);
});

test('round8: write failure leaves a cancellable wrong answer and reports storage error',()=>{
 const a=device(cloud()),token=again(a);a.flags.failWrite=true;assert.equal(a.api.mistakes.undoMistake(token),false);assert.equal(visible(a)[0].wrongCount,1);
 a.flags.failWrite=false;assert.equal(a.api.mistakes.undoMistake(token),true);assert.equal(visible(a).length,0);
});

test('round8: fresh deployment provides public connection defaults; saved project stays authoritative',()=>{
 const a=device(cloud());a.mem.delete('yantu-sync-config');assert.equal(a.api.getSyncConfig().url,'https://mevvrqjdznoeewulyagl.supabase.co');
 a.api.saveSyncConfig({url:'https://own-project.supabase.co',anonKey:'sb_publishable_test'});assert.equal(a.api.getSyncConfig().url,'https://own-project.supabase.co');
 a.mem.set('yantu-sync-config','{broken');assert.equal(a.api.getSyncConfig(),null);
});
