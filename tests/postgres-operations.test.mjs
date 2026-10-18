import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,basename,sep} from 'node:path';
import {createPostgresFixture} from './pg-fixture.mjs';
import {backupPostgres,restorePostgres} from '../scripts/postgres-backup.mjs';
import {importPostgresBackup} from '../scripts/import-postgres-backup.mjs';
import {migratePostgres} from '../scripts/migrate-postgres.mjs';
import {readBackupSnapshot,previewRestore,commitRestore} from '../src/server/restore.mjs';
import {connectDatabase} from '../src/server/postgres.mjs';
import {canonicalJSON} from '../src/server/backup.mjs';

test('PostgreSQL schema integrity SQL executes against the real engine',async()=>{
  const f=await createPostgresFixture();try{
    await f.db.query(await readFile(new URL('./postgres/schema.sql',import.meta.url),'utf8'));
    assert.equal((await f.one('SELECT count(*) n FROM entities')).n,0);
    assert.deepEqual(await migratePostgres({connectionString:f.connectionString,log:()=>{}}),[]);
  }finally{await f.close();}
});
test('Limited runtime role can write and restore, but cannot change schema or migration history',async()=>{
  const f=await createPostgresFixture();let runtime;
  try{
    if(!(await f.one("SELECT 1 FROM pg_roles WHERE rolname='wallet_app'")))await f.db.query('CREATE ROLE wallet_app LOGIN');
    await f.db.query(await readFile(new URL('../database/permissions.sql',import.meta.url),'utf8'));
    const url=new URL(f.connectionString);url.username='wallet_app';url.password='';
    runtime=await connectDatabase({DATABASE_URL:url.href});
    await runtime.query("INSERT INTO entities(id,kind,name,created_at,updated_at,created_by) VALUES ('role-check','property','اختبار', '2026-01-01','2026-01-01','test')");
    const {backup}=await readBackupSnapshot(runtime),preview=await previewRestore(runtime,backup);
    assert.equal(preview.ok,true);
    assert.equal((await commitRestore(runtime,{email:'test'},{backup,checkpoint:preview.checkpoint,confirmation:'استعادة',request_id:randomUUID()})).ok,true);
    await assert.rejects(runtime.query('CREATE TABLE forbidden(id INT)'),/permission denied/);
    await assert.rejects(runtime.query('DELETE FROM wallet_schema_migrations'),/permission denied/);
    await assert.rejects(runtime.query('DELETE FROM audit'),/immutable/);
    await assert.rejects(runtime.query('TRUNCATE entities CASCADE'),/permission denied/);
  }finally{await runtime?.close();await f.close();}
});
test('Native PostgreSQL dump/restore streams >1 MB, preserves rows, refuses overwrite and occupied target',async()=>{
  const source=await createPostgresFixture(),target=await createPostgresFixture({migrate:false}),jsonTarget=await createPostgresFixture();
  const folder=await mkdtemp(join(tmpdir(),'wallet-pg-backup-'));
  try{
    // High entropy makes the compressed dump itself exceed the old 1 MB cap.
    const records=Array.from({length:1500},(_,i)=>({id:randomUUID(),name:'أصل '+i,notes:randomBytes(1000).toString('base64')}));
    await source.db.query(`INSERT INTO entities(id,kind,name,notes,created_at,updated_at,created_by)
      SELECT id,'property',name,notes,'2026-01-01','2026-01-01','test' FROM jsonb_to_recordset($1::jsonb) AS t(id text,name text,notes text)`,[JSON.stringify(records)]);
    const original=(await source.rows('SELECT * FROM entities ORDER BY id'));
    const output=join(folder,'wallet.dump'),result=await backupPostgres({output,connectionString:source.connectionString});
    assert.ok(result.bytes>1_000_000,result.bytes);assert.match(result.sha256,/^[a-f0-9]{64}$/);
    await assert.rejects(backupPostgres({output,connectionString:source.connectionString}),/exists/);
    await assert.rejects(restorePostgres({input:output,connectionString:source.connectionString}),/EMPTY/);
    assert.equal((await restorePostgres({input:output,connectionString:target.connectionString})).ok,true);
    assert.equal(canonicalJSON(await target.rows('SELECT * FROM entities ORDER BY id')),canonicalJSON(original));
    assert.notEqual((await target.one('SELECT generation FROM restore_control')).generation,(await source.one('SELECT generation FROM restore_control')).generation);
    assert.deepEqual(await migratePostgres({connectionString:target.connectionString,log:()=>{}}),[]);
    const input=join(folder,'wallet.json'),{backup}=await readBackupSnapshot(source.db);await writeFile(input,JSON.stringify(backup));
    assert.equal((await importPostgresBackup({input,connectionString:jsonTarget.connectionString})).ok,true);
    assert.equal(canonicalJSON(await jsonTarget.rows('SELECT * FROM entities ORDER BY id')),canonicalJSON(original));
    await assert.rejects(importPostgresBackup({input,connectionString:jsonTarget.connectionString}),/فارغة/);
  }finally{
    await source.close();await target.close();await jsonTarget.close();
    if(!resolve(folder).startsWith(resolve(tmpdir())+sep)||!basename(folder).startsWith('wallet-pg-backup-'))throw new Error('Unexpected temporary test path');
    await rm(folder,{recursive:true,force:true});
  }
});
