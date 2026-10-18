import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {connectDatabase} from '../src/server/postgres.mjs';
import {migratePostgres} from '../scripts/migrate-postgres.mjs';

/** Each suite gets a new database. Never migrate/reset TEST_DATABASE_URL itself. */
export async function createPostgresFixture({migrate=true}={}){
  const source=process.env.TEST_DATABASE_URL;
  if(!source)throw new Error('TEST_DATABASE_URL is required for PostgreSQL integration tests (use an isolated test cluster with CREATE DATABASE permission)');
  const url=new URL(source);
  if(!['postgres:','postgresql:'].includes(url.protocol))throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL');
  const name='wallet_test_'+randomUUID().replaceAll('-','');
  const admin=await connectDatabase({DATABASE_URL:source});
  let db,created=false;
  const cleanup=async()=>{
    try{
      await db?.close();
      if(created){
        // The generated name is the only database this helper may remove.
        if(!/^wallet_test_[a-f0-9]{32}$/.test(name))throw new Error('Unexpected test database name');
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);created=false;
      }
    }finally{await admin.close()}
  };
  try{
    await admin.query(`CREATE DATABASE "${name}"`);created=true;
    url.pathname='/'+name;
    const connectionString=url.href;
    if(migrate)await migratePostgres({connectionString,log:()=>{}});
    db=await connectDatabase({DATABASE_URL:connectionString});
    return {
      db,connectionString,name,close:cleanup,
      one:(sql,...values)=>db.prepare(sql).bind(...values).first(),
      rows:async(sql,...values)=>(await db.prepare(sql).bind(...values).all()).results,
      run:(sql,...values)=>db.prepare(sql).bind(...values).run(),
      // Real requests use separate PostgreSQL connections. Hold the mutation
      // lock until all requests are waiting on it, then release together.
      // This replaces the old SQLite-only pre-batch interception.
      async race(makeRequests){
        const blocker=await connectDatabase({DATABASE_URL:connectionString});
        let requests;
        try{
          await blocker.transaction(async tx=>{
            await tx.query('SELECT id FROM restore_control WHERE id=1 FOR UPDATE');
            requests=makeRequests();
            // Attach rejection handlers while polling; the original promises
            // are still awaited below and their failures remain test failures.
            for(const request of requests)void request.catch(()=>{});
            const deadline=Date.now()+10_000;
            while(Date.now()<deadline){
              const {rows}=await admin.query("SELECT count(*) AS count FROM pg_stat_activity WHERE datname=$1 AND wait_event_type='Lock' AND query ILIKE '%restore_control%'",[name]);
              if(rows[0].count>=requests.length)return;
              await delay(10);
            }
            throw new Error('Concurrent requests did not reach the PostgreSQL mutation lock');
          });
          return await Promise.all(requests);
        }finally{
          await blocker.close();
          if(requests)await Promise.allSettled(requests);
        }
      },
    };
  }catch(error){await cleanup().catch(()=>{});throw error}
}
