import pg from 'pg';

const {Client,types}=pg;
const MAX_SAFE=BigInt(Number.MAX_SAFE_INTEGER);
export function parseSafeInt8(value){
  const number=BigInt(value);
  if(number>MAX_SAFE||number< -MAX_SAFE)throw new RangeError('PostgreSQL integer exceeds the safe JavaScript integer range');
  return Number(number);
}
// Keep money and counters numeric without silently losing precision. This is
// scoped to our client/queries, rather than changing pg's global parsers.
const parsers={getTypeParser(oid,format){return oid===20&&format!=='binary'?parseSafeInt8:types.getTypeParser(oid,format)}};

function scanSQL(sql){
  let text='',index=0,count=0,depth=0,nativeParameters=false;
  const tokens=[];
  while(index<sql.length){
    const start=index,char=sql[index];
    if(sql.startsWith('--',index)){
      const end=sql.indexOf('\n',index+2);index=end<0?sql.length:end;
    }else if(sql.startsWith('/*',index)){
      let comments=1;index+=2;
      while(index<sql.length&&comments){
        if(sql.startsWith('/*',index)){comments++;index+=2}
        else if(sql.startsWith('*/',index)){comments--;index+=2}
        else index++;
      }
      if(comments)throw new TypeError('Unterminated SQL comment');
    }else if(char==="'"||char==='"'){
      const escaped=char==="'"&&/[eE]/.test(sql[index-1]??'')&&!/[\w$]/.test(sql[index-2]??'');
      index++;let closed=false;
      while(index<sql.length){
        if(escaped&&sql[index]==='\\'){index+=2;continue}
        if(sql[index]===char){
          if(sql[index+1]===char){index+=2;continue}
          index++;closed=true;break;
        }
        index++;
      }
      if(!closed)throw new TypeError('Unterminated SQL quote');
    }else if(char==='$'&&/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.test(sql.slice(index))){
      const delimiter=sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)[0];
      const end=sql.indexOf(delimiter,index+delimiter.length);
      if(end<0)throw new TypeError('Unterminated SQL dollar quote');
      index=end+delimiter.length;
    }else if(char==='?'){
      text+=`$${++count}`;index++;continue;
    }else if(/[A-Za-z_]/.test(char)){
      index++;
      while(index<sql.length&&/[A-Za-z_0-9$]/.test(sql[index]))index++;
      tokens.push({word:sql.slice(start,index).toUpperCase(),start:text.length,end:text.length+index-start,depth});
    }else{
      if(char==='$'&&/\d/.test(sql[index+1]??''))nativeParameters=true;
      if(char==='(')depth++;
      if(char===')')depth--;
      index++;
    }
    text+=sql.slice(start,index);
  }
  if(count&&nativeParameters)throw new TypeError('Do not mix ? and $n SQL parameters');
  return {text,tokens,count,nativeParameters};
}

/** Translate the application's bound SQL, leaving literals/comments intact. */
export function compileSql(sql){
  if(typeof sql!=='string'||!sql.trim())throw new TypeError('SQL must be a nonempty string');
  const scanned=scanSQL(sql),{tokens}=scanned;
  let text=scanned.text;
  if(tokens[0]?.word==='INSERT'&&tokens[1]?.word==='OR'&&tokens[2]?.word==='IGNORE'){
    const conflict=tokens.findIndex((token,index)=>token.depth===0&&token.word==='ON'&&tokens[index+1]?.word==='CONFLICT');
    if(conflict>=0)throw new TypeError('INSERT OR IGNORE must not also specify ON CONFLICT');
    const returning=tokens.find(token=>token.depth===0&&token.word==='RETURNING');
    // Insert before RETURNING, the final semicolon, or trailing comments.
    // The scanner identifies the end of the last actual SQL token separately
    // below so a line comment never swallows ON CONFLICT.
    let insertAt=returning?.start;
    if(insertAt===undefined){
      // A second scan removes only terminal comments/whitespace for locating
      // the end; literals and comments inside the query retain their content.
      const end=sqlCodeEnd(text);insertAt=text[end-1]===';'?end-1:end;
    }
    text=text.slice(0,insertAt)+' ON CONFLICT DO NOTHING '+text.slice(insertAt);
    text=text.slice(0,tokens[1].start)+text.slice(tokens[2].end);
  }
  return {text,parameterCount:scanned.count,usesNativeParameters:scanned.nativeParameters,
    readOnly:['SELECT','SHOW','VALUES','TABLE'].includes(tokens[0]?.word)};
}

function sqlCodeEnd(sql){
  // Mask comments only; quote bodies are consumed as whole units.
  let index=0,end=0;
  while(index<sql.length){
    if(/\s/.test(sql[index])){index++;continue}
    if(sql.startsWith('--',index)){const next=sql.indexOf('\n',index+2);index=next<0?sql.length:next;continue}
    if(sql.startsWith('/*',index)){
      let depth=1;index+=2;
      while(depth&&index<sql.length){if(sql.startsWith('/*',index)){depth++;index+=2}else if(sql.startsWith('*/',index)){depth--;index+=2}else index++}
      continue;
    }
    const char=sql[index];
    if(char==="'"||char==='"'){
      const escaped=char==="'"&&/[eE]/.test(sql[index-1]??'')&&!/[\w$]/.test(sql[index-2]??'');
      index++;
      while(index<sql.length){if(escaped&&sql[index]==='\\'){index+=2;continue}if(sql[index++]===char){if(sql[index]===char){index++;continue}break}}
    }else if(char==='$'&&/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.test(sql.slice(index))){
      const delimiter=sql.slice(index).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)[0];
      index=sql.indexOf(delimiter,index+delimiter.length)+delimiter.length;
    }else index++;
    end=index;
  }
  return end;
}

function resultOf(result){
  if(Array.isArray(result))throw new TypeError('Prepared statements must contain a single SQL command');
  return {success:true,results:result.rows??[],meta:{changes:result.rowCount??0}};
}

export function makeDatabase(client){
  if(!client||typeof client.query!=='function')throw new TypeError('A PostgreSQL client is required');
  const context={active:false,savepoint:0,closed:false};
  const query=async(text,values=[])=>{
    if(context.closed)throw new Error('Database connection is closed');
    return client.query({text,values,types:parsers});
  };
  class Statement{
    constructor(sql,values=[],conditional=false){this.sql=sql;this.params=values;this.conditional=conditional;this.compiled=compileSql(sql)}
    bind(...values){return new Statement(this.sql,values,this.conditional)}
    onlyIfPreviousChanged(){return new Statement(this.sql,this.params,true)}
    async execute(){
      if(!this.compiled.usesNativeParameters&&this.params.length!==this.compiled.parameterCount)throw new TypeError('SQL parameter count does not match bound values');
      return resultOf(await query(this.compiled.text,this.params));
    }
    async first(column){const row=(await this.all()).results[0]??null;return column!==undefined?(row?.[column]??null):row}
    async all(){if(this.conditional)throw new Error('Conditional statements must run in a batch');return this.execute()}
    async run(){return this.all()}
  }
  const db={
    dialect:'postgres',query,
    prepare:sql=>new Statement(sql),
    async transaction(operation,{readOnly=false,isolationLevel=readOnly?'REPEATABLE READ':'READ COMMITTED'}={}){
      if(typeof operation!=='function')throw new TypeError('Transaction requires a function');
      if(!['READ COMMITTED','REPEATABLE READ','SERIALIZABLE'].includes(isolationLevel))throw new TypeError('Unsupported transaction isolation level');
      const nested=context.active,savepoint=nested?`wallet_sp_${++context.savepoint}`:null;
      await query(nested?`SAVEPOINT ${savepoint}`:`BEGIN ISOLATION LEVEL ${isolationLevel}${readOnly?' READ ONLY':''}`);
      context.active=true;
      try{
        const result=await operation(db);
        await query(nested?`RELEASE SAVEPOINT ${savepoint}`:'COMMIT');
        return result;
      }catch(error){
        try{
          await query(nested?`ROLLBACK TO SAVEPOINT ${savepoint}`:'ROLLBACK');
          if(nested)await query(`RELEASE SAVEPOINT ${savepoint}`);
        }catch(rollbackError){error.rollbackError=rollbackError}
        throw error;
      }finally{if(!nested)context.active=false}
    },
    async batch(statements){
      if(!Array.isArray(statements)||statements.some(statement=>!(statement instanceof Statement)))throw new TypeError('Batch requires statements prepared on this database connection');
      if(!statements.length)return [];
      return db.transaction(async()=>{
        const results=[];
        for(const statement of statements){
          if(statement.conditional&&!(results.at(-1)?.meta.changes>0)){
            results.push({success:true,results:[],meta:{changes:0}});continue;
          }
          results.push(await statement.execute());
        }
        return results;
      },{readOnly:statements.every(statement=>statement.compiled.readOnly)});
    },
    async close(){if(context.closed)return;context.closed=true;await client.end()},
  };
  return db;
}

/** One connection per Worker request. Hyperdrive owns production pooling. */
export async function connectDatabase(env){
  const hyperdrive=env?.HYPERDRIVE?.connectionString;
  const connectionString=hyperdrive||env?.DATABASE_URL;
  if(typeof connectionString!=='string'||!connectionString.trim())throw new Error('PostgreSQL connection is not configured');
  // Hyperdrive pools by transaction. Keep its startup packet minimal; client
  // timers work without relying on undocumented session-parameter forwarding.
  const client=new Client({connectionString,types:parsers,connectionTimeoutMillis:10_000,
    query_timeout:30_000,...(!hyperdrive?{statement_timeout:30_000,application_name:'wallet'}:{})});
  try{await client.connect();return makeDatabase(client)}
  catch(error){await client.end().catch(()=>{});throw error}
}
