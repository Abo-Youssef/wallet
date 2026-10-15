import {project,isDate} from './finance.mjs';
// Read-only preflight, including exports from version 1. Never repairs records.
export function inspectBackup(data){
  const issues=[],counts={};
  const report=(table,id,reason)=>issues.push({table,id:id??null,reason});
  if(!data||typeof data!=='object'||Array.isArray(data))return {ok:false,counts,issues:[{table:null,id:null,reason:'ملف النسخة ليس كائن بيانات'}]};
  const tables=['entities','agreements','payments','expenses','tasks','audit','hidden_audit','dismissed_alerts'];
  const rows={},maps={};
  for(const table of tables){
    if(!Array.isArray(data[table]))report(table,null,'الجدول مفقود أو تنسيقه غير صحيح');
    rows[table]=Array.isArray(data[table])?data[table].filter(x=>x&&typeof x==='object'&&!Array.isArray(x)):[];
    if(rows[table].length!==(data[table]?.length??0))report(table,null,'سجل بتنسيق غير صحيح');
    counts[table]=rows[table].length;maps[table]=new Map();
    const key=table==='hidden_audit'?'audit_id':table==='dismissed_alerts'?'alert_key':'id';
    for(const row of rows[table]){
      if(typeof row[key]!=='string'||!row[key])report(table,row[key],'معرف السجل مفقود');
      else if(maps[table].has(row[key]))report(table,row[key],'معرف مكرر');
      else maps[table].set(row[key],row);
      if('version' in row&&(!Number.isSafeInteger(row.version)||row.version<0))report(table,row[key],'إصدار السجل غير صحيح');
    }
  }
  const amount=(row,key,table,positive=false)=>{if(!Number.isSafeInteger(row[key])||row[key]<(positive?1:0))report(table,row.id,'قيمة مالية غير صحيحة: '+key)};
  const dates=(row,keys,table)=>{for(const key of keys)if(row[key]!=null&&row[key]!==''&&!isDate(row[key]))report(table,row.id,'تاريخ غير صحيح: '+key)};
  for(const e of rows.entities){
    if(!['property','unit','car','worker'].includes(e.kind))report('entities',e.id,'نوع الأصل غير صحيح');
    if(![0,1].includes(e.archived))report('entities',e.id,'حالة الأرشفة غير صحيحة');
    if(e.parent_id){const parent=maps.entities.get(e.parent_id);if(e.kind!=='unit'||parent?.kind!=='property'||(!e.archived&&parent.archived))report('entities',e.id,'تبعية وحدة غير صحيحة أو عقار مؤرشف');}
    if(e.reference_value_cents!=null)amount(e,'reference_value_cents','entities');
    if(e.kind==='worker'&&e.reference_value_cents!=null)report('entities',e.id,'قيمة مالية مرتبطة بعامل');
    dates(e,['insurance_expiry','maintenance_date','iqama_expiry','passport_expiry'],'entities');
  }
  const paymentIds=new Set(),grouped=new Map();
  for(const p of rows.payments){
    const a=maps.agreements.get(p.agreement_id);
    if(!a||(p.active===1&&a.status!=='active'))report('payments',p.id,'الاتفاق غير موجود أو ملغى');
    if(typeof p.request_id!=='string'||!p.request_id||paymentIds.has(p.request_id))report('payments',p.id,'معرف إرسال مفقود أو مكرر');paymentIds.add(p.request_id);
    if(![0,1].includes(p.active))report('payments',p.id,'حالة الحركة غير صحيحة');
    if(!isDate(p.paid_at))report('payments',p.id,'تاريخ التنفيذ غير صحيح');amount(p,'amount_cents','payments',true);
    if(!grouped.has(p.agreement_id))grouped.set(p.agreement_id,[]);grouped.get(p.agreement_id).push(p);
  }
  const leases=new Map();
  for(const a of rows.agreements){
    const e=maps.entities.get(a.entity_id),closed=a.closed_at!=null;
    // Lifecycle columns are absent in older exports. New closed records retain
    // status='active' and their payment history, but no remaining obligation.
    if(closed!==(a.closed_by!=null)||(a.closed_by!=null&&(typeof a.closed_by!=='string'||!a.closed_by.trim())))report('agreements',a.id,'بيانات إغلاق الاتفاق غير مكتملة');
    let closedDate;
    if(closed){
      const time=typeof a.closed_at==='string'?Date.parse(a.closed_at):NaN;
      if(!Number.isFinite(time)||new Date(time).toISOString()!==a.closed_at)report('agreements',a.id,'وقت إغلاق الاتفاق غير صحيح');
      else {
        const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Riyadh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(time));
        const p=Object.fromEntries(parts.map(part=>[part.type,part.value]));closedDate=`${p.year}-${p.month}-${p.day}`;
      }
      if(a.status!=='active')report('agreements',a.id,'لا يمكن إغلاق اتفاق ملغى');
    }
    if(!['purchase','sale','rent','other'].includes(a.kind)||!['active','cancelled'].includes(a.status))report('agreements',a.id,'نوع الاتفاق أو حالته غير صحيح');
    if(a.direction!==(['rent','sale'].includes(a.kind)?'in':'out'))report('agreements',a.id,'اتجاه مالي غير صحيح');
    if(a.kind==='other'?!!a.entity_id:!e||e.kind==='worker'||(a.kind==='rent'&&e.kind!=='unit')||(a.status==='active'&&!closed&&e.archived))report('agreements',a.id,'ارتباط مالي بأصل غير صحيح');
    // JSON exports store integer halalas. Reject null/string values before
    // project() can coerce them; older exports need no new metadata or columns.
    amount(a,'total_cents','agreements');amount(a,'opening_cents','agreements');
    dates(a,['start_date','end_date','first_due_date'],'agreements');
    let projection;
    try{projection=project(a,grouped.get(a.id)||[])}catch(error){report('agreements',a.id,'إعادة حساب الجدول: '+error.message)}
    if(closed&&projection&&projection.remaining_cents!==0)report('agreements',a.id,'اتفاق مغلق وله رصيد متبقٍ');
    if(a.kind==='rent'){
      if(!isDate(a.start_date)||!isDate(a.end_date)||a.start_date>a.end_date)report('agreements',a.id,'فترة إيجار غير صحيحة');
      else {
        if(isDate(a.first_due_date)&&(a.first_due_date<a.start_date||a.first_due_date>a.end_date))report('agreements',a.id,'أول استحقاق خارج مدة عقد الإيجار');
        // Use the same clamped month arithmetic as the financial engine. This
        // checks the original schedule, including slots already fully paid.
        if(projection&&projection.rows.at(-1).due_date>a.end_date)report('agreements',a.id,'آخر استحقاق يتجاوز نهاية عقد الإيجار');
        if(closedDate&&closedDate<=a.end_date)report('agreements',a.id,'أُغلق عقد الإيجار قبل انتهاء مدته');
        if(a.status==='active'&&!closed){if(!leases.has(a.entity_id))leases.set(a.entity_id,[]);leases.get(a.entity_id).push(a)}
      }
    }
  }
  for(const group of leases.values()){
    group.sort((a,b)=>a.start_date.localeCompare(b.start_date));let prior=null;
    for(const a of group){if(prior&&a.start_date<=prior.end_date)report('agreements',a.id,'عقد إيجار متداخل مع '+prior.id);if(!prior||a.end_date>prior.end_date)prior=a}
  }
  for(const e of rows.expenses){
    if(e.entity_id&&(!maps.entities.has(e.entity_id)||maps.entities.get(e.entity_id).kind==='worker'))report('expenses',e.id,'ارتباط المصروف غير صحيح');
    amount(e,'amount_cents','expenses',true);if(!isDate(e.paid_at))report('expenses',e.id,'تاريخ التنفيذ غير صحيح');
    if(![0,1].includes(e.active)||!['in','out'].includes(e.direction))report('expenses',e.id,'حالة المصروف أو اتجاهه غير صحيح');
  }
  for(const t of rows.tasks){
    if(!['open','done'].includes(t.state)||!['manager','assistant'].includes(t.assigned_to))report('tasks',t.id,'حالة المهمة أو المكلّف غير صحيح');
    dates(t,['due_date'],'tasks');
  }
  for(const h of rows.hidden_audit)if(!maps.audit.has(h.audit_id))report('hidden_audit',h.audit_id,'سجل تدقيق غير موجود');
  return {ok:issues.length===0,counts,issues};
}
