import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'vite';

const configFile=fileURLToPath(new URL('../vite.config.mjs',import.meta.url));
const compile=async(mode,options={})=>{
  const result=await build({configFile,mode,logLevel:'silent',build:{write:false,emptyOutDir:false,...options}});
  return (Array.isArray(result)?result:[result]).flatMap(bundle=>bundle.output);
};

test('Production React build excludes demo fixtures and legacy public entry points',async()=>{
  const output=await compile('production');
  const scripts=output.filter(file=>file.type==='chunk');
  assert.ok(scripts.length>0);
  assert.ok(output.some(file=>file.fileName==='index.html'));
  for(const script of scripts){
    assert.doesNotMatch(script.code,/preview@example\.com|DEMO-RENT|عمارة النخيل/);
    assert.doesNotMatch(script.code,/__PREVIEW__/);
  }
  assert.ok(!output.some(file=>['app.js','style.css','demo.mjs'].includes(file.fileName)));
});

test('Preview React build includes fixtures in one compiled module with inlined font assets',async()=>{
  const output=await compile('preview',{assetsInlineLimit:Infinity,cssCodeSplit:false,rolldownOptions:{output:{codeSplitting:false}}});
  const scripts=output.filter(file=>file.type==='chunk');
  assert.equal(scripts.length,1);
  assert.match(scripts[0].code,/preview@example\.com/);
  assert.equal(scripts[0].imports.length,0);
  // Rolldown retains the inlined module's self-reference in metadata.
  assert.ok(scripts[0].dynamicImports.every(file=>file===scripts[0].fileName));
  assert.doesNotMatch(scripts[0].code,/\bimport\s*\(/);
  execFileSync(process.execPath,['--check','--input-type=module'],{input:scripts[0].code,stdio:['pipe','pipe','pipe']});
  const styles=output.filter(file=>file.type==='asset'&&file.fileName.endsWith('.css'));
  assert.equal(styles.length,1);
  assert.match(String(styles[0].source),/data:font\/woff2;base64,/);
});
