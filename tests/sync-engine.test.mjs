import assert from 'node:assert/strict';
import test from 'node:test';
import {cloud,device,srs,settle,copy} from './support/sync-harness.mjs';
const K='yantu-srs-v1-333', E='yantu-exam-target-v1', S='yantu-learning-session-v1', P='yantu-personal-v1';
const converge=async(a,b)=>{for(let i=0;i<4;i++){await a.sync();await b.sync();}};

test('actual engine: logout revokes only this device and propagates auth errors',async()=>{
 const c=cloud(),a=device(c);await a.init();a.flags.failSignOut=true;await assert.rejects(a.api.syncSignOut(),/logout unavailable/);assert.equal(a.api.getSyncStatus().email,'A@test');
 a.flags.failSignOut=false;await a.api.syncSignOut();assert.equal(a.api.getSyncStatus().state,'signed-out');assert.ok(c.calls.filter(call=>call.type==='signOut').every(call=>call.options.scope==='local'));
});

test('actual engine: download reads all pages and retries a later-page failure',async()=>{
 const c=cloud();for(let i=0;i<500;i++)c.put('a-unknown-'+String(i).padStart(4,'0'),{unrelated:true});c.put(E,{version:1,date:'2029-12-20'});
 const a=device(c);a.flags.failPage=true;await a.init();assert.equal(a.read(E),null);assert.equal(a.api.getSyncStatus().state,'error');
 a.flags.failPage=false;await a.sync();assert.equal(a.read(E).date,'2029-12-20');assert.ok(c.calls.some(call=>call.type==='pull'&&call.from===500));assert.equal(a.api.getSyncStatus().state,'online');
});

test('actual engine: parallel study converges and idle sync sends no updates',async()=>{
 const c=cloud(),a=device(c),b=device(c);a.put(K,srs());b.put(K,srs());await a.init();await b.init();
 a.put(K,srs({pc:{lastReviewedAt:'2099-01-01'}}));b.put(K,srs({phone:{lastReviewedAt:'2000-01-01'}}));await converge(a,b);
 assert.deepEqual(Object.keys(a.read(K).cards).sort(),['pc','phone']);assert.deepEqual(a.read(K),b.read(K));
 const before=c.calls.filter(x=>x.type==='push').length;await converge(a,b);assert.equal(c.calls.filter(x=>x.type==='push').length,before);
});
test('actual engine: undo/reset removes schedule and admission on both devices',async()=>{
 const c=cloud(),a=device(c),b=device(c);a.put(K,srs({one:{reps:1}}));await a.init();await b.init();a.put(K,srs());await converge(a,b);
 assert.deepEqual(a.read(K).cards,{});assert.deepEqual(b.read(K).cards,{});assert.deepEqual(b.read(K).daily.admitted,[]);
});
test('actual engine: parallel stats add, then own-device undo decreases total',async()=>{
 const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'phone'});await a.init();await b.init();
 a.api.stats.recordStat({getItem:k=>a.mem.get(k)||null,setItem:(k,v)=>a.mem.set(k,v)},'333',{ratings:1},new Date('2026-10-08T12:00:00'));
 b.api.stats.recordStat({getItem:k=>b.mem.get(k)||null,setItem:(k,v)=>b.mem.set(k,v)},'333',{ratings:1},new Date('2026-10-08T12:00:00'));
 await converge(a,b);const key='yantu-stats-v1-333';assert.equal(b.read(key)['2026-10-08'].ratings,2);
 a.api.stats.reduceStat({getItem:k=>a.mem.get(k)||null,setItem:(k,v)=>a.mem.set(k,v)},'333',{ratings:1},'2026-10-08');await converge(a,b);assert.equal(b.read(key)['2026-10-08'].ratings,1);
});
test('actual engine: new exam date survives immediate pull and offline restart',async()=>{
 const c=cloud();c.put(E,{version:1,date:'2027-12-20'});const a=device(c);await a.init();a.put(E,{version:1,date:'2027-12-21'});await a.sync();assert.equal(a.read(E).date,'2027-12-21');
 a.flags.failPush=a.flags.failPull=true;a.put(E,{version:1,date:'2027-12-22'});const failed=await a.sync();assert.ok(failed.failed.length);assert.equal(a.api.getSyncStatus().state,'error');assert.ok(a.api.getSyncStatus().pendingUploads);assert.ok(JSON.parse(a.mem.get('yantu-sync-outbox-v1'))[E]);
 const restarted=device(c,{disk:a.mem,id:'same-restarted-device'});await restarted.init();const b=device(c);await b.init();assert.equal(b.read(E).date,'2027-12-22');
});
test('actual engine: crash between metadata and queue-index writes cannot lose a new key',async()=>{
 const c=cloud(),a=device(c);await a.init();a.flags.failPush=true;a.put(E,{version:1,date:'2028-12-20'});await a.sync();a.mem.set('yantu-sync-outbox-v1','{}');const restarted=device(c,{disk:a.mem});await restarted.init();const b=device(c);await b.init();assert.equal(b.read(E).date,'2028-12-20');
});
test('actual engine: account A → guest → empty B isolates all keys and queue',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(P,{version:1,seq:1,cards:[{id:'private-A',rev:1}],overlays:{}});a.put('kaoyan.mock-practice.v1.333',{private:'A'});a.flags.failPush=true;await a.sync();
 await a.api.syncSignOut();await a.api.syncSignIn('B','test');a.flags.failPush=false;await a.sync();assert.equal(a.read(P),null);assert.equal(a.read('kaoyan.mock-practice.v1.333'),null);assert.ok(![...c.rows.values()].some(row=>row.user_id==='B'&&JSON.stringify(row.value).includes('private-A')));
 await a.api.syncSignOut();await a.api.syncSignIn('A','test');await a.sync();assert.equal(a.read(P).cards[0].id,'private-A');
});
test('actual engine: first guest login imports drafts, then guest and account remain independent',async()=>{
 const c=cloud(),a=device(c,{uid:null});await a.init();a.put(E,{version:1,date:'2027-12-20'});await a.api.syncSignIn('A','test');await a.sync();assert.equal(a.read(E).date,'2027-12-20');a.put(E,{version:1,date:'2027-12-21'});await a.sync();await a.api.syncSignOut();assert.equal(a.read(E).date,'2027-12-20');await a.api.syncSignIn('B','test');await a.sync();assert.equal(a.read(E),null);
});
test('actual engine: authenticated reload restores the same partition',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(E,{version:1,date:'2028-12-20'});await a.sync();const restarted=device(c,{disk:a.mem});await restarted.init();assert.equal(restarted.read(E).date,'2028-12-20');
});
test('actual engine: upgrade keeps current live data instead of stale v2 partition snapshot',async()=>{
 const c=cloud(),a=device(c);a.put('yantu-partition-v1',{A:{[E]:JSON.stringify({version:1,date:'2027-12-20'})}});a.put(E,{version:1,date:'2027-12-21'});await a.init();assert.equal(a.read(E).date,'2027-12-21');
});
test('actual engine: quota failure is never reported as complete, then retries',async()=>{
 const c=cloud(),a=device(c);await a.init();c.put(E,{version:1,date:'2028-12-20'});a.flags.failWrite=true;const result=await a.sync();assert.ok(result.failed.includes(E));assert.ok(result.errors.length);assert.equal(a.api.getSyncStatus().state,'error');assert.equal(a.api.getSyncStatus().pendingApply,1);
 a.flags.failWrite=false;await a.sync();assert.equal(a.read(E).date,'2028-12-20');assert.equal(a.api.getSyncStatus().state,'online');assert.equal(a.api.getSyncStatus().pendingApply,0);
});
test('actual engine: unknown cloud key cannot overwrite config/device identity',async()=>{
 const c=cloud(),a=device(c,{id:'pc'});c.put('yantu-sync-config',{url:'https://wrong.test'});c.put('yantu-device-id','attacker');await a.init();assert.equal(a.read('yantu-sync-config').url,'https://test.supabase.co');assert.equal(a.mem.get('yantu-device-id'),'pc');
});
test('actual engine: invalid wire metadata is rejected without replacing local data',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(E,{version:1,date:'2028-12-20'});await a.sync();c.put(E,{protocol:'yantu-sync-v3',cells:{invalid:[{clock:{},value:'bad'}]}});const result=await a.sync();assert.ok(result.failed.includes(E));assert.equal(a.read(E).date,'2028-12-20');
});
test('actual engine: editor change while upload is pending remains queued',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(E,{version:1,date:'2028-12-20'});a.flags.holdPush=true;const job=a.sync();await settle();assert.equal(a.releases.length,1);
 a.put(E,{version:1,date:'2028-12-21'});a.flags.holdPush=false;a.releases.shift()();await job;assert.ok(a.api.getSyncStatus().pendingUploads);await a.sync();const b=device(c);await b.init();assert.equal(b.read(E).date,'2028-12-21');
});
test('actual engine: old account upload ACK cannot clear new account edits',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(E,{version:1,date:'2028-12-20'});a.flags.holdPush=true;const old=a.sync();await settle();
 await a.api.syncSignIn('B','test');a.put(E,{version:1,date:'2029-12-20'});a.flags.failPush=true;a.flags.holdPush=false;a.releases.shift()();await old;await a.sync();assert.equal(a.read(E).date,'2029-12-20');assert.ok(a.api.getSyncStatus().pendingUploads);
 a.flags.failPush=false;await a.sync();const b=device(c,{uid:'B'});await b.init();assert.equal(b.read(E).date,'2029-12-20');
});
test('actual engine: switching again before a queued runner starts cancels the old runner',async()=>{
 const c=cloud(),a=device(c);await a.init();c.calls.length=0;const one=a.api.syncSignIn('B','test'),two=a.api.syncSignIn('C','test');await Promise.all([one,two]);await a.sync();assert.ok(c.calls.every(call=>call.type!=='pull'||call.user==='C'));
});
test('actual engine: concurrent sync callers await the same job',async()=>{
 const c=cloud(),a=device(c);await a.init();a.put(E,{version:1,date:'2028-12-20'});a.flags.holdPush=true;const one=a.sync(),two=a.sync();assert.equal(one,two);await settle();a.flags.holdPush=false;a.releases.shift()();assert.deepEqual(await one,await two);
});
test('actual engine: same draft conflict preserves both texts and local navigation',async()=>{
 const c=cloud(),a=device(c),b=device(c);const initial={version:1,subject:'333',locations:{'333':{view:'cards'}},feynmanDrafts:{same:'base'},pastAnswers:{},plannerPrompts:{}};a.put(S,initial);b.put(S,initial);await a.init();await b.init();
 const x=a.read(S),y=b.read(S);x.feynmanDrafts.same='PC draft';y.feynmanDrafts.same='Phone draft';y.subject='825';y.locations={'825':{view:'stats'}};a.put(S,x);b.put(S,y);await converge(a,b);
 assert.equal(a.read(S).subject,'333');assert.equal(b.read(S).subject,'825');assert.equal(a.read(S).feynmanDrafts.same,b.read(S).feynmanDrafts.same);assert.match(b.read(S).feynmanDrafts.same,/PC draft/);assert.match(b.read(S).feynmanDrafts.same,/Phone draft/);
 const cleaned=b.read(S);cleaned.feynmanDrafts.same='resolved';b.put(S,cleaned);await converge(a,b);assert.equal(a.read(S).feynmanDrafts.same,'resolved');
});
test('actual engine: personal concurrent fields/text/rich formatting converge without revision loop',async()=>{
 const c=cloud(),a=device(c),b=device(c);a.put(P,{version:1,seq:1,cards:[],overlays:{one:{rev:1,note:{text:'base',runs:[]},bg:'#ffffff',updatedAt:'base'}}});await a.init();await b.init();
 const x=a.read(P),y=b.read(P);x.overlays.one={...x.overlays.one,rev:2,note:{text:'Alpha',runs:[{start:0,end:5,kind:'b'}]},updatedAt:'PC'};y.overlays.one={...y.overlays.one,rev:2,note:{text:'Beta',runs:[{start:0,end:4,kind:'u'}]},bg:'#ffffaa',updatedAt:'Phone'};a.put(P,x);b.put(P,y);await converge(a,b);
 assert.deepEqual(a.read(P),b.read(P));const merged=b.read(P).overlays.one;assert.match(merged.note.text,/Alpha/);assert.match(merged.note.text,/Beta/);assert.equal(merged.bg,'#ffffaa');for(const run of merged.note.runs)assert.ok(run.end<=merged.note.text.length);
 const before=c.calls.filter(x=>x.type==='push').length;await converge(a,b);assert.equal(c.calls.filter(x=>x.type==='push').length,before);assert.equal(b.read(P).overlays.one.rev,2);
});
test('actual engine: chapter cancellation beats legacy true and collection removal stays removed',async()=>{
 const c=cloud();c.put('yantu-done',{chapter:true});const a=device(c),b=device(c);await a.init();await b.init();a.put('yantu-done',{marks:{chapter:false},touch:{}});await converge(a,b);assert.equal(b.read('yantu-done').marks.chapter,false);
 a.put('yantu-mcq-excluded-v1',['one']);await converge(a,b);a.put('yantu-mcq-excluded-v1',[]);await converge(a,b);assert.deepEqual(b.read('yantu-mcq-excluded-v1'),[]);
});
test('actual engine: mistakes can return after deletion and another wrong answer',async()=>{
 const c=cloud(),a=device(c),b=device(c);await a.init();await b.init();a.api.mistakes.recordMistake('333','card','one','one');await converge(a,b);a.api.mistakes.removeMistake('333:card:one');await converge(a,b);assert.equal(b.api.mistakes.readVisibleMistakes().length,0);
 a.api.mistakes.recordMistake('333','card','one','one');await converge(a,b);assert.equal(b.api.mistakes.readVisibleMistakes().length,1);
});

test('actual engine: simultaneous overwriting server writes are later reconciled',async()=>{
 const c=cloud(),a=device(c),b=device(c);await a.init();await b.init();a.put(K,srs({pc:{reps:1}}));b.put(K,srs({phone:{reps:1}}));a.flags.holdPush=b.flags.holdPush=true;
 const aj=a.sync(),bj=b.sync();await settle();assert.equal(a.releases.length,1);assert.equal(b.releases.length,1);a.flags.holdPush=b.flags.holdPush=false;a.releases.shift()();b.releases.shift()();await Promise.all([aj,bj]);await converge(a,b);
 assert.deepEqual(Object.keys(a.read(K).cards).sort(),['pc','phone']);assert.deepEqual(a.read(K),b.read(K));
});
test('actual engine: new-card limit and scope removals propagate without rollback',async()=>{
 const c=cloud(),a=device(c),b=device(c);const initial=srs();initial.scopes=initial.newScopes=[{bookId:'one',chapters:[1]}];a.put(K,initial);await a.init();await b.init();const changed=a.read(K);changed.dailyNewLimit=1;changed.scopes=[];changed.newScopes=[];a.put(K,changed);await converge(a,b);assert.equal(b.read(K).dailyNewLimit,1);assert.deepEqual(b.read(K).scopes,[]);assert.deepEqual(b.read(K).newScopes,[]);
});
test('actual engine: different-day admissions do not leak into the current day',async()=>{
 const c=cloud(),a=device(c),b=device(c);a.put(K,srs({old:{reps:1}}));await a.init();await b.init();const next=a.read(K);next.daily={date:'2026-10-09',admitted:['new']};a.put(K,next);await converge(a,b);assert.deepEqual(b.read(K).daily,{date:'2026-10-09',admitted:['new']});
});
test('actual engine: corrupt JSON is quarantined and recovered from cloud',async()=>{
 const c=cloud();c.put(E,{version:1,date:'2027-12-20'});const a=device(c);a.mem.set(E,'invalid-json');await a.init();assert.equal(a.read(E).date,'2027-12-20');assert.equal(a.mem.get('yantu-sync-quarantine-v1:'+E),'invalid-json');
});
test('actual engine: oversized draft conflict remains readable and originals exportable',async()=>{
 const c=cloud(),a=device(c),b=device(c);const session={version:1,subject:'333',locations:{},feynmanDrafts:{same:'base'},pastAnswers:{},plannerPrompts:{}};a.put(S,session);await a.init();await b.init();const x=a.read(S),y=b.read(S);x.feynmanDrafts.same='A'.repeat(150000);y.feynmanDrafts.same='B'.repeat(150000);a.put(S,x);b.put(S,y);await converge(a,b);assert.ok(b.read(S).feynmanDrafts.same.length<=200000);const conflicts=copy(b.api.getSyncConflicts());assert.equal(Object.values(conflicts[S])[0].length,2);
});
test('actual engine: mock answers on different questions merge, cursor stays local',async()=>{
 const c=cloud(),a=device(c),b=device(c),key='kaoyan.mock-practice.v1.333';
 a.put(key,{version:1,subject:'333',settings:{counts:{}},session:{snapshot:{createdAt:'2026-10-08'},result:{questions:[{id:'q1'},{id:'q2'}]},mode:'practice',cursor:0,responses:{}}});await a.init();await b.init();
 const x=a.read(key),y=b.read(key);x.session.responses.q1={text:'PC answer'};y.session.responses.q2={text:'Phone answer'};y.session.cursor=1;a.put(key,x);b.put(key,y);await converge(a,b);
 assert.deepEqual(a.read(key).session.responses,b.read(key).session.responses);assert.equal(a.read(key).session.responses.q1.text,'PC answer');assert.equal(b.read(key).session.responses.q2.text,'Phone answer');assert.equal(a.read(key).session.cursor,0);assert.equal(b.read(key).session.cursor,1);
});
test('actual engine: bounded activity view also bounds persisted version metadata',async()=>{
 const c=cloud(),a=device(c),key='yantu-activity-v1-333';await a.init();
 for(let block=0;block<8;block++){const events=Array.from({length:50},(_,i)=>({t:new Date(1700000000000+(block*50+i)*1000).toISOString(),kind:'rating',label:'card '+(block*50+i)}));a.put(key,[...(a.read(key)||[]),...events].slice(-300));await a.sync();}
 const row=[...c.rows.values()].find(r=>r.key.startsWith('yantu-sync-v3:'+encodeURIComponent(key)+':'));assert.equal(Object.keys(row.value.cells).length,300);
});
test('actual engine: acknowledged parallel writes survive sender closing before next sync',async()=>{
 const c=cloud(),a=device(c,{id:'pc'}),b=device(c,{id:'android'});await a.init();await b.init();a.put(K,srs({pc:{reps:1}}));b.put(K,srs({phone:{reps:1}}));a.flags.holdPush=b.flags.holdPush=true;const aj=a.sync(),bj=b.sync();await settle();a.flags.holdPush=b.flags.holdPush=false;a.releases.shift()();b.releases.shift()();await Promise.all([aj,bj]);
 // Never run A again: only the still-open phone can fetch the acknowledged PC row.
 await b.sync();assert.deepEqual(Object.keys(b.read(K).cards).sort(),['pc','phone']);assert.equal(c.rows.size,2);
});
test('actual engine: realtime uses changed rows, and polling does not pull every 5 seconds',async()=>{
 const c=cloud(),a=device(c),b=device(c);await a.init();await b.init();a.put(E,{version:1,date:'2028-12-20'});await a.sync();const row=[...c.rows.values()].find(r=>r.key.startsWith('yantu-sync-v3:'+encodeURIComponent(E)+':'));const before=c.calls.filter(call=>call.type==='pull').length;
 b.channels[0]({new:copy(row)});await settle();assert.equal(b.read(E).date,'2028-12-20');assert.equal(c.calls.filter(call=>call.type==='pull').length,before);
 b.intervals[0]();await settle();b.intervals[0]();await settle();assert.equal(c.calls.filter(call=>call.type==='pull').length,before);b.intervals[0]();await settle();assert.ok(c.calls.filter(call=>call.type==='pull').length>before);
});
