import {readFile,writeFile} from 'node:fs/promises';
const read=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
const inline=source=>source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
const [css,history,writes,money,model,statements,finance,demo,app]=await Promise.all(['public/style.css','public/history.mjs','public/writes.mjs','public/money-client.mjs','public/client-model.mjs','public/statements.mjs','src/finance.mjs','preview/demo.mjs','public/app.js'].map(read));
const script=(`(()=>{${inline(finance)}\n${inline(demo)}\n})();\n${inline(history)}\n${inline(writes)}\n${inline(money)}\n${inline(model)}\n${inline(statements)}\n${inline(app)}`).replace(/<\/script/gi,'<\\/script');
const html=`<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>محفظتي — معاينة تفاعلية دون حفظ</title><style>${css}</style></head><body><div id="app"></div><div id="modal" class="modal-root" hidden></div><div id="toast" role="status" aria-live="polite"></div><script>${script}</script></body></html>`;
await writeFile(new URL('../معاينة_تفاعلية.html',import.meta.url),html);
console.log('Updated معاينة_تفاعلية.html from current sources (preview fixtures are not deployed).');
