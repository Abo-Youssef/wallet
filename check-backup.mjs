import {readFile} from 'node:fs/promises';
import {inspectBackup} from '../src/integrity.mjs';
const file=process.argv[2];
if(!file){console.error('Usage: npm run backup:check -- /path/to/mahfazati-backup.json');process.exitCode=2}
else try{
  const report=inspectBackup(JSON.parse(await readFile(file,'utf8')));
  console.log(JSON.stringify(report,null,2));if(!report.ok)process.exitCode=1;
}catch{console.error('تعذرت قراءة ملف JSON؛ لم تُعدّل أي بيانات.');process.exitCode=2}
