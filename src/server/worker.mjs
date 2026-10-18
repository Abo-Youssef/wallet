import {assert,parseMoney,isDate,addMonths,project,currentSummary} from '../shared/finance.mjs';
import {parseHistoryFilters,historyPage} from '../shared/history.mjs';
import {authenticate} from './auth.mjs';
import {runMutation,expectedVersion} from './mutations.mjs';
import {effectiveUnitStatus,rentalPeriodsOverlap,sameRentalSpace,restHouseAvailability} from '../shared/unit-status.mjs';
import {BACKUP_TABLES,BACKUP_FORMAT,BACKUP_SCHEMA,sealBackup} from './backup.mjs';
import {propertyTypeNames} from '../shared/property-types.mjs';
import {previewRestore,commitRestore,restoreControl} from './restore.mjs';
import {connectDatabase} from './postgres.mjs';
import {MAX_RESTORE_BYTES} from '../shared/backup-limits.mjs';

const entityKinds=['property','unit','car','worker'];
const entityColumns=['name','property_type','parent_id','status','reference_value_cents','location','electricity_meter','plate','insurance_expiry','maintenance_date','odometer_km','maintenance_due_km','phone','work_location','iqama_number','iqama_expiry','passport_number','passport_expiry','notes'];
const dateKeys=['insurance_expiry','maintenance_date','iqama_expiry','passport_expiry'];
const allowedStatuses=['available','rented','maintenance','personal_use','unavailable'];
const encode=obj=>JSON.stringify(obj??null);
const now=()=>new Date().toISOString();
const newId=()=>crypto.randomUUID();
const json=(data,code=200)=>new Response(JSON.stringify(data),{status:code,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'}});
const bad=(msg,status=400)=>json({error:msg},status);
function textVal(v,max=250){assert(v==null||typeof v==='string','النص المدخل غير صحيح');const text=(v??'').trim();assert(text.length<=max,`النص يتجاوز الحد المسموح (${max} حرف)`);return text}
function optionalDate(v,label){if(v===null||v===''||v===undefined)return null;assert(isDate(v),`${label} غير صحيح`);return v}
function integer(v,label,max=1e9){assert((typeof v==='number'||typeof v==='string')&&/^\d+$/.test(String(v)),`${label} غير صحيح`);const n=Number(v);assert(Number.isSafeInteger(n)&&n>=0&&n<=max,`${label} غير صحيح`);return n}
function optionalInt(v,label){return v===null||v===''||v===undefined?null:integer(v,label)}
function dateRiyadh(){const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return `${p.year}-${p.month}-${p.day}`}
function monthRiyadh(){return dateRiyadh().slice(0,7)}
function secureWrite(req,url){
  if(['POST','PATCH','PUT','DELETE'].includes(req.method)){
    assert(req.headers.get('origin')===url.origin,'طلب من مصدر غير موثوق');
    // Accept requests from tabs opened before the product rename as well.
    assert(req.headers.get('x-wallet-action')==='1'||req.headers.get('x-mahfazati-action')==='1','تأكيد الطلب مفقود');
    assert(req.headers.get('content-type')?.split(';')[0].trim().toLowerCase()==='application/json','المحتوى يجب أن يكون JSON');
  }
}
function canManageData(user){if(!['manager','assistant'].includes(user.role))throw Object.assign(new Error('هذا الحساب غير مخول بإدارة بيانات المحفظة'),{code:403})}
function onlyManager(user){if(user.role!=='manager')throw Object.assign(new Error('هذه العملية متاحة للمدير فقط'),{code:403})}
async function loadBody(req,limit=50_000){
  if(Number(req.headers.get('content-length'))>limit)throw Object.assign(new Error('الطلب كبير جدًا'),{code:413});
  const reader=req.body?.getReader();assert(reader,'بيانات الطلب مطلوبة');
  const decoder=new TextDecoder();let text='',size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>limit){await reader.cancel();throw Object.assign(new Error('الطلب كبير جدًا'),{code:413})}text+=decoder.decode(value,{stream:true})}
    text+=decoder.decode();
  }finally{reader.releaseLock()}
  let body;try{body=JSON.parse(text)}catch{assert(false,'تنسيق البيانات غير صحيح')}
  assert(body&&typeof body==='object'&&!Array.isArray(body),'يجب إرسال كائن بيانات صحيح');return body;
}
async function qAll(db,sql,...args){return (await db.prepare(sql).bind(...args).all()).results??[]}
async function qOne(db,sql,...args){return await db.prepare(sql).bind(...args).first()}
const stmt=(db,sql,...params)=>db.prepare(sql).bind(...params);
function auditStmt(db,user,action,type,id,before,after,onlyIfChanged=false){
  const statement=stmt(db,'INSERT INTO audit (id,actor,action,target_type,target_id,before_json,after_json,created_at) VALUES (?,?,?,?,?,?,?,?)',newId(),user.email,action,type,id,encode(before),encode(after),now());
  return onlyIfChanged?statement.onlyIfPreviousChanged():statement;
}
function columnsForEntity(body,{kind,parent_id}={}){
  const out={},fields={property:['property_type','location','electricity_meter','reference_value_cents'],unit:['parent_id','status','electricity_meter','reference_value_cents'],car:['plate','reference_value_cents','insurance_expiry','maintenance_date','odometer_km','maintenance_due_km'],worker:['phone','work_location','iqama_number','iqama_expiry','passport_number','passport_expiry']};
  const allowed=new Set(['name','notes',...(fields[kind]||[])]);
  for(const key of entityColumns){if(!(key in body))continue;assert(allowed.has(key),'الحقل لا يخص نوع السجل المختار');
    let v=body[key];
    if(key==='reference_value_cents')v=(v===null||v==='')?null:parseMoney(v,'قيمة الأصل');
    else if(['odometer_km','maintenance_due_km'].includes(key))v=optionalInt(v,key);
    else if(dateKeys.includes(key))v=optionalDate(v,key);
    else if(key==='parent_id')v=v?textVal(v,50):null;
    else if(key==='property_type'){v=v===''?null:v;assert(v===null||(typeof v==='string'&&Object.hasOwn(propertyTypeNames,v)),'نوع العقار غير صحيح')}
    else if(key==='status'){assert(allowedStatuses.includes(v),'حالة الوحدة غير صحيحة')}
    else v=textVal(v,key==='notes'?1500:255);
    out[key]=v;
  }
  if('name' in out)assert(out.name,'الاسم مطلوب');
  if(kind==='worker'){assert(out.reference_value_cents==null&&!out.parent_id,'سجل العامل لا يحمل قيمة مالية أو تبعية لعقار');delete out.reference_value_cents;delete out.parent_id}
  if(kind==='unit'&&parent_id!==undefined)out.parent_id=parent_id;
  return out;
}
function agreementFromInput(b){
  assert(!b.rental_mode||b.rental_mode==='period','استخدم الحجز اليومي للاستراحة');
  const kind=textVal(b.kind,20), entity_id=b.entity_id?textVal(b.entity_id,50):null;
  assert(['purchase','sale','rent','other'].includes(kind),'نوع العملية غير صحيح');
  const direction=['sale','rent'].includes(kind)?'in':'out';
  const title=textVal(b.title);assert(title,'عنوان العملية مطلوب');
  const total_cents=parseMoney(b.total,'القيمة الإجمالية');
  const opening_cents=parseMoney(b.opening??'0','المدفوع أو المحصل سابقًا');
  assert(opening_cents<=total_cents,'المدفوع سابقًا أكبر من القيمة');
  const installment_count=integer(b.count??1,'عدد الأقساط',600),frequency_months=integer(b.frequency??1,'دورية الأقساط',12);
  assert(Number.isInteger(installment_count)&&installment_count>=1&&installment_count<=600,'عدد الأقساط غير صحيح');
  assert([1,3,6,12].includes(frequency_months),'فترة الأقساط غير صحيحة');
  const first_due_date=optionalDate(b.first_due_date,'موعد القسط الأول');assert(first_due_date,'موعد القسط الأول مطلوب');
  const start_date=optionalDate(b.start_date,'تاريخ بداية العقد');
  const end_date=optionalDate(b.end_date,'تاريخ نهاية العقد');
  if(kind==='rent'){
    assert(start_date&&end_date&&start_date<=end_date,'حدد تاريخ بداية ونهاية الإيجار');
    assert(first_due_date>=start_date&&first_due_date<=end_date,'أول استحقاق خارج مدة العقد');
    assert(addMonths(first_due_date,(installment_count-1)*frequency_months)<=end_date,'الأقساط تتجاوز نهاية العقد');
  }
  project({total_cents,opening_cents,installment_count,frequency_months,first_due_date});
  return {kind,direction,title,entity_id,contract_number:textVal(b.contract_number),counterparty:textVal(b.counterparty),phone:textVal(b.phone,50),
    start_date,end_date,first_due_date,total_cents,opening_cents,installment_count,frequency_months,note:textVal(b.note,1200)};
}
async function validateAgreementEntity(db,a,ignoreId){
  if(a.kind==='other'){assert(!a.entity_id,'الأخرى لا تحتاج أصلًا');return}
  assert(a.entity_id,'اختر الأصل أو الوحدة');
  const e=await qOne(db,'SELECT * FROM entities WHERE id=?',a.entity_id);
  assert(e&&!e.archived,'الأصل غير موجود');
  if(a.kind==='rent'){
    const daily=a.rental_mode==='daily';
    assert(daily ? e.kind==='property'&&e.property_type==='rest_house' : e.kind==='unit','اختر استراحة للحجز اليومي أو وحدة للإيجار الدوري');
    if(a.vacated_at||a.booking_cancelled_at)return; // Reopening the ledger does not restore possession.
    assert(!['maintenance','personal_use','unavailable'].includes(e.status),'الوحدة غير متاحة للتأجير؛ غيّر حالة الصيانة أو الاستخدام الشخصي أولًا');
    const entities=await qAll(db,'SELECT * FROM entities WHERE archived=0');
    const active=await qAll(db,"SELECT * FROM agreements WHERE kind='rent' AND status='active' AND closed_at IS NULL");
    if(daily)assert(!['maintenance','personal_use','unavailable'].includes(restHouseAvailability(e,entities,[],a.start_date).status),'الاستراحة غير متاحة؛ راجع الصيانة أو الاستخدام الشخصي للوحدات التابعة');
    assert(!active.some(x=>x.id!==ignoreId && sameRentalSpace(a,x,entities) && rentalPeriodsOverlap(a,x,dateRiyadh())),'المكان محجوز في هذا اليوم أو مرتبط بعقد متداخل لم يؤكد إخلاؤه');
  } else assert(['property','unit','car'].includes(e.kind),'يجب ربط البيع أو الشراء بعقار أو سيارة');
}
function alertFromData(entities,agreements,dismissed,today){
  const out=[];const ignored=new Set(dismissed.map(x=>x.alert_key));
  function push(key,title,date,source,reminderDate){
    if(!date)return;
    const reminder_date=reminderDate??addDays(date,-7);
    if(!ignored.has(key)&&reminder_date<=today)out.push({key,title,due_date:date,reminder_date,source,late:date<today,
      days_remaining:Math.round((Date.parse(`${date}T12:00:00Z`)-Date.parse(`${today}T12:00:00Z`))/86400000)});
  }
  for(const e of entities){
    if(e.kind==='car'){
      push(`ins:${e.id}:${e.insurance_expiry}`,`انتهاء تأمين: ${e.name}`,e.insurance_expiry,'سيارة');
      push(`maint:${e.id}:${e.maintenance_date}`,`صيانة السيارة: ${e.name}`,e.maintenance_date,'سيارة');
      if(e.maintenance_due_km!=null&&e.odometer_km!=null&&Number(e.odometer_km)>=Number(e.maintenance_due_km))
        push(`km:${e.id}:${e.maintenance_due_km}`,`صيانة بالكيلومترات: ${e.name}`,today,'سيارة');
    }
    if(e.kind==='worker'){
      push(`iqama:${e.id}:${e.iqama_expiry}`,`انتهاء إقامة: ${e.name}`,e.iqama_expiry,'عامل');
      push(`passport:${e.id}:${e.passport_expiry}`,`انتهاء جواز: ${e.name}`,e.passport_expiry,'عامل');
    }
  }
  for(const a of agreements){if(a.kind==='rent'&&a.rental_mode!=='daily'&&a.status==='active'&&!a.closed_at&&!a.vacated_at&&a.end_date){
    const annual=a.start_date&&Number(a.start_date.slice(0,4))<9999&&a.end_date>=addDays(addMonths(a.start_date,12),-1);
    push(`rent:${a.id}:${a.end_date}`,`انتهاء عقد إيجار: ${a.title}`,a.end_date,'إيجار',annual?monthsBefore(a.end_date,3):undefined);
  }}
  return out.sort((a,b)=>a.due_date.localeCompare(b.due_date));
}
function addDays(date,n){const x=new Date(`${date}T12:00:00Z`);x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10)}
function monthsBefore(date,n){
  const [year,month,day]=date.split('-').map(Number),first=new Date(Date.UTC(year,month-1-n,1,12));
  const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
  first.setUTCDate(Math.min(day,last));return first.toISOString().slice(0,10);
}
async function bootstrap(db,user,month){
  assert(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month),'صيغة الشهر غير صحيحة');
  const queries=['SELECT * FROM entities WHERE archived=0 ORDER BY created_at DESC',
    'SELECT * FROM agreements ORDER BY created_at DESC',
    'SELECT * FROM payments WHERE active=1 ORDER BY created_at,id',
    'SELECT * FROM expenses WHERE active=1 ORDER BY created_at DESC',
    'SELECT * FROM tasks ORDER BY due_date IS NULL,due_date,created_at',
    'SELECT alert_key FROM dismissed_alerts',
    // Historical labels and parent links only; keep archived records out of current asset lists.
    'SELECT id,kind,name,parent_id,property_type FROM entities WHERE archived=1 ORDER BY created_at DESC,id',
    'SELECT generation FROM restore_control WHERE id=1'];
  const [entities,agreements,payments,expenses,tasks,dismissed,archivedEntities,restoreState]=(await db.batch(queries.map(sql=>stmt(db,sql)))).map(r=>r.results??[]);
  const today=dateRiyadh();
  const finances=currentSummary(agreements,payments,expenses,month,today);
  const alert=alertFromData(entities,agreements,dismissed,today);
  const ownTasks=tasks.filter(x=>user.role==='manager'||x.assigned_to==='assistant');
  const currentEntities=entities.map(e=>e.kind==='unit'?{...e,manual_status:e.status,status:effectiveUnitStatus(e,agreements,today)}:e);
  return {user,month,today,database_generation:restoreState[0].generation,entities:currentEntities,archived_entities:archivedEntities,agreements,payments,expenses,tasks:ownTasks,alerts:alert, ...finances};
}
async function createEntity(db,user,b,commit){
  canManageData(user);
  const kind=textVal(b.kind,25);assert(entityKinds.includes(kind),'نوع السجل غير صحيح');
  const data=columnsForEntity(b,{kind});assert(data.name,'الاسم مطلوب');
  if(kind!=='unit'){assert(!data.parent_id,'التبعية للعقار مخصصة للوحدات');data.parent_id=null}
  if(kind==='unit'&&data.parent_id){const parent=await qOne(db,'SELECT kind,archived FROM entities WHERE id=?',data.parent_id);assert(parent?.kind==='property'&&!parent.archived,'الوحدة يجب ربطها بعقار صحيح')}
  const id=newId(), time=now();
  const all={name:'',parent_id:null,status:'available',reference_value_cents:null,location:'',electricity_meter:'',plate:'',insurance_expiry:null,maintenance_date:null,odometer_km:null,maintenance_due_km:null,phone:'',work_location:'',iqama_number:'',iqama_expiry:null,passport_number:'',passport_expiry:null,notes:'',...data};
  const keys=Object.keys(all);
  return await commit({id},[
    stmt(db,`INSERT INTO entities (id,kind,${keys.join(',')},archived,created_at,updated_at,created_by) VALUES (${Array(2+keys.length+4).fill('?').join(',')})`,id,kind,...keys.map(k=>all[k]),0,time,time,user.email),
    auditStmt(db,user,'إضافة','entity',id,null,{kind,...all})
  ]);

}
async function editEntity(db,user,id,b,commit){
  canManageData(user);
  const old=await qOne(db,'SELECT * FROM entities WHERE id=? AND archived=0',id);assert(old,'السجل غير موجود');expectedVersion(b,old);
  const changes=columnsForEntity(b,{kind:old.kind});
  assert(!('kind' in b)||b.kind===old.kind,'لا يمكن تغيير نوع السجل');
  assert(!('parent_id' in changes)||changes.parent_id===old.parent_id,'لا يمكن نقل الوحدة إلى عقار آخر ضمن تعديل البيانات');
  delete changes.parent_id;
  if(old.kind==='unit'&&['maintenance','personal_use','unavailable'].includes(changes.status)&&changes.status!==old.status){
    const linked=await qOne(db,"SELECT id FROM agreements WHERE entity_id=? AND kind='rent' AND status='active' AND closed_at IS NULL AND vacated_at IS NULL LIMIT 1",id);
    assert(!linked,'الوحدة مرتبطة بإيجار قائم أو قادم؛ عالج العقد قبل تحويلها للصيانة أو الاستخدام الشخصي');
  }
  const keys=Object.keys(changes);assert(keys.length>0,'لا يوجد تعديل');
  return await commit({id},[
    stmt(db,`UPDATE entities SET ${keys.map(k=>`${k}=?`).join(',')},updated_at=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?`,...keys.map(k=>changes[k]),now(),old.version,id),
    auditStmt(db,user,'تعديل','entity',id,old,changes)
  ]);

}
async function archiveEntity(db,user,id,b,commit){
  canManageData(user);
  const old=await qOne(db,'SELECT * FROM entities WHERE id=? AND archived=0',id);assert(old,'السجل غير موجود');expectedVersion(b,old);
  const links=await qOne(db,'SELECT count(*) AS n FROM agreements WHERE entity_id=? AND status=? AND closed_at IS NULL',id,'active');
  assert(Number(links.n)===0,'هذا الأصل مرتبط بجدول مالي نشط؛ لا يمكن حذفه قبل معالجة الارتباط');
  if(old.kind==='property'){
    const children=await qOne(db,'SELECT count(*) AS n FROM entities WHERE parent_id=? AND archived=0',id);
    assert(Number(children.n)===0,'احذف الوحدات التابعة أولًا');
  }
  return await commit({id},[
    stmt(db,'UPDATE entities SET archived=1, updated_at=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',now(),old.version,id),
    auditStmt(db,user,'حذف','entity',id,old,{archived:1})
  ]);
}
async function createAgreement(db,user,b,commit){
  canManageData(user);
  const a=agreementFromInput(b);await validateAgreementEntity(db,a);
  const id=newId(),t=now();
  const keys=Object.keys(a);
  return await commit({id},[
    stmt(db,`INSERT INTO agreements(id,${keys.join(',')},created_by,created_at) VALUES (${Array(keys.length+3).fill('?').join(',')})`,id,...keys.map(k=>a[k]),user.email,t),
    auditStmt(db,user,'إضافة','agreement',id,null,a)
  ]);

}
async function createBooking(db,user,b,commit){
  canManageData(user);
  const day=optionalDate(b.day,'يوم الحجز');
  assert(day&&day>=dateRiyadh(),'اختر اليوم أو يومًا قادمًا للحجز');
  const counterparty=textVal(b.counterparty);assert(counterparty,'اسم المستأجر مطلوب');
  const entity_id=textVal(b.entity_id,50);
  const property=await qOne(db,'SELECT * FROM entities WHERE id=?',entity_id);
  assert(property?.kind==='property'&&property.property_type==='rest_house'&&!property.archived,'اختر استراحة متاحة');
  const total_cents=parseMoney(b.total,'قيمة الحجز');assert(total_cents>0,'قيمة الحجز يجب أن تكون أكبر من صفر');
  const a={kind:'rent',direction:'in',rental_mode:'daily',entity_id,title:property.name+' · '+day,
    counterparty,phone:textVal(b.phone,50),contract_number:textVal(b.contract_number),
    total_cents,opening_cents:0,installment_count:1,frequency_months:1,
    start_date:day,end_date:day,first_due_date:day,note:textVal(b.note,1200)};
  await validateAgreementEntity(db,a);
  const id=newId(),keys=Object.keys(a);
  return commit({id},[
    stmt(db,`INSERT INTO agreements(id,${keys.join(',')},created_by,created_at) VALUES (${Array(keys.length+3).fill('?').join(',')})`,id,...keys.map(k=>a[k]),user.email,now()),
    auditStmt(db,user,'حجز يومي','agreement',id,null,a)
  ]);
}
async function cancelBooking(db,user,id,b,commit){
  canManageData(user);
  const a=await qOne(db,"SELECT * FROM agreements WHERE id=? AND status='active'",id);
  assert(a?.rental_mode==='daily'&&!a.closed_at,'الحجز غير متاح للإلغاء');expectedVersion(b,a);
  assert(!a.booking_cancelled_at,'الحجز ملغى بالفعل');
  assert(b.confirm_cancellation===true,'أكد إلغاء الحجز وحفظ الأثر المالي');
  const note=textVal(b.note,1200);assert(note,'اكتب سبب إلغاء الحجز');
  const payments=await qAll(db,'SELECT * FROM payments WHERE agreement_id=? AND active=1 ORDER BY created_at,id',id),totals=project(a,payments);
  const changes={booking_cancelled_at:now(),booking_cancelled_by:user.email,booking_cancel_note:note};
  return commit({id,...changes},[
    stmt(db,'UPDATE agreements SET booking_cancelled_at=?,booking_cancelled_by=?,booking_cancel_note=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',changes.booking_cancelled_at,user.email,note,a.version,id),
    auditStmt(db,user,'إلغاء حجز يومي','agreement',id,a,{...changes,paid_total_cents:totals.paid_total_cents,remaining_cents:totals.remaining_cents})
  ]);
}
async function editAgreement(db,user,id,b,commit){
  canManageData(user);
  const old=await qOne(db,'SELECT * FROM agreements WHERE id=? AND status=?',id,'active');assert(old,'الجدول غير موجود');expectedVersion(b,old);
  assert(!old.closed_at,'الاتفاق مغلق؛ أعد فتحه قبل التعديل');
  const n=await qOne(db,'SELECT count(*) AS n FROM payments WHERE agreement_id=? AND active=1',id);
  let changes;
  if(Number(n.n)>0||old.vacated_at||old.rental_mode==='daily'){ // preserve financial history and the debt retained at vacancy/cancellation
    assert(!('rental_mode' in b)||b.rental_mode===old.rental_mode,'لا يمكن تغيير نوع الحجز');
    const locked={total:['total_cents',v=>parseMoney(v)],opening:['opening_cents',v=>parseMoney(v)],count:['installment_count',Number],frequency:['frequency_months',Number],first_due_date:['first_due_date',String],start_date:['start_date',v=>v||null],end_date:['end_date',v=>v||null],kind:['kind',String],entity_id:['entity_id',v=>v||null]};
    for(const [input,[column,normalize]] of Object.entries(locked))if(input in b)
      assert(normalize(b[input])===old[column],'لا يمكن تغيير بيانات الجدولة الأصلية بعد وجود دفعات؛ لم يُحفظ التعديل');
    changes={};for(const k of ['title','contract_number','counterparty','phone','note'])if(k in b)changes[k]=textVal(b[k],k==='note'?1200:255);
    assert(Object.keys(changes).length>0,'بعد بدء التحصيل أو السداد لا يمكن تغيير القيمة الأصلية مباشرة؛ صحّح الحركات أو أعد الجدولة');
    if('title' in changes)assert(changes.title,'عنوان العملية مطلوب');
  }else{
    changes=agreementFromInput({...old,total:(old.total_cents/100).toFixed(2),opening:(old.opening_cents/100).toFixed(2),count:old.installment_count,frequency:old.frequency_months,...b});
    await validateAgreementEntity(db,changes,id);
  }
  const keys=Object.keys(changes);
  return await commit({id},[
    stmt(db,`UPDATE agreements SET ${keys.map(k=>`${k}=?`).join(',')},version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?`,...keys.map(k=>changes[k]),old.version,id),
    auditStmt(db,user,'تعديل','agreement',id,old,changes)
  ]);
}
async function cancelAgreement(db,user,id,b,commit){
  canManageData(user);
  const a=await qOne(db,'SELECT * FROM agreements WHERE id=? AND status=?',id,'active');assert(a,'الجدول غير موجود');expectedVersion(b,a);
  assert(!a.closed_at,'الاتفاق مغلق؛ أعد فتحه قبل الإلغاء');
  assert(a.rental_mode!=='daily','استخدم إلغاء الحجز اليومي لحفظ التحصيل والمديونية');
  assert(a.kind!=='rent'||(!a.vacated_at&&a.start_date>dateRiyadh()),'بدأ الإيجار؛ استخدم تأكيد الإخلاء لحفظ التحصيل والمديونية');
  const n=await qOne(db,'SELECT count(*) AS n FROM payments WHERE agreement_id=? AND active=1',id);
  assert(Number(n.n)===0,'لا يمكن إلغاء جدول مرتبط بحركات مالية منفذة؛ يمكن تعديل تفاصيله دون حذف تاريخه');
  return await commit({id},[stmt(db,"UPDATE agreements SET status='cancelled',version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?",a.version,id),auditStmt(db,user,'إلغاء','agreement',id,a,{status:'cancelled'})]);
}
async function changeAgreementClosure(db,user,id,action,b,commit){
  canManageData(user);
  const a=await qOne(db,"SELECT * FROM agreements WHERE id=? AND status='active'",id);assert(a,'الاتفاق غير موجود أو ملغى');expectedVersion(b,a);
  let changes;
  if(action==='close'){
    assert(!a.closed_at,'الاتفاق مغلق بالفعل');
    const payments=await qAll(db,'SELECT * FROM payments WHERE agreement_id=? AND active=1 ORDER BY created_at,id',id);
    assert(project(a,payments).remaining_cents===0,'لا يمكن إغلاق الاتفاق قبل سداد كامل الرصيد المتبقي');
    assert(a.kind!=='rent'||(a.rental_mode==='daily' ? a.booking_cancelled_at||a.end_date<dateRiyadh() : a.vacated_at),'أكد إخلاء الوحدة، أو انتظر انتهاء يوم الحجز، قبل الإغلاق المالي');
    changes={closed_at:now(),closed_by:user.email};
  }else{
    assert(a.closed_at,'الاتفاق مفتوح بالفعل');
    await validateAgreementEntity(db,a,id);
    changes={closed_at:null,closed_by:null};
  }
  return commit({id,...changes},[
    stmt(db,'UPDATE agreements SET closed_at=?,closed_by=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',changes.closed_at,changes.closed_by,a.version,id),
    auditStmt(db,user,action==='close'?'إغلاق اتفاق':'إعادة فتح اتفاق','agreement',id,a,changes)
  ]);
}
async function vacateRental(db,user,id,b,commit){
  canManageData(user);
  const a=await qOne(db,"SELECT * FROM agreements WHERE id=? AND status='active'",id);
  assert(a?.kind==='rent'&&a.rental_mode!=='daily'&&!a.closed_at,'عقد الإيجار غير متاح للإخلاء');expectedVersion(b,a);
  assert(!a.vacated_at,'تم تأكيد إخلاء هذا العقد بالفعل');
  assert(b.confirm_vacancy===true,'أكد إخلاء الوحدة قبل الحفظ');
  const day=optionalDate(b.vacated_on,'تاريخ الإخلاء');
  assert(day&&day>=a.start_date&&day<=dateRiyadh(),'تاريخ الإخلاء يجب أن يكون بين بداية العقد واليوم');
  const payments=await qAll(db,'SELECT * FROM payments WHERE agreement_id=? AND active=1 ORDER BY created_at,id',id);
  const totals=project(a,payments);
  const changes={vacated_on:day,vacated_at:now(),vacated_by:user.email,vacate_note:textVal(b.vacate_note,1200)};
  return commit({id,...changes,remaining_cents:totals.remaining_cents},[
    stmt(db,'UPDATE agreements SET vacated_on=?,vacated_at=?,vacated_by=?,vacate_note=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',
      day,changes.vacated_at,user.email,changes.vacate_note,a.version,id),
    auditStmt(db,user,day<a.end_date?'إخلاء وإنهاء مبكر':'تأكيد إخلاء','agreement',id,a,{...changes,paid_total_cents:totals.paid_total_cents,remaining_cents:totals.remaining_cents})
  ]);
}
async function paymentMutation(db,user,kind,agreementId,original,b,commit){
  canManageData(user);
  if(kind==='void')assert(!['amount','paid_at','slot','reschedule_method','schedule_end_date','note'].some(key=>key in b),'إلغاء الحركة لا يقبل تعديل بياناتها؛ أرسل طلب إلغاء فقط');
  const a=await qOne(db,'SELECT * FROM agreements WHERE id=? AND status=?',agreementId,'active');assert(a,'الالتزام غير موجود أو ملغى');
  assert(!a.closed_at,'الاتفاق مغلق؛ أعد فتحه قبل تسجيل حركة أو تصحيحها');
  const beforeList=await qAll(db,'SELECT * FROM payments WHERE agreement_id=? AND active=1 ORDER BY created_at,id',a.id);
  const amount_cents=b?.amount===undefined?original?.amount_cents:parseMoney(b.amount,'المنفذ فعليًا');
  const paid_at=b?.paid_at??original?.paid_at;assert(isDate(paid_at),'تاريخ التنفيذ غير صحيح');
  const slot_index=b?.slot===undefined?original?.slot_index:integer(b.slot,'القسط',599);
  assert(Number.isInteger(slot_index),'القسط غير صحيح');
  if(b?.reschedule_method!==undefined)assert(b.reschedule_method===null||['','shorten','spread'].includes(b.reschedule_method),'طريقة إعادة الجدولة غير صحيحة');
  const reschedule_method=(b?.reschedule_method===undefined?original?.reschedule_method:(b.reschedule_method||null))??null;
  assert(reschedule_method===null||['shorten','spread'].includes(reschedule_method),'طريقة إعادة الجدولة غير صحيحة');
  const schedule_end_date=b?.schedule_end_date===undefined?(original?.schedule_end_date??null):optionalDate(b.schedule_end_date,'تاريخ نهاية الجدولة');
  const note=(b?.note===undefined?original?.note:textVal(b.note,1200))??'';
  // One stable timestamp for validation and persistence; append after earlier payments
  // even when the clock has the same millisecond or moves backwards.
  const time=new Date(Math.max(Date.now(),Date.parse(beforeList.at(-1)?.created_at||'1970-01-01T00:00:00.000Z')+1)).toISOString();
  let afterList,id;
  if(kind==='new') {
    const request_id=textVal(b.request_id,60);
    assert(/^[0-9a-f-]{20,60}$/i.test(request_id),'معرف العملية مفقود');
    const duplicate=await qOne(db,'SELECT * FROM payments WHERE request_id=?',request_id);
    if(duplicate){
      const matches=duplicate.active===1&&duplicate.agreement_id===a.id&&duplicate.amount_cents===amount_cents&&duplicate.paid_at===paid_at&&duplicate.slot_index===slot_index&&(duplicate.reschedule_method||null)===reschedule_method&&(duplicate.schedule_end_date||null)===schedule_end_date&&(duplicate.note||'')===note;
      if(!matches)throw Object.assign(new Error('معرف الإرسال مرتبط بحركة مختلفة أو مصححة؛ حدّث البيانات وراجع السجل'),{code:409});
      return {id:duplicate.id,idempotent:true};
    }
    id=newId();
    afterList=[...beforeList,{id,agreement_id:a.id,amount_cents,paid_at,slot_index,reschedule_method,schedule_end_date,note,active:1,created_at:time}];
  }else if(kind==='edit'){
    id=original.id;
    afterList=beforeList.map(p=>p.id===id?{...p,amount_cents,paid_at,slot_index,reschedule_method,schedule_end_date,note}:p);
  }else{
    id=original.id;afterList=beforeList.filter(p=>p.id!==id);
  }
  expectedVersion(b,a);
  try{
    const result=project(a,afterList);
    const financialChange=kind==='new'||kind==='edit'&&['amount','paid_at','slot','reschedule_method','schedule_end_date'].some(key=>key in b);
    if(financialChange){
      const context=result.payment_contexts[id];
      if(amount_cents!==context.expected_cents)
        assert(b.schedule_end_date&&schedule_end_date,`عند تغيير المبلغ يجب تأكيد تاريخ نهاية الجدولة: ${context.schedule_end_date}`);
      if(amount_cents<=context.expected_cents)
        assert(reschedule_method===null,'التحصيل الجزئي أو المعتاد يحتفظ بالجدول؛ لا تختَر إعادة توزيع المبلغ');
    }
  }catch(error){
    if(kind!=='new'&&error.code===400)error.message+='؛ راجع الحركات اللاحقة من الأحدث إلى الأقدم قبل تصحيح حركة سابقة';
    throw error;
  } // Reject invalid corrections before touching the database.
  const expected=Number(a.version);
  // A stale read must ABORT the entire batch. A WHERE version=? no-op is unsafe:
  // another request may already have set version to expected+1, passing the trigger.
  // The existing NOT NULL constraint on version provides the atomic failure guard.
  const updateVersion=stmt(db,'UPDATE agreements SET version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',expected,a.id);
  let change;
  if(kind==='new')change=stmt(db,`INSERT INTO payments(id,request_id,agreement_id,slot_index,amount_cents,paid_at,reschedule_method,schedule_end_date,note,active,observed_version,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,id,textVal(b.request_id,60),a.id,slot_index,amount_cents,paid_at,reschedule_method,schedule_end_date,note,1,expected,user.email,time);
  else if(kind==='void')change=stmt(db,'UPDATE payments SET active=0,observed_version=?,updated_at=? WHERE id=?',expected,time,id);
  else change=stmt(db,`UPDATE payments SET slot_index=?,amount_cents=?,paid_at=?,reschedule_method=?,schedule_end_date=?,note=?,active=1,observed_version=?,updated_at=? WHERE id=?`,
      slot_index,amount_cents,paid_at,reschedule_method,schedule_end_date,note,expected,time,id);
  return await commit({id},[updateVersion,change,auditStmt(db,user,kind==='new'?'تسجيل حركة':kind==='edit'?'تعديل حركة':'حذف حركة','payment',id,original??null,kind==='void'?{active:0}:{agreement_id:a.id,amount_cents,paid_at,slot_index,reschedule_method,schedule_end_date,note})]);

}
async function createExpense(db,user,b,commit){
  canManageData(user);
  const title=textVal(b.title);assert(title,'وصف المنصرف مطلوب');
  const amount_cents=parseMoney(b.amount);assert(amount_cents>0,'أدخل مبلغًا أكبر من الصفر');
  assert(isDate(b.paid_at),'حدد تاريخ الصرف الفعلي');
  const entity_id=b.entity_id?textVal(b.entity_id,50):null;
  if(entity_id){const entity=await qOne(db,'SELECT id,kind FROM entities WHERE id=? AND archived=0',entity_id);assert(entity,'الأصل غير موجود');assert(entity.kind!=='worker','سجلات العمال لا ترتبط بحركات مالية')}
  const id=newId(),data={title,amount_cents,paid_at:b.paid_at,entity_id,note:textVal(b.note,1200),direction:'out'};
  return await commit({id},[
    stmt(db,'INSERT INTO expenses(id,title,amount_cents,paid_at,entity_id,note,direction,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)',id,title,amount_cents,b.paid_at,entity_id,data.note,'out',user.email,now()),
    auditStmt(db,user,'مصروف مباشر','expense',id,null,data)
  ]);
}
async function voidExpense(db,user,id,b,commit){
  canManageData(user);
  const old=await qOne(db,'SELECT * FROM expenses WHERE id=? AND active=1',id);assert(old,'العملية غير موجودة');expectedVersion(b,old);
  return await commit({id},[stmt(db,'UPDATE expenses SET active=0,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',old.version,id),auditStmt(db,user,'حذف مصروف','expense',id,old,{active:0})]);
}
async function createTask(db,user,b,commit){
  const title=textVal(b.title);assert(title,'عنوان المهمة مطلوب');
  const assigned_to='assistant';
  const due_date=optionalDate(b.due_date,'موعد المهمة');
  const data={title,description:textVal(b.description,1200),due_date,assigned_to};
  const id=newId();return await commit({id},[
    stmt(db,'INSERT INTO tasks(id,title,description,due_date,assigned_to,created_by,created_at) VALUES (?,?,?,?,?,?,?)',id,title,data.description,due_date,assigned_to,user.email,now()),
    auditStmt(db,user,'إضافة مهمة','task',id,null,data)
  ]);
}
async function updateTask(db,user,id,b,commit){
  const old=await qOne(db,'SELECT * FROM tasks WHERE id=?',id);assert(old,'المهمة غير موجودة');expectedVersion(b,old);
  assert(user.role==='manager'||old.assigned_to==='assistant','لا تملك صلاحية تعديل هذه المهمة');
  const state=b.state;
  assert(['open','done'].includes(state),'حالة المهمة غير صحيحة');
  const data={state,completed_at:state==='done'?now():null,completed_by:state==='done'?user.email:null};
  return await commit({id},[
    stmt(db,'UPDATE tasks SET state=?,completed_at=?,completed_by=?,version=CASE WHEN version=? THEN version+1 ELSE NULL END WHERE id=?',state,data.completed_at,data.completed_by,old.version,id),
    auditStmt(db,user,'تحديث مهمة','task',id,old,data)
  ]);
}
async function api(req,env,url,user){
  const db=env.DB,path=url.pathname,method=req.method;
  if(method==='GET'&&path==='/api/bootstrap')return json(await bootstrap(db,user,url.searchParams.get('month')??monthRiyadh()));
  if(method==='GET'&&path==='/api/history'){
    onlyManager(user);
    const query=parseHistoryFilters(url.searchParams),conditions=['h.audit_id IS NULL'],params=[];
    if(query.fromUTC){conditions.push('a.created_at >= ?');params.push(query.fromUTC)}
    if(query.toUTC){conditions.push('a.created_at <= ?');params.push(query.toUTC)}
    const order=query.sort==='oldest'?'ASC':'DESC',comparison=query.sort==='oldest'?'>':'<';
    if(query.cursor){
      conditions.push(`(a.created_at ${comparison} ? OR (a.created_at = ? AND a.id ${comparison} ?))`);
      params.push(query.cursor.at,query.cursor.at,query.cursor.id);
    }
    const entries=await qAll(db,`SELECT a.* FROM audit a LEFT JOIN hidden_audit h ON h.audit_id=a.id WHERE ${conditions.join(' AND ')} ORDER BY a.created_at ${order},a.id ${order} LIMIT ?`,...params,query.limit+1);
    return json(historyPage(entries,query));
  }
  if(method==='GET'&&path==='/api/backup'){
    onlyManager(user);
    const tables=BACKUP_TABLES;
    const snapshots=await db.batch(tables.map(table=>stmt(db,`SELECT * FROM ${table}`)));
    const data=await sealBackup({format_version:BACKUP_FORMAT,schema_version:BACKUP_SCHEMA,exported_at:now(),timezone:'Asia/Riyadh',warning:'يحتوي الملف على بيانات شخصية ومالية؛ خزنه بأمان',
      ...Object.fromEntries(tables.map((name,i)=>[name,snapshots[i].results??[]]))});
    return new Response(JSON.stringify(data,null,2),{headers:{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="wallet-backup.json"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  }
  if(method==='GET'&&path==='/api/backup/recovery'){
    onlyManager(user);
    const state=await db.prepare('SELECT recovery_json FROM restore_control WHERE id=1').first();
    if(!state.recovery_json)return bad('لا توجد نسخة رجوع؛ لم تُنفذ استعادة داخل التطبيق بعد.',404);
    return json(JSON.parse(state.recovery_json));
  }
  if(method==='POST'&&['/api/backup/preview','/api/backup/restore'].includes(path)){
    onlyManager(user);
    if(path.endsWith('/restore')&&req.headers.get('X-Wallet-Mode')!=='assistant')
      return bad('فعّل وضع المساعد من المزيد قبل تأكيد الاستعادة.',403);
    const body=await loadBody(req,MAX_RESTORE_BYTES+100_000);
    return json(path.endsWith('/preview')?await previewRestore(db,body.backup):await commitRestore(db,user,body));
  }
  if(!['POST','PATCH','DELETE'].includes(method))return bad('العنوان المطلوب غير موجود',404);
  if(user.role==='manager'&&req.headers.get('X-Wallet-Mode')!=='assistant')
    return bad('وضع المدير للاطلاع فقط؛ فعّل وضع المساعد من المزيد قبل إجراء التعديل',403);
  const b=await loadBody(req);
  const bookingCancel=path.match(/^\/api\/bookings\/([a-f0-9-]{36})\/cancel$/);
  const entity=path.match(/^\/api\/entities\/([a-f0-9-]{36})$/);
  const agreement=path.match(/^\/api\/agreements\/([a-f0-9-]{36})$/);
  const closure=path.match(/^\/api\/agreements\/([a-f0-9-]{36})\/(close|reopen)$/);
  const vacancy=path.match(/^\/api\/agreements\/([a-f0-9-]{36})\/vacate$/);
  const paycreate=path.match(/^\/api\/agreements\/([a-f0-9-]{36})\/payments$/);
  const payment=path.match(/^\/api\/payments\/([a-f0-9-]{36})$/);
  const expense=path.match(/^\/api\/expenses\/([a-f0-9-]{36})$/);
  const task=path.match(/^\/api\/tasks\/([a-f0-9-]{36})$/);
  const hide=path.match(/^\/api\/history\/([a-f0-9-]{36})\/hide$/);
  const isTask=(path==='/api/tasks'&&method==='POST')||(task&&method==='PATCH');
  if(hide&&method==='POST')onlyManager(user);else if(!isTask)canManageData(user);
  let operation,status=200;
  if(method==='POST'&&path==='/api/entities'){operation=c=>createEntity(db,user,b,c);status=201}
  else if(method==='POST'&&path==='/api/bookings'){operation=c=>createBooking(db,user,b,c);status=201}
  else if(bookingCancel&&method==='POST')operation=c=>cancelBooking(db,user,bookingCancel[1],b,c);
  else if(entity&&method==='PATCH')operation=c=>editEntity(db,user,entity[1],b,c);
  else if(entity&&method==='DELETE')operation=c=>archiveEntity(db,user,entity[1],b,c);
  else if(method==='POST'&&path==='/api/agreements'){operation=c=>createAgreement(db,user,b,c);status=201}
  else if(agreement&&method==='PATCH')operation=c=>editAgreement(db,user,agreement[1],b,c);
  else if(agreement&&method==='DELETE')operation=c=>cancelAgreement(db,user,agreement[1],b,c);
  else if(closure&&method==='POST')operation=c=>changeAgreementClosure(db,user,closure[1],closure[2],b,c);
  else if(vacancy&&method==='POST')operation=c=>vacateRental(db,user,vacancy[1],b,c);
  else if(paycreate&&method==='POST'){operation=c=>paymentMutation(db,user,'new',paycreate[1],null,b,c);status=201}
  else if(payment&&['PATCH','DELETE'].includes(method))operation=async c=>{
    const p=await qOne(db,'SELECT * FROM payments WHERE id=? AND active=1',payment[1]);assert(p,'الحركة غير موجودة');
    return paymentMutation(db,user,method==='DELETE'?'void':'edit',p.agreement_id,p,b,c);
  };
  else if(method==='POST'&&path==='/api/expenses'){operation=c=>createExpense(db,user,b,c);status=201}
  else if(expense&&method==='DELETE')operation=c=>voidExpense(db,user,expense[1],b,c);
  else if(method==='POST'&&path==='/api/tasks'){operation=c=>createTask(db,user,b,c);status=201}
  else if(task&&method==='PATCH')operation=c=>updateTask(db,user,task[1],b,c);
  else if(method==='POST'&&path==='/api/alerts/dismiss')operation=async commit=>{
    const key=textVal(b.key,255);assert(key,'التنبيه غير موجود');
    if(await qOne(db,'SELECT alert_key FROM dismissed_alerts WHERE alert_key=?',key))return commit({ok:true},[]);
    const snapshot=await db.batch([stmt(db,'SELECT * FROM entities WHERE archived=0'),stmt(db,"SELECT * FROM agreements WHERE status='active'")]);
    assert(alertFromData(snapshot[0].results,snapshot[1].results,[],dateRiyadh()).some(a=>a.key===key),'التنبيه غير موجود أو تغيرت بياناته');
    return commit({ok:true},[stmt(db,'INSERT OR IGNORE INTO dismissed_alerts(alert_key,actor,dismissed_at) VALUES (?,?,?)',key,user.email,now()),auditStmt(db,user,'إتمام تنبيه','alert',key,null,{dismissed:true},true)]);
  };
  else if(hide&&method==='POST')operation=async commit=>{
    assert(await qOne(db,'SELECT id FROM audit WHERE id=?',hide[1]),'السجل غير موجود');
    return commit({ok:true},[stmt(db,'INSERT OR IGNORE INTO hidden_audit(audit_id,hidden_by,hidden_at) VALUES (?,?,?)',hide[1],user.email,now()),auditStmt(db,user,'إخفاء سجل','audit',hide[1],null,{hidden:true},true)]);
  };
  else return bad('العنوان المطلوب غير موجود',404);
  return json(await runMutation(db,user,`${method} ${path}`,b,operation),status);
}

export default {async fetch(req,env){
  const url=new URL(req.url);
  let connection;
  try{
    const user=await authenticate(req,env);
    if(url.pathname.startsWith('/api/')){
      secureWrite(req,url);
      // A test may inject its own connection; deployed Workers use Hyperdrive.
      const db=env.DB??(connection=await connectDatabase(env));
      return await api(req,{...env,DB:db},url,user);
    }
    if(!['GET','HEAD'].includes(req.method))return bad('العملية غير مسموحة',405);
    const asset = await env.ASSETS.fetch(req);
    const response=new Response(asset.body,asset);
    response.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
    response.headers.set('X-Content-Type-Options','nosniff');
    response.headers.set('Referrer-Policy','no-referrer');
    response.headers.set('Cache-Control','private, no-store');
    return response;
  }catch(err){
    const message=String(err.message);
    if(err.code==='23502'&&err.table==='restore_control'&&err.column==='generation')
      return bad('استُعيدت المحفظة أو تغيّرت أثناء الحفظ. حدّث البيانات وأعد فتح العملية.',409);
    if((err.code==='23502'&&err.column==='version')||message.includes('stale agreement'))
      return bad('تغير السجل أثناء الحفظ؛ حدّث البيانات وراجع التعديل قبل إعادة المحاولة',409);
    const databaseErrors={
      'invalid daily booking':'بيانات الحجز محمية؛ ألغِ الحجز وأضف حجزًا جديدًا لتغيير اليوم أو القيمة',
      'rest house has bookings':'توجد حجوزات محفوظة؛ لا يمكن تغيير نوع الاستراحة',
      'overlapping rent':'الوحدة مرتبطة بعقد متداخل أو بإيجار لم يؤكد إخلاؤه؛ حدّث البيانات',
      'invalid rental vacancy':'بيانات تأكيد الإخلاء غير صحيحة',
      'vacated rental locked':'تم الإخلاء؛ تبقى بيانات العقد ومديونيته محفوظة',
      'rental requires vacancy':'أكد إخلاء الوحدة واحفظه قبل إغلاق الإيجار',
      'unit has current rent':'الوحدة مرتبطة بإيجار قائم أو قادم؛ عالج العقد قبل تغيير حالتها',
      'unit unavailable for rent':'الوحدة غير متاحة للتأجير؛ راجع حالة الصيانة أو الاستخدام الشخصي',
      'invalid entity parent':'العقار التابع للوحدة لم يعد متاحًا',
      'immutable entity identity':'لا يمكن تغيير نوع الأصل أو تبعية الوحدة',
      'entity has active links':'الأصل مرتبط بوحدات أو جداول مالية نشطة',
      'invalid agreement entity':'نوع الأصل أو حالته لا يسمح بهذا الاتفاق',
      'paid agreement schedule locked':'بيانات الجدولة محمية بعد تسجيل دفعات',
      'invalid rent period':'فترة الإيجار غير صحيحة',
      'invalid payment agreement':'تغير الالتزام المرتبط بالحركة؛ حدّث البيانات',
      'invalid expense entity':'الأصل المرتبط بالمصروف لم يعد متاحًا',
      'immutable payment identity':'لا يمكن نقل حركة مالية إلى اتفاق آخر',
      'invalid reschedule method':'طريقة الجدولة غير صحيحة',
      'agreement closed':'الاتفاق مغلق؛ أعد فتحه قبل تسجيل حركة أو تصحيحها',
      'invalid agreement closure':'بيانات إغلاق الاتفاق غير صحيحة',
      'unpaid agreement closure':'لا يمكن إغلاق الاتفاق قبل سداد كامل الرصيد المتبقي',
      'unexpired rent closure':'يمكن إغلاق عقد الإيجار بعد انتهاء مدته فقط'
    };
    for(const [key,value] of Object.entries(databaseErrors))if(message.includes(key))return bad(value,409);
    if(['23505','40001','40P01','55P03'].includes(err.code))return bad('تعارض طلب الحفظ؛ حدّث البيانات وراجع السجل',409);
    if([400,401,403,409,413,503].includes(err.code))return bad(message,err.code);
    // Do not expose SQL, personal data or infrastructure details to the client/log.
    console.error('wallet internal request failure');
    return bad('حدث خطأ داخلي؛ لم يتم تأكيد العملية. راجع السجل قبل إعادة الإدخال',500);
  }finally{if(connection)await connection.close().catch(()=>{});}
}};
