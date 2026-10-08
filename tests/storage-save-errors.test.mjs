import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
const compiled=await build({entryPoints:[fileURLToPath(new URL('../lib/storage-save-errors.ts',import.meta.url))],bundle:true,write:false,platform:'node',format:'esm'});
const {acknowledgeStorageSave}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
test('unrelated successful writes and generic activity events cannot hide timing failure',()=>{
 const errors={'card-timing':true,stats:true};
 assert.deepEqual(acknowledgeStorageSave(errors,'stats',true),{'card-timing':true});
 assert.deepEqual(acknowledgeStorageSave(errors,undefined,true),errors);
 assert.deepEqual(acknowledgeStorageSave(errors,'card-timing',true),errors);
 assert.deepEqual(acknowledgeStorageSave(errors,'card-timing',false),{stats:true});
 assert.deepEqual(errors,{'card-timing':true,stats:true});
});
