import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {connectDatabase} from '../src/server/postgres.mjs';

export async function migratePostgres({connectionString=process.env.DATABASE_URL,log=console.log}={}){
  if(!connectionString)throw new Error('DATABASE_URL is required. Use node --env-file=.env scripts/migrate-postgres.mjs');
  const directory=new URL('../database/postgres/',import.meta.url);
  const names=(await readdir(directory)).filter(name=>/^\d[\w.-]*\.sql$/.test(name)).sort();
  if(!names.length)throw new Error('No PostgreSQL migration files were found');
  const migrations=await Promise.all(names.map(async name=>{
    const sql=await readFile(new URL(name,directory),'utf8');
    return {name,sql,checksum:createHash('sha256').update(sql).digest('hex')};
  }));
  const db=await connectDatabase({DATABASE_URL:connectionString});
  try{
    const applied=await db.transaction(async tx=>{
      // Serializes concurrent deploys on this database, including initial setup.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('wallet-schema-migrations',0))");
      await tx.query(`CREATE TABLE IF NOT EXISTS wallet_schema_migrations (
        name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
      const previous=(await tx.query('SELECT name,checksum FROM wallet_schema_migrations ORDER BY name')).rows;
      const installed=new Map(previous.map(row=>[row.name,row.checksum]));
      for(const row of previous){
        const source=migrations.find(migration=>migration.name===row.name);
        if(!source)throw new Error(`Applied migration is missing from source: ${row.name}`);
        if(source.checksum!==row.checksum)throw new Error(`Applied migration checksum changed: ${row.name}`);
      }
      const pending=migrations.filter(migration=>!installed.has(migration.name));
      const latest=previous.at(-1)?.name;
      if(latest&&pending.some(migration=>migration.name<latest))throw new Error('New migration names must sort after all applied migrations');
      for(const migration of pending){
        await tx.query(migration.sql);
        await tx.query('INSERT INTO wallet_schema_migrations(name,checksum) VALUES ($1,$2)',[migration.name,migration.checksum]);
      }
      return pending.map(migration=>migration.name);
    });
    for(const name of applied)log(`Applied ${name}`);
    log(applied.length?`PostgreSQL migrations committed (${applied.length}).`:'PostgreSQL schema is already up to date.');
    return applied;
  }finally{await db.close()}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.includes('--help')){
    console.log('Usage: node --env-file=.env scripts/migrate-postgres.mjs\nApplies database/postgres/*.sql atomically using DATABASE_URL. Existing migration checksums are verified.');
  }else{
    try{await migratePostgres()}
    catch(error){console.error(`PostgreSQL migration failed: ${error.code??'error'} ${error.message}`);process.exitCode=1}
  }
}
