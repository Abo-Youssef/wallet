import {spawn} from 'node:child_process';
import {constants,createReadStream} from 'node:fs';
import {access,open,link,lstat,unlink,copyFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {connectDatabase} from '../src/server/postgres.mjs';

const LOCK_NAME='wallet-schema-migrations';
const LOCAL_HOSTS=new Set(['localhost','127.0.0.1','::1']);
const TLS_MODES=new Set(['require','verify-ca','verify-full']);

export function nativeConnection(connectionString=process.env.DATABASE_URL,baseEnv=process.env){
  if(typeof connectionString!=='string'||!connectionString.trim())throw new Error('DATABASE_URL is required in the ignored .env file');
  let url;
  try{url=new URL(connectionString)}catch{throw new Error('DATABASE_URL must be a PostgreSQL URL')}
  if(!['postgres:','postgresql:'].includes(url.protocol)||url.hash)throw new Error('Unsupported DATABASE_URL format');
  const host=url.hostname.replace(/^\[|\]$/g,''),local=LOCAL_HOSTS.has(host.toLowerCase());
  let user,password,database;
  try{user=decodeURIComponent(url.username);password=decodeURIComponent(url.password);database=decodeURIComponent(url.pathname.slice(1))}
  catch{throw new Error('DATABASE_URL contains invalid percent encoding')}
  if(!host||!user||!database||[host,user,password,database].some(value=>value.includes('\0')))throw new Error('DATABASE_URL requires a host, username, and database name');
  if(host.includes('-pooler.'))throw new Error('Use a direct, unpooled PostgreSQL connection for backup and restore');
  const allowed=new Map([
    ['sslmode','PGSSLMODE'],['channel_binding','PGCHANNELBINDING'],['sslrootcert','PGSSLROOTCERT'],
    ['sslcert','PGSSLCERT'],['sslkey','PGSSLKEY'],['connect_timeout','PGCONNECT_TIMEOUT'],
  ]);
  for(const key of url.searchParams.keys())if(!allowed.has(key))throw new Error(`Unsupported database URL option: ${key}`);
  const mode=url.searchParams.get('sslmode')||(local?'disable':'require');
  if(!TLS_MODES.has(mode)&&!(local&&['disable','prefer','allow'].includes(mode)))throw new Error('Remote PostgreSQL backup connections must require TLS');
  url.searchParams.set('sslmode',mode);
  // Explicit PG* values prevent inherited service/host/options from selecting a
  // different database. Credentials are passed only to the child environment.
  const env=Object.fromEntries(Object.entries(baseEnv).filter(([key])=>!/^PG/i.test(key)&&key!=='DATABASE_URL'));
  Object.assign(env,{PGHOST:host,PGPORT:url.port||'5432',PGUSER:user,PGPASSWORD:password,
    PGDATABASE:database,PGSSLMODE:mode,PGCONNECT_TIMEOUT:'15',PGAPPNAME:'wallet-maintenance'});
  for(const [key,value] of url.searchParams)env[allowed.get(key)]=value;
  return {env,connectionString:url.href,database,password};
}

export function safeDatabaseError(error,connectionString=process.env.DATABASE_URL){
  let message=String(error?.message??error??'Unknown failure');
  if(connectionString){
    message=message.split(connectionString).join('[database connection redacted]');
    try{
      const url=new URL(connectionString);
      for(const secret of [url.password,decodeURIComponent(url.password)].filter(Boolean))message=message.split(secret).join('[redacted]');
    }catch{}
  }
  return message.replace(/postgres(?:ql)?:\/\/[^\s"']+/gi,'[database connection redacted]');
}

async function nativeBinary(name,env=process.env){
  const file=process.platform==='win32'?`${name}.exe`:name;
  if(env.PG_BIN){
    const explicit=join(resolve(env.PG_BIN),file);
    try{await access(explicit,constants.X_OK);return explicit}
    catch{throw new Error(`PG_BIN does not contain an executable ${file}`)}
  }
  if(process.platform==='win32'){
    const standard=join(env.ProgramFiles||'C:\\Program Files','PostgreSQL','18','bin',file);
    try{await access(standard,constants.X_OK);return standard}catch{}
  }
  return file;
}

async function runNative(binary,args,{env,stdout='ignore',connectionString}){
  await new Promise((resolvePromise,reject)=>{
    const child=spawn(binary,args,{env,windowsHide:true,shell:false,stdio:['ignore',stdout,'pipe']});
    let stderr='',signalReceived=null;
    const onSignal=signal=>{signalReceived=signal;child.kill(signal)};
    const onInterrupt=()=>onSignal('SIGINT'),onTerminate=()=>onSignal('SIGTERM');
    const cleanup=()=>{process.off('SIGINT',onInterrupt);process.off('SIGTERM',onTerminate)};
    process.once('SIGINT',onInterrupt);process.once('SIGTERM',onTerminate);
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192)});
    child.once('error',error=>{
      cleanup();reject(new Error(error.code==='ENOENT'?'PostgreSQL command-line tools were not found. Set PG_BIN to their bin directory.':safeDatabaseError(error,connectionString)));
    });
    child.once('close',(code,signal)=>{
      cleanup();
      if(code===0&&!signalReceived)return resolvePromise();
      const detail=safeDatabaseError(stderr.trim(),connectionString);
      reject(new Error(`PostgreSQL tool failed (${signalReceived||signal||code}).${detail?' '+detail:''}`));
    });
  });
}

async function requireWallet(db){
  const result=await db.query("SELECT to_regclass('public.restore_control') IS NOT NULL AND to_regclass('public.wallet_schema_migrations') IS NOT NULL AS ready");
  if(!result.rows[0]?.ready)throw new Error('The selected database is not a migrated wallet database');
}

async function requireEmpty(db){
  const result=await db.query(`SELECT n.nspname,c.relname FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_'
      AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`);
  if(result.rowCount)throw new Error('Restore requires a NEW EMPTY database without user tables, views, or sequences; no data was changed');
  const functions=await db.query(`SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND left(p.proname,7)='wallet_' LIMIT 1`);
  if(functions.rowCount)throw new Error('Restore target already contains wallet functions; use a new empty database');
}

async function sha256(file){
  const hash=createHash('sha256');
  for await(const chunk of createReadStream(file))hash.update(chunk);
  return hash.digest('hex');
}

export async function backupPostgres({output,connectionString=process.env.DATABASE_URL}={}){
  if(typeof output!=='string'||!output.trim())throw new Error('--output must name a NEW backup file');
  const target=resolve(output),temporary=join(dirname(target),`.${basename(target)}.${randomUUID()}.tmp`);
  try{await lstat(target);throw new Error('Output already exists; choose a new filename')}
  catch(error){if(error.code!=='ENOENT')throw error}
  const connection=nativeConnection(connectionString),binary=await nativeBinary('pg_dump');
  const db=await connectDatabase({DATABASE_URL:connection.connectionString});
  try{await requireWallet(db)}finally{await db.close()}
  let file;
  try{
    file=await open(temporary,'wx',0o600);
    await runNative(binary,['--format=custom','--no-owner','--no-acl','--no-password'],
      {...connection,stdout:file.fd});
    await file.sync();
    const bytes=(await file.stat()).size;
    await file.close();file=null;
    const digest=await sha256(temporary);
    // rename() may overwrite an existing target. Prefer an atomic hard link;
    // some sandboxes/filesystems forbid links. COPYFILE_EXCL is a disk-based
    // fallback that never overwrites an existing file, but is NOT atomic:
    // the destination may be visible while copying. Node attempts to remove
    // its newly opened destination on copy failure. Never unlink target here,
    // since EEXIST may mean it belongs to someone else. Only ok:true declares
    // a completed backup; a crash during the fallback may leave a partial file.
    let publication='atomic-hard-link';
    try{await link(temporary,target)}
    catch(error){
      if(!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV','ENOSYS'].includes(error.code))throw error;
      await copyFile(temporary,target,constants.COPYFILE_EXCL);
      publication='exclusive-copy';
    }
    return {ok:true,format:'postgresql-custom',output:target,bytes,sha256:digest,publication,exported_at:new Date().toISOString()};
  }finally{
    if(file)await file.close().catch(()=>{});
    await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error});
  }
}

export async function restorePostgres({input,connectionString=process.env.DATABASE_URL}={}){
  if(typeof input!=='string'||!input.trim())throw new Error('--input must name a PostgreSQL custom-format backup');
  const source=resolve(input),file=await open(source,'r');
  try{
    if(!(await file.stat()).isFile())throw new Error('Backup input must be a regular file');
    const header=Buffer.alloc(5),result=await file.read(header,0,5,0);
    if(result.bytesRead!==5||header.toString('ascii')!=='PGDMP')throw new Error('Expected a pg_dump custom-format archive. Use backup:import for a wallet JSON file');
  }finally{await file.close()}
  const connection=nativeConnection(connectionString),binary=await nativeBinary('pg_restore');
  const db=await connectDatabase({DATABASE_URL:connection.connectionString});
  let locked=false,restored=false;
  try{
    locked=(await db.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[LOCK_NAME])).rows[0].locked;
    if(!locked)throw new Error('Another migration or restore is using the selected database');
    await requireEmpty(db);
    // --dbname is required for pg_restore to restore instead of printing SQL.
    // It contains only the escaped database NAME; all credentials stay in env.
    const databaseArgument="dbname='"+connection.database.replaceAll('\\','\\\\').replaceAll("'","\\'")+"'";
    await runNative(binary,['--single-transaction','--exit-on-error','--no-owner','--no-acl','--no-password',
      '--dbname',databaseArgument,'--',source],connection);
    restored=true;
    await requireWallet(db);
    const generation=randomUUID(),at=new Date().toISOString();
    const updated=await db.transaction(async()=>db.query(`UPDATE public.restore_control SET generation=$1,revision=revision+1,
      last_request=NULL,last_actor=NULL,last_fingerprint=NULL,recovery_json=NULL,restored_at=$2 WHERE id=1 RETURNING generation`,[generation,at]));
    if(updated.rowCount!==1)throw new Error('The restored database has no valid restore control row');
    return {ok:true,input:source,restored_at:at,generation,checks:{target_was_empty:true,native_restore_committed:true,old_clients_invalidated:true},
      next:'Keep the target isolated until permissions, row counts, balances, and application access have been verified.'};
  }catch(error){
    if(restored)throw new Error('The archive was restored into the isolated target, but finalization failed. Do not connect the application; use a new target after resolving: '+safeDatabaseError(error,connectionString));
    throw error;
  }finally{
    if(locked)await db.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[LOCK_NAME]).catch(()=>{});
    await db.close();
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),usage='Usage: node --env-file=.env scripts/postgres-backup.mjs backup --output NEW_FILE.dump\n       node --env-file=.env scripts/postgres-backup.mjs restore --input FILE.dump\nRestore accepts only a new empty database selected by DATABASE_URL. Set PG_BIN if PostgreSQL tools are not in PATH.';
  if(args.includes('--help'))console.log(usage);
  else if(args.length!==3||!['backup','restore'].includes(args[0])||args[1]!==`--${args[0]==='backup'?'output':'input'}`||!args[2]){
    console.error(usage);process.exitCode=2;
  }else try{
    const result=await(args[0]==='backup'?backupPostgres({output:args[2]}):restorePostgres({input:args[2]}));
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(JSON.stringify({ok:false,error:safeDatabaseError(error)},null,2));process.exitCode=1}
}
