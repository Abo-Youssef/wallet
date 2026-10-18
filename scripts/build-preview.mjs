import {build} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute} from 'node:path';

const outputRoot=fileURLToPath(new URL('../preview-dist/',import.meta.url));
await build({
  configFile:fileURLToPath(new URL('../vite.config.mjs',import.meta.url)),
  mode:'preview',
  base:'./',
  build:{
    outDir:outputRoot,
    emptyOutDir:true,
    assetsInlineLimit:Infinity,
    cssCodeSplit:false,
    rolldownOptions:{output:{codeSplitting:false}}
  }
});

// Inline only Vite's compiled output. Preview fixtures stay behind __PREVIEW__
// and the production build has no preview data or local role-switch route.
const readAsset=async asset=>{
  const absolute=resolve(outputRoot,asset),part=relative(outputRoot,absolute);
  if(part.startsWith('..')||isAbsolute(part))throw new Error('Preview asset escaped its output directory');
  return readFile(absolute,'utf8');
};
let html=await readFile(resolve(outputRoot,'index.html'),'utf8');
const scriptTags=[...html.matchAll(/<script\b[^>]*\bsrc="([^"\n]+)"[^>]*><\/script>/g)];
for(const [tag,asset] of scriptTags){
  const script=(await readAsset(asset)).replace(/<\/script/gi,'<\\/script');
  html=html.replace(tag,()=>`<script type="module">${script}</script>`);
}
const cssTags=[...html.matchAll(/<link\b(?=[^>]*\brel="stylesheet")[^>]*\bhref="([^"\n]+)"[^>]*>/g)];
for(const [tag,asset] of cssTags){
  const css=(await readAsset(asset)).replace(/<\/style/gi,'<\\/style');
  html=html.replace(tag,()=>`<style>${css}</style>`);
}
html=html.replace(/<link\b(?=[^>]*\brel="modulepreload")[^>]*>/g,'');
await writeFile(new URL('../معاينة_تفاعلية.html',import.meta.url),html);
console.log('Built the React preview in preview-dist/ and معاينة_تفاعلية.html. Production dist/ is unchanged.');
