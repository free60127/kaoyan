import assert from 'node:assert/strict';
import test from 'node:test';
import {cloud,device,srs,copy} from './support/sync-harness.mjs';
const K='yantu-srs-v1-333',P='yantu-personal-v1',E='yantu-exam-target-v1';
async function converge(...devices){for(let i=0;i<3;i++)for(const d of devices)await d.sync();}
async function pair(key,value){const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});a.put(key,value);await a.init();await b.init();return {c,a,b};}
const personal=note=>({version:1,seq:1,cards:[],overlays:{one:{rev:1,updatedAt:'2026-10-08T00:00:00Z',baseHash:'base',note:{text:note,runs:[]}}}});

test('round7: config rejects lookalike destinations and embedded credentials without replacing saved config',()=>{
 const a=device(cloud()),key='sb_publishable_test';for(const url of ['https://test.supabase.co.evil.test','https://test.supabase.co@evil.test','https://user:secret@test.supabase.co','http://test.supabase.co']){assert.equal(a.api.normalizeSyncConfig({url,anonKey:key}),null);assert.throws(()=>a.api.saveSyncConfig({url,anonKey:key}));}
 assert.equal(a.api.getSyncConfig().url,'https://test.supabase.co');a.api.saveSyncConfig({url:' https://TEST.supabase.co/rest/v1/ ',anonKey:' '+key+' '});assert.equal(a.api.getSyncConfig().url,'https://test.supabase.co');
});
test('round7: config storage failure is observable and leaves the prior config intact',()=>{
 const a=device(cloud());a.flags.failOnceKey='yantu-sync-config';assert.throws(()=>a.api.saveSyncConfig({url:'https://another.supabase.co',anonKey:'sb_publishable_test'}),/quota/);assert.equal(a.api.getSyncConfig().url,'https://test.supabase.co');
});
test('round7: English PC and Chinese phone resolve the same text and nontext conflict identically',async()=>{
 const c=cloud(),a=device(c,{id:'pc',locale:'en'}),b=device(c,{id:'phone',locale:'zh'});a.put(P,personal('base'));await a.init();await b.init();const x=a.read(P),y=b.read(P);x.overlays.one.note.text='阿的修改';y.overlays.one.note.text='中的修改';a.put(P,x);b.put(P,y);await converge(a,b);assert.deepEqual(a.read(P),b.read(P));
 const empty={protocol:'yantu-sync-v3',cells:{}},one={protocol:'yantu-sync-v3',cells:{'["value"]':[{clock:{pc:1},value:{choice:'阿'}},{clock:{phone:1},value:{choice:'中'}}]}};assert.deepEqual(copy(a.api.document.materialize(E,one)),copy(b.api.document.materialize(E,one)));assert.deepEqual(copy(a.api.document.mergeDocuments(empty,one)),copy(b.api.document.mergeDocuments(empty,one)));
});

test('round7: concurrent reset wins over a stale rerating, while original remains exportable',async()=>{
 const {a,b}=await pair(K,srs({one:{reps:1}}));a.put(K,srs());const value=b.read(K);value.cards.one.reps=2;b.put(K,value);await converge(a,b);
 assert.deepEqual(a.read(K).cards,{});assert.deepEqual(b.read(K).cards,{});assert.ok(JSON.stringify(a.api.getSyncConflictArchive()).includes('reps'));
});
test('round7: pausing chapter one while adding chapter two does not resume chapter one',async()=>{
 const initial=srs();initial.scopes=initial.newScopes=[{bookId:'one',chapters:[1]}];const {a,b}=await pair(K,initial);
 const x=a.read(K),y=b.read(K);x.scopes=x.newScopes=[{bookId:'one',chapters:[1,2]}];y.scopes=y.newScopes=[];a.put(K,x);b.put(K,y);await converge(a,b);
 assert.deepEqual(a.read(K).scopes.flatMap(s=>s.chapters),[2]);assert.deepEqual(a.read(K),b.read(K));
});
test('round7: grouped old v3 scopes migrate without losing clocks or reviving removals',async()=>{
 const c=cloud(),key='["scopes","{\\"bookId\\":\\"one\\",\\"chapters\\":[1,2]}"]';
 c.put(K,{protocol:'yantu-sync-v3',cells:{[key]:[{clock:{old:7},value:{bookId:'one',chapters:[1,2]}}]}});const a=device(c),b=device(c);await a.init();await b.init();
 const x=a.read(K);x.scopes=[{bookId:'one',chapters:[2]}];a.put(K,x);await converge(a,b);assert.deepEqual(b.read(K).scopes.flatMap(s=>s.chapters),[2]);
});
test('round7: long concurrent personal notes stay readable and both full originals are archived',async()=>{
 const {a,b}=await pair(P,personal('base'));const x=a.read(P),y=b.read(P);x.overlays.one.note.text='A'.repeat(15000);y.overlays.one.note.text='B'.repeat(15000);a.put(P,x);b.put(P,y);await converge(a,b);
 const parsed=copy(a.api.personal.parsePersonalStore(a.mem.get(P)));assert.ok(parsed.overlays.one?.note);assert.ok(parsed.overlays.one.note.text.length<=20000);
 const archive=JSON.stringify(a.api.getSyncConflictArchive());assert.ok(archive.includes('A'.repeat(15000)));assert.ok(archive.includes('B'.repeat(15000)));
});
test('round7: merged rich styles use plain-text offsets after textbook markup',async()=>{
 const {a,b}=await pair(P,personal('base'));const x=a.read(P),y=b.read(P);x.overlays.one.note={text:'⟦g|Alpha⟧',runs:[{start:0,end:5,kind:'b'}]};y.overlays.one.note={text:'⟦s|Beta⟧',runs:[{start:0,end:4,kind:'u'}]};a.put(P,x);b.put(P,y);await converge(a,b);
 const q=a.read(P).overlays.one.note,segments=copy(a.api.rich.renderRichSegments(q.text,q.runs));assert.equal(segments.filter(s=>s.b).map(s=>s.text).join(''),'Alpha');assert.equal(segments.filter(s=>s.u).map(s=>s.text).join(''),'Beta');
});
test('round7: more than 400 rich runs keep a valid branch and preserve full original formatting',async()=>{
 const {a,b}=await pair(P,personal('base'));const x=a.read(P),y=b.read(P);for(const [row,char] of [[x,'A'],[y,'B']])row.overlays.one.note={text:char.repeat(600),runs:Array.from({length:300},(_,i)=>({start:i*2,end:i*2+1,kind:'b'}))};a.put(P,x);b.put(P,y);await converge(a,b);
 assert.ok(a.read(P).overlays.one.note.runs.length<=400);assert.equal(Object.values(a.api.getSyncConflicts()[P])[0].length,2);
});
test('round7: partial account restore failure removes introduced B keys and preserves A',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(E,{version:1,date:'2027-12-20'});await a.sync();a.put('yantu-partition-v1',{B:{[P]:JSON.stringify(personal('private B')),[E]:JSON.stringify({version:1,date:'2028-12-20'})}});
 a.flags.failOnceKey=E;await a.api.syncSignIn('B','test');assert.equal(a.api.getSyncStatus().state,'error');assert.equal(a.read(E).date,'2027-12-20');assert.equal(a.read(P),null);
 await a.api.syncSignIn('A','test');await a.sync();assert.equal(a.read(P),null);assert.equal(a.read(E).date,'2027-12-20');
});
test('round7: server page cap smaller than requested page still downloads every record',async()=>{
 const c=cloud();for(let i=0;i<5;i++)c.put('a-unknown-'+i,{test:true});c.put(E,{version:1,date:'2028-12-20'});const a=device(c);a.flags.pageCap=2;await a.init();assert.equal(a.read(E)?.date,'2028-12-20');
});
test('round7: same mistake wrong answers on two devices accumulate without counting twice',async()=>{
 const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();a.api.mistakes.recordMistake('333','card','one','one');await converge(a,b);
 a.api.mistakes.recordMistake('333','card','one','one');b.api.mistakes.recordMistake('333','card','one','one');await converge(a,b);assert.equal(b.api.mistakes.readVisibleMistakes()[0].wrongCount,3);await converge(a,b);assert.equal(a.api.mistakes.readVisibleMistakes()[0].wrongCount,3);
});
test('round7: independent first wrong answers on the same question also accumulate',async()=>{
 const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();a.api.mistakes.recordMistake('825','quiz','one','one');b.api.mistakes.recordMistake('825','quiz','one','one');await converge(a,b);assert.equal(b.api.mistakes.readVisibleMistakes()[0].wrongCount,2);
});
test('round7: legacy mistakes migrate once, and a wrong answer after deletion can return',async()=>{
 const c=cloud();c.put('yantu-mistakes-v1',[{id:'333:card:one',subject:'333',kind:'card',refId:'one',label:'one',wrongCount:3,lastAt:'2026-10-07T00:00:00Z'}]);const a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();
 a.api.mistakes.recordMistake('333','card','one','one');b.api.mistakes.recordMistake('333','card','one','one');await converge(a,b);assert.equal(a.api.mistakes.readVisibleMistakes()[0].wrongCount,5);
 a.api.mistakes.removeMistake('333:card:one');await converge(a,b);assert.equal(b.api.mistakes.readVisibleMistakes().length,0);b.api.mistakes.recordMistake('333','card','one','one');await converge(a,b);assert.equal(a.api.mistakes.readVisibleMistakes()[0].wrongCount,6);
 const fresh=device(c);await fresh.init();assert.equal(fresh.api.mistakes.readVisibleMistakes()[0].wrongCount,6);
});
test('round7: three clients preserve disjoint edits over offline retry and cold reload',async()=>{
 const c=cloud(),clients=['pc','phone','tablet'].map(id=>device(c,{id}));for(const d of clients)await d.init();
 for(let round=0;round<12;round++){for(const [i,d] of clients.entries()){d.flags.failPull=d.flags.failPush=true;const value=d.read(K)||srs();value.cards['card-'+round+'-'+i]={reps:round+1};d.put(K,value);await d.sync();d.flags.failPull=d.flags.failPush=false;}await converge(...(round%2?[...clients].reverse():clients));}
 const fresh=device(c,{id:'fresh'});await fresh.init();assert.equal(Object.keys(fresh.read(K).cards).length,36);for(const d of clients)assert.deepEqual(d.read(K),fresh.read(K));
});
