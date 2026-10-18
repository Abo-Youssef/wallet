import {readFile,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {connectDatabase} from '../src/server/postgres.mjs';
import {importIntoEmptyDatabase} from '../src/server/restore.mjs';
import {nativeConnection,safeDatabaseError} from './postgres-backup.mjs';

export async function importPostgresBackup({input,connectionString=process.env.DATABASE_URL}={}){
  if(typeof input!=='string'||!input.trim())throw new Error('--input must name a wallet JSON backup');
  const source=resolve(input),connection=nativeConnection(connectionString);
  if(!(await stat(source)).isFile())throw new Error('Backup input must be a regular file');
  let backup;
  try{backup=JSON.parse((await readFile(source,'utf8')).replace(/^\uFEFF/,''))}
  catch{throw new Error('The input could not be read as JSON; the database was not changed')}
  // This offline route intentionally has no browser-size cap. JSON parsing and
  // validation still hold the file in memory; native dumps stream large data.
  const db=await connectDatabase({DATABASE_URL:connection.connectionString});
  try{
    return await db.transaction(async()=>{
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('wallet-schema-migrations',0))");
      const result=await importIntoEmptyDatabase(db,backup);
      return {...result,input:source,imported_at:new Date().toISOString(),
        next:'Keep the new database isolated until row counts, balances, and application access have been verified.'};
    });
  }finally{await db.close()}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),usage='Usage: node --env-file=.env scripts/import-postgres-backup.mjs --input FILE.json\nDATABASE_URL must select a NEW EMPTY database with PostgreSQL migrations already applied.\nNo browser-size cap applies; the JSON file and validation data must fit in available Node.js memory.';
  if(args.length===1&&args[0]==='--help')console.log(usage);
  else if(args.length!==2||args[0]!=='--input'||!args[1]){console.error(usage);process.exitCode=2}
  else try{console.log(JSON.stringify(await importPostgresBackup({input:args[1]}),null,2))}
  catch(error){console.error(JSON.stringify({ok:false,error:safeDatabaseError(error)},null,2));process.exitCode=1}
}
