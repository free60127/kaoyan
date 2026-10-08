import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../lib/card-edit-draft.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const rich=(text,runs=[])=>({text,runs});
const fields=(note='')=>({q:rich('question'),a:rich('answer'),note:rich(note),bg:undefined});
const draft=(note)=>({fields:fields(note),baselineRev:3,baselineFields:fields(),location:{book:'linguistics',chapter:7,section:'Deixis'}});

test('editor: nested v2 draft survives JSON roundtrip, including formatting and baseline',()=>{
 const saved=draft('my draft');saved.fields.a.runs=[{start:1,end:5,kind:'b'}];
 const loaded=api.parseCardEditDraft(JSON.parse(JSON.stringify(saved)));
 assert.deepEqual(loaded.fields,saved.fields);assert.equal(loaded.baselineRev,3);assert.deepEqual(loaded.baselineFields,saved.baselineFields);assert.deepEqual(loaded.location,saved.location);
});
test('editor: flat legacy draft remains readable; invalid styles are removed',()=>{
 const saved={...fields(),baselineRev:null};saved.q.runs=[{start:-10,end:999,kind:'u'},{start:0,end:3,kind:'html'}];
 const loaded=api.parseCardEditDraft(saved);assert.equal(loaded.fields.a.text,'answer');assert.deepEqual(loaded.fields.q.runs,[{start:0,end:8,kind:'u'}]);assert.equal(loaded.baselineRev,null);
 assert.equal(api.parseCardEditDraft({unrelated:true}),null);assert.equal(api.parseCardEditDraft(null),null);
});
test('editor: separate tabs recover their own draft after the other tab saves',()=>{
 let map={};map=api.updateOwnedDraft(map,'825:t:one','pc',draft('pc note'));map=api.updateOwnedDraft(map,'825:t:one','phone',draft('phone note'));
 map=api.updateOwnedDraft(map,'825:t:one','pc',null);assert.equal(api.readOwnedDraft(map,'825:t:one','phone').fields.note.text,'phone note');assert.equal(map['825:t:one'].fields.note.text,'phone note');
});
test('editor: new tab can recover shared old draft while successful save clears only its copy',()=>{
 let map={'825:t:one':draft('legacy')};assert.equal(api.readOwnedDraft(map,'825:t:one','new').fields.note.text,'legacy');
 map=api.updateOwnedDraft(map,'825:t:one','new',draft('new'));map=api.updateOwnedDraft(map,'825:t:one','new',null);assert.equal(api.readOwnedDraft(map,'825:t:one','new'),null);
});
test('editor: unchanged legacy draft can be discarded without erasing a later tab draft',()=>{
 const old=draft('old');let map={'825:t:one':old};map=api.updateOwnedDraft(map,'825:t:one','new',null,api.parseCardEditDraft(old));assert.equal(map['825:t:one'],undefined);
 map={'825:t:one':draft('other tab')};map=api.updateOwnedDraft(map,'825:t:one','new',null,old);assert.equal(map['825:t:one'].fields.note.text,'other tab');
});
test('editor: rebase combines separate field changes without duplicating unchanged textbook text',()=>{
 const base=fields(),mine=fields('my example'),latest=fields();latest.a=rich('updated answer');latest.bg='#e8f1ff';
 const merged=api.mergeEditFields(mine,latest,base);assert.equal(merged.a.text,'updated answer');assert.equal(merged.q.text,'question');assert.equal(merged.note.text,'my example');assert.equal(merged.bg,'#e8f1ff');
});
test('editor: conflicting text retains both versions and moves corresponding style offsets',()=>{
 const mine=rich('我的例子🙂',[{start:0,end:4,kind:'b'}]),latest=rich('new explanation',[{start:4,end:15,kind:'u'}]);
 const merged=api.mergeEditField(mine,latest,rich('base'));assert.ok(merged.text.includes(mine.text)&&merged.text.includes(latest.text));
 const underline=merged.runs.find(run=>run.kind==='u');assert.equal(merged.text.slice(underline.start,underline.end),'explanation');assert.deepEqual(merged.runs[0],mine.runs[0]);
});
test('editor: same text changed styles retain both, identical runs do not accumulate',()=>{
 const b={start:0,end:3,kind:'b'},u={start:2,end:6,kind:'u'};const merged=api.mergeEditField(rich('answer',[b]),rich('answer',[b,u]));assert.deepEqual(merged.runs,[b,u]);assert.equal(merged.text,'answer');
});
test('editor: explicit deletion of an unchanged remote field remains a deletion',()=>{
 const base=fields('old note'),mine=fields(),latest=fields('old note');assert.equal(api.mergeEditFields(mine,latest,base).note.text,'');
 const remoteDeleted=fields(),mineUnchanged=fields('old note');assert.equal(api.mergeEditFields(mineUnchanged,remoteDeleted,base).note.text,'');
});
