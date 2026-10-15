import {historyPeriod,parseHistoryFilters,filterHistory} from './history.mjs';
import {prepareWrite,finishWrite} from './writes.mjs';
import {inputCents} from './money-client.mjs';
import {selectDataRecords,agreementPayments,alertDestination,buildMonthStatement,entityReference,formatRiyadhDate} from './client-model.mjs';
import {statementHTML,statementCSV} from './statements.mjs';

const root=document.getElementById('app'),modalRoot=document.getElementById('modal'),toastBox=document.getElementById('toast');
const state={data:null,page:'home',kind:'property',filter:'all',dataMode:'cards',search:'',month:new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Riyadh'}).slice(0,7),requestedMonth:'',demo:Boolean(globalThis.mahfazatiPreview),dueScope:'month',loading:false,error:'',loadRequest:0,visibleDues:20,agreementReturn:null,statement:null};
state.history={from:'',to:'',sort:'newest',preset:'all',entries:[],cursor:null,hasMore:false,loading:false,error:'',request:0};
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=c=>(Number(c||0)/100).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
const toInput=c=>(Number(c||0)/100).toFixed(2);
const fmtDate=d=>d?new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${d}T12:00:00Z`)):'—';
const badge=(status)=>`<span class="pill ${status==='متأخر'?'late':status==='اليوم'?'today':status==='قادم'?'future':'done'}">${h(status)}</span>`;
const btn=(label,action,id='',extra='')=>`<button type="button" class="btn ${extra}" data-action="${action}" data-id="${h(id)}">${label}</button>`;
const icon=name=>{const shapes={home:'<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-7h6v7"/>',collect:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',pay:'<path d="M12 15V3m-4 4 4-4 4 4M4 16v5h16v-5"/>',data:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',refresh:'<path d="M20 7a9 9 0 1 0 1 8M20 3v5h-5"/>',history:'<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="7" cy="5" r="1"/>',tasks:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 12 3 3 5-6"/>',alerts:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',backup:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>'};return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name]||''}</svg>`};
const role=()=>state.data?.user?.role;
const isAssistant=()=>role()==='assistant';
const entityById=id=>entityReference(state.data,id);
const agreementById=id=>state.data?.agreements?.find(x=>x.id===id);
function notify(message,isError=false){toastBox.textContent=message;toastBox.className=isError?'error':'';toastBox.style.display='block';clearTimeout(notify.timer);notify.timer=setTimeout(()=>toastBox.style.display='none',3700)}
async function api(path,method='GET',payload){
  if(state.demo)throw new Error('هذه معاينة فقط؛ لا تحفظ التغييرات.');
  const writing=method!=='GET',options={method,headers:{}};
  if(writing&&(state.loading||state.error))throw new Error('حدّث بيانات المحفظة أولًا قبل تسجيل تغيير جديد.');
  let prepared;
  if(writing){prepared=await prepareWrite(path,method,payload??{},state.data?.user?.email||'');options.headers['Content-Type']='application/json';options.headers['X-Mahfazati-Action']='1';options.body=JSON.stringify(prepared.body)}
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20_000);options.signal=controller.signal;
  try{
    let res;try{res=await fetch(path,options)}catch{throw Object.assign(new Error(writing?'لم يصل تأكيد الحفظ؛ أعد المحاولة بالبيانات نفسها لتأكيد النتيجة دون تكرار.':'تعذر الاتصال بالخادم؛ تحقق من الإنترنت ثم أعد المحاولة'),{uncertain:writing})}
    let body;try{body=await res.json()}catch{throw Object.assign(new Error('تعذر قراءة تأكيد الخادم؛ أعد المحاولة بالبيانات نفسها'),{uncertain:writing})}
    if(!res.ok){const retryable=[401,403,408,425,429].includes(res.status)||res.status>=500;if(prepared&&!retryable)finishWrite(prepared.key);throw Object.assign(new Error(body.error||'لم تكتمل العملية'),{code:res.status,uncertain:writing&&retryable})}
    if(prepared)finishWrite(prepared.key);return body;
  }finally{clearTimeout(timer)}
}
async function reload(month=state.requestedMonth||state.month){
  const request=++state.loadRequest;state.requestedMonth=month;state.loading=true;state.error='';if(state.data)render();
  try{
    const data=state.demo?globalThis.mahfazatiPreview.data(month):await api('/api/bootstrap?month='+encodeURIComponent(month));
    if(request!==state.loadRequest)return false;
    state.data=data;state.month=data.month;state.requestedMonth='';state.updatedAt=new Date();return true;
  }catch(error){if(request===state.loadRequest){state.error=error.message;if(state.data)state.month=state.data.month}return false}
  finally{if(request===state.loadRequest){state.loading=false;state.requestedMonth='';
    if(state.data)render();else root.innerHTML=`<main class="shell"><section class="panel connection-error"><div class="logo">◈</div><h1>تعذر فتح محفظتي</h1><p role="alert">${h(state.error)}</p>${btn('إعادة المحاولة','reload','','primary')}</section></main>`;
  }}
}
function header(){return `<header class="topbar app-header"><div class="topinner"><div class="brand"><div class="logo" aria-hidden="true">م</div><div><div class="brandname">محفظتي</div><div class="subtitle">${role()==='manager'?'مساحة المدير':'مساحة المساعد'}</div></div></div><div class="actions">
<button class="iconbtn" aria-label="سجل العمليات" title="سجل العمليات" data-action="history">${icon('history')}</button>
<button class="iconbtn" aria-label="المهام" title="المهام" data-action="tasks">${icon('tasks')}</button>
<button class="iconbtn" aria-label="التنبيهات" title="التنبيهات" data-action="alerts">${icon('alerts')}</button>
${role()==='manager'?`<button class="iconbtn" aria-label="نسخة احتياطية" title="تصدير نسخة احتياطية" data-action="backup">${icon('backup')}</button>`:''}
<button class="iconbtn" aria-label="تحديث البيانات" title="تحديث البيانات" data-action="reload">${icon('refresh')}</button><span class="avatar">${role()==='manager'?'المدير':'المساعد'}</span></div></div>
<nav class="nav" aria-label="الأقسام الرئيسية">${[['home','الرئيسية'],['collect','التحصيل'],['pay','السداد'],['data','البيانات']].map(([key,label])=>`<button data-action="page" data-id="${key}" aria-current="${state.page===key?'page':'false'}" class="${state.page===key?'active':''}">${icon(key)}<span>${label}</span></button>`).join('')}</nav></header>`}
function render(){if(!state.data)return;
  const active=document.activeElement,restore=root.contains?.(active),focus=restore?{id:active.id,action:active.dataset?.action,item:active.dataset?.id,start:active.selectionStart,end:active.selectionEnd}:null;
  let body=state.page==='home'?(isAssistant()?assistantHome():managerHome()):state.page==='collect'?cashPage('in'):state.page==='pay'?cashPage('out'):dataPage();
  root.innerHTML=`${state.demo?'<div class="banner">معاينة توضيحية دون حفظ · <a href="?role=manager">المدير</a> · <a href="?role=assistant">المساعد</a></div>':''}${header()}<main id="main-content" class="shell" aria-busy="${state.loading}">${state.error?`<div class="alert warn refresh-error" role="alert">${h(state.error)} ${btn('تحديث البيانات','reload','','small')}</div>`:''}<div class="sync-status" role="status">${state.loading?'جارٍ تحميل '+h(state.requestedMonth||state.month)+'… الأرقام المعروضة تخص '+h(state.data.month):state.updatedAt?'آخر تحديث: '+h(state.updatedAt.toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Riyadh'})):''}</div>${body}</main>${isAssistant()?'<button class="floatadd" data-action="quickadd">＋ إضافة</button>':''}`;
  if(focus){const target=(focus.id?document.getElementById(focus.id):null)||[...root.querySelectorAll('[data-action]')].find(x=>x.dataset.action===focus.action&&x.dataset.id===focus.item);target?.focus({preventScroll:true});if(target?.setSelectionRange&&focus.start!=null&&target.type!=='month')target.setSelectionRange(focus.start,focus.end)}
}
function heading(title,desc,extra=''){return `<div class="main-head page-intro"><div><h1 class="page-title" tabindex="-1">${title}</h1><p class="hint">${desc}</p></div>${extra?`<div class="page-tools">${extra}</div>`:''}</div>`}
function monthTools(){return `<label class="month-control"><span class="sr-only">اختيار الشهر</span><input aria-label="اختيار الشهر" type="month" id="month" value="${h(state.month)}" /></label>${btn('كشف الشهر','statement','','small')}`}
function ledgerRow(label,value,note='',cls=''){return `<div class="ledger-row"><div class="ledger-label">${label}${note?`<span class="ledger-note">${note}</span>`:''}</div><strong class="ledger-value ${cls}">${money(value)} <span class="unit">ر.س</span></strong></div>`}
function metric(label,value,foot,cls=''){return `<div class="tile"><div class="kpi-label">${label}</div><div class="kpi-number ${cls}">${money(value)} <span class="unit">ر.س</span></div><div class="kpi-foot">${foot}</div></div>`}
function managerHome(){const s=state.data.summary,d=state.data;
 return `${heading('نظرة على محفظتك','مراجعة شهر '+h(state.month)+' · الاستحقاقات والتنفيذ النقدي كلٌّ في موضعه',monthTools())}
 <div class="work-layout manager-layout"><div class="work-main"><section class="panel ledger-panel"><div class="section-heading"><div><p class="eyebrow">حسب موعد الاستحقاق</p><h2 class="section-title">التزامات الشهر</h2></div></div><div class="scheduled-ledger"><div class="ledger-column"><h3 class="ledger-heading">التحصيل</h3><div class="ledger-rows">${ledgerRow('إجمالي المستحق',s.due_in)}${ledgerRow('تم تحصيله',s.fulfilled_in,'من استحقاقات هذا الشهر','good')}${ledgerRow('المتبقي للتحصيل',s.remaining_in)}</div>${btn('مراجعة التحصيل','page','collect','block')}</div><div class="ledger-column"><h3 class="ledger-heading">السداد</h3><div class="ledger-rows">${ledgerRow('إجمالي المستحق',s.due_out)}${ledgerRow('تم سداده',s.fulfilled_out,'من استحقاقات هذا الشهر','good')}${ledgerRow('المتبقي للسداد',s.remaining_out)}</div>${btn('مراجعة السداد','page','pay','block')}</div></div></section>
 <section class="panel ledger-panel"><p class="eyebrow">حسب تاريخ التنفيذ</p><h2 class="section-title">التدفق النقدي الفعلي</h2><div class="ledger-rows">${ledgerRow('دخل خلال الشهر',s.cash_in,'التحصيلات المنفذة','good')}${ledgerRow('خرج خلال الشهر',s.cash_out,'السداد والمصروفات المباشرة')}${ledgerRow('صافي التدفق',s.net,'الداخل ناقص الخارج',s.net>=0?'good':'bad')}</div><p class="hint">الدفعة المبكرة أو المتأخرة تدخل هنا بتاريخ تنفيذها. الصافي لا يمثل رصيد حساب بنكي.</p></section></div>
 <aside class="work-aside"><section class="panel ledger-panel"><p class="eyebrow">كل الفترات · الحالة في ${h(d.today)}</p><h2 class="section-title">ما يحتاج متابعة</h2><div class="ledger-rows">${ledgerRow('تحصيل متأخر',s.overdue_in,'','bad')}${ledgerRow('سداد متأخر',s.overdue_out,'','bad')}${ledgerRow('تحصيل مستقبلي',s.future_in)}${ledgerRow('سداد مستقبلي',s.future_out)}</div>${btn('عرض التنبيهات','alerts','','block')}</section><section class="panel portfolio-summary"><h2 class="section-title">أصول المحفظة</h2><div class="portfolio-counts">${['property','unit','car','worker'].map(k=>`<div><strong>${d.entities.filter(e=>e.kind===k).length}</strong><span>${{property:'عقارات',unit:'وحدات',car:'سيارات',worker:'عمال'}[k]}</span></div>`).join('')}</div>${btn('مراجعة البيانات','page','data','block')}<p class="hint">قيم الأصول مرجعية ولا تدخل في التدفق النقدي.</p></section></aside></div>`;
}
function assistantHome(){const d=state.data,today=d.today,openTasks=d.tasks.filter(x=>x.state==='open');
  const candidates=d.dues.filter(x=>x.due_date<=plusDays(today,30));
  const late=candidates.filter(x=>x.due_date<today).length,todayCount=candidates.filter(x=>x.due_date===today).length;
 return `${heading('جدول أعمالك','ابدأ بالمستحق، ثم أكمل المتابعة · '+fmtDate(today),btn('＋ إضافة جديدة','quickadd','','primary'))}
 <div class="agenda-summary"><div class="agenda-stat"><strong class="bad">${late}</strong><span>استحقاقات متأخرة</span></div><div class="agenda-stat"><strong>${todayCount}</strong><span>مستحقة اليوم</span></div><div class="agenda-stat"><strong>${openTasks.length}</strong><span>مهام مفتوحة</span></div></div>
 <div class="work-layout"><div class="work-main"><section class="panel"><div class="section-heading"><div><p class="eyebrow">المتأخر والقادم خلال 30 يومًا</p><h2 class="section-title">التحصيل والسداد</h2></div><span class="result-count">${candidates.length} استحقاق</span></div>${candidates.length?candidates.slice(0,state.visibleDues).map(dueItem).join(''):`<div class="empty">لا توجد استحقاقات تحتاج متابعة خلال الأيام القادمة.</div>`}${candidates.length>state.visibleDues?btn(`عرض المزيد (${candidates.length-state.visibleDues})`,'moreDues','','block'):''}</section></div>
 <aside class="work-aside"><section class="panel"><div class="section-heading"><h2 class="section-title">المهام اليدوية</h2>${btn('＋ مهمة','taskAdd','','small')}</div>${openTasks.length?openTasks.map(taskItem).join(''):`<div class="empty">لا توجد مهام معلّقة.</div>`}</section><section class="panel"><h2 class="section-title">التنبيهات الإدارية</h2>${d.alerts.length?d.alerts.map(alertItem).join(''):`<div class="empty">لا توجد تنبيهات إدارية حاليًا.</div>`}</section></aside></div>`;
}
function plusDays(date,num){const x=new Date(`${date}T12:00:00Z`);x.setUTCDate(x.getUTCDate()+num);return x.toISOString().slice(0,10)}
function dueItem(d){const a=agreementById(d.agreement_id), entity=entityById(d.entity_id);
 return `<div class="line row"><div class="grow"><div class="line-title">${h(d.title)}</div><div class="line-sub">${h(entity?.name||({'other':'أخرى'}[d.kind]||d.kind))} · ${fmtDate(d.due_date)} · ${d.direction==='in'?'تحصيل':'سداد'}</div></div><div class="due-summary"><div class="duevalue">${money(d.amount_cents)} ر.س</div><div>${badge(d.status)}</div></div>${isAssistant()?btn(d.direction==='in'?'تم التحصيل':'تم السداد','payConfirm',`${d.agreement_id}::${d.slot}`,'small primary'):''}</div>`;
}
function taskItem(t){return `<div class="line row"><div class="grow"><div class="line-title">${h(t.title)}</div><div class="line-sub">${h(t.description)} ${t.due_date?'· '+fmtDate(t.due_date):''}</div></div>${badge(t.state==='done'?'مكتملة':t.due_date&&t.due_date<state.data.today?'متأخر':'جديدة')}${btn(t.state==='done'?'إعادة فتح':'تم التنفيذ','taskToggle',t.id,'small')}</div>`}
function alertItem(a){const destination=alertDestination(a,state.data);return `<div class="line row"><div class="grow"><div class="line-title">${h(a.title)}</div><div class="line-sub">${h(a.source)} · ${fmtDate(a.due_date)}</div></div>${badge(a.late?'متأخر':'قادم')}<div class="flex">${destination?btn(destination.label,destination.action,destination.id,'small'):''}${isAssistant()?btn('تمت المتابعة','alertDismiss',a.key,'small'):''}</div></div>`}
function cashPage(dir){const d=state.data,s=d.summary,flag=dir==='in'?'in':'out',title=dir==='in'?'التحصيل':'السداد';
 const filtered=d.dues.filter(x=>x.direction===dir&&(state.dueScope==='all'||x.due_date.slice(0,7)===state.month)).filter(x=>state.filter==='all'||(state.filter==='late'?x.status==='متأخر':state.filter==='today'?x.status==='اليوم':x.status==='قادم'));
 const payments=d.payments.filter(p=>agreementById(p.agreement_id)?.direction===dir&&p.paid_at.slice(0,7)===state.month).sort((a,b)=>b.created_at.localeCompare(a.created_at));
 const direct=dir==='out'?d.expenses.filter(e=>e.paid_at.slice(0,7)===state.month):[];
 return `${heading(title,'استحقاقات '+h(state.month)+' وحركاته النقدية، كلٌّ بحسب تاريخه',monthTools())}
 <div class="agenda-summary cash-summary"><div class="agenda-stat"><strong>${money(s[`due_${flag}`])} <span class="unit">ر.س</span></strong><span>المستحق للشهر</span></div><div class="agenda-stat"><strong class="good">${money(s[`fulfilled_${flag}`])} <span class="unit">ر.س</span></strong><span>منفذ من استحقاق الشهر</span></div><div class="agenda-stat"><strong>${money(s[`remaining_${flag}`])} <span class="unit">ر.س</span></strong><span>المتبقي للشهر</span></div></div>
 <section class="panel section"><div class="row"><h3 class="section-title">الاستحقاقات المفتوحة</h3><span class="hint">${filtered.length} استحقاق</span></div>
 <div class="scope-switch" aria-label="نطاق الاستحقاقات">${[['month','الشهر المختار'],['all','جميع الفترات']].map(([key,label])=>`<button type="button" data-action="dueScope" data-id="${key}" aria-pressed="${state.dueScope===key}" class="${state.dueScope===key?'selected':''}">${label}</button>`).join('')}</div>
 <div class="filters" aria-label="حالة الاستحقاق">${[['all','الكل'],['late','متأخر'],['today','اليوم'],['future','قادم']].map(([k,v])=>`<button type="button" aria-pressed="${state.filter===k}" class="${state.filter===k?'selected':''}" data-action="filter" data-id="${k}">${v}</button>`).join('')}</div>
 ${filtered.length?filtered.map(dueItem).join(''):'<div class="empty">لا توجد استحقاقات مفتوحة في هذا التصنيف</div>'}</section>
 <section class="panel"><h3 class="section-title">الحركات المنفذة خلال ${h(state.month)}</h3>${payments.length?payments.map(p=>{
  const a=agreementById(p.agreement_id);
  return `<div class="line row"><div class="grow"><div class="line-title">${h(a?.title||'عملية مالية')}</div><div class="line-sub">${fmtDate(p.paid_at)} · ${h(p.created_by||'')}</div></div><div class="duevalue">${money(p.amount_cents)} ر.س</div><div class="flex">${a?btn('تفاصيل الاتفاق','agreementDetails',a.id,'small'):''}${isAssistant()&&!a?.closed_at?`${btn('تعديل','payEdit',p.id,'small')}${btn('حذف','payVoid',p.id,'small danger')}`:''}</div></div>`
 }).join(''):'<div class="empty">لا توجد حركات مسجلة</div>'}
 ${dir==='out'?`<h3 class="section-title section">مصروفات مباشرة خلال ${h(state.month)}</h3>${direct.length?direct.map(e=>`<div class="line row"><div class="grow"><div class="line-title">${h(e.title)}</div><div class="line-sub">${fmtDate(e.paid_at)} · ${h(e.note||'')}</div></div><div class="duevalue">${money(e.amount_cents)} ر.س</div>${isAssistant()?btn('حذف','expenseVoid',e.id,'small danger'):''}</div>`).join(''):'<div class="empty">لا توجد مصروفات مباشرة</div>'}`:''}
 </section>`;
}
const categoryNames={property:'عقار',unit:'وحدة',car:'سيارة',worker:'عامل',other:'أخرى',closed:'الاتفاقات المغلقة'};
function dataTable(k,records=selectDataRecords(state.data,k,state.search)){
 const ent=records.entities;
 let cols=[],rows=[];
 if(k==='property'){
   cols=['السجل','التبعية / الموقع','الحالة','الإجراءات'];
   rows=ent.filter(e=>['property','unit'].includes(e.kind)).map(e=>[`${e.kind==='property'?'🏢':'▤'} ${e.name}`,e.kind==='property'?(e.location||'عقار رئيسي'):(entityById(e.parent_id)?.name||'وحدة مستقلة'),e.kind==='property'?'عقار':({available:'متاحة',rented:'مؤجرة',maintenance:'صيانة',unavailable:'غير متاحة'}[currentUnitStatus(e)]||'—'),entityButtons(e)]);
 }else if(k==='car'){
   cols=['السيارة','رقم اللوحة','موعد التأمين / الصيانة','الإجراءات'];
   rows=ent.filter(e=>e.kind==='car').map(e=>[e.name,e.plate||'—',`${e.insurance_expiry||'—'} / ${e.maintenance_date||'—'}`,entityButtons(e)]);
 }else if(k==='worker'){
   cols=['العامل','مكان العمل','الإقامة / الجواز','الإجراءات'];
   rows=ent.filter(e=>e.kind==='worker').map(e=>[e.name,e.work_location||'—',`${e.iqama_expiry||'—'} / ${e.passport_expiry||'—'}`,entityButtons(e)]);
 }else if(k==='closed'){
   cols=['الاتفاق','الأصل المرتبط','تاريخ الإغلاق','الإجراءات'];
   rows=records.agreements.map(a=>{const entity=entityById(a.entity_id);return [a.title,entity?entity.name+(entity.archived?' · مؤرشف':''):'غير مرتبط بأصل',formatRiyadhDate(a.closed_at),agreementButtons(a)]});
 }else{
   cols=['العملية','التصنيف','القيمة','الإجراءات'];
   rows=[...records.agreements.map(a=>[a.title,a.closed_at?'مجدولة · مغلقة':'مجدولة',money(a.total_cents)+' ر.س',agreementButtons(a)]),...records.expenses.map(e=>[e.title,'مصروف مباشر',money(e.amount_cents)+' ر.س',expenseButtons(e)])];
 }
  const datarows=rows.map(r=>`<tr>${r.map((v,i)=>`<td>${i===r.length-1?v:h(v)}</td>`).join('')}</tr>`).join('');
  return `<div class="panel"><div class="tablewrap" tabindex="0" role="region" aria-label="جدول البيانات؛ يمكن التمرير أفقيًا"><table class="tbl"><thead><tr>${cols.map(c=>`<th scope="col">${h(c)}</th>`).join('')}</tr></thead><tbody>${datarows||`<tr><td colspan="4">لا توجد سجلات مطابقة</td></tr>`}</tbody></table></div></div>`;
}
function dataPage(){const k=state.kind,records=selectDataRecords(state.data,k,state.search),ents=records.entities,agreements=records.agreements;
 let body='';
 if(k==='property'){
  const props=ents.filter(e=>e.kind==='property'),standalone=ents.filter(e=>e.kind==='unit'&&!e.parent_id);
  body=props.map(p=>{const children=ents.filter(e=>e.kind==='unit'&&e.parent_id===p.id),totalChildren=state.data.entities.filter(e=>e.kind==='unit'&&e.parent_id===p.id).length;
    return `<div class="panel entity-card"><div class="row"><div class="grow"><div class="line-title">${h(p.name)}</div><div class="line-sub">${h(p.location||'')} ${p.electricity_meter?'· عداد الكهرباء: '+h(p.electricity_meter):''} · القيمة المرجعية: ${p.reference_value_cents==null?'غير مدخلة':money(p.reference_value_cents)+' ر.س'}</div></div>${entityButtons(p)}</div><div class="divider"></div><div class="row"><h4 class="smalltitle">الوحدات (${children.length}${state.search?' من '+totalChildren:''})</h4>${isAssistant()?btn('＋ وحدة','entityAdd','unit::'+p.id,'small'):''}</div>${children.length?children.map(renderUnit).join(''):`<div class="hint">${totalChildren&&state.search?'لا توجد وحدات مطابقة لهذا البحث.':'لم تُضف وحدات لهذا العقار بعد.'}</div>`}${agreementsFor(p.id)}</div>`}).join('');
  body+=`<div class="panel"><div class="row"><h3 class="section-title">وحدات مستقلة (${standalone.length})</h3>${isAssistant()?btn('＋ وحدة مستقلة','entityAdd','unit','small'):''}</div>${standalone.length?standalone.map(renderUnit).join(''):'<div class="hint">لا توجد وحدات مستقلة.</div>'}</div>`;
 }else if(k==='car'||k==='worker'){
   body=ents.filter(e=>e.kind===k).map(e=>`<div class="panel"><div class="row"><div class="grow"><div class="line-title">${k==='car'?'🚙':'👤'} ${h(e.name)}</div><div class="line-sub">${k==='car'?`اللوحة: ${h(e.plate||'—')} · القيمة المرجعية: ${e.reference_value_cents==null?'—':money(e.reference_value_cents)+' ر.س'}`:`مكان العمل: ${h(e.work_location||'—')} · التواصل: ${h(e.phone||'—')}`}</div></div>${entityButtons(e)}</div>
   <div class="divider"></div>${k==='car'?`<div class="grid3"><div class="hint">التأمين: ${fmtDate(e.insurance_expiry)}</div><div class="hint">الصيانة: ${fmtDate(e.maintenance_date)}</div><div class="hint">الكيلومترات: ${e.odometer_km??'—'} / ${e.maintenance_due_km??'—'}</div></div>`:`<div class="grid"><div class="hint">الإقامة: ${h(e.iqama_number||'—')} · ${fmtDate(e.iqama_expiry)}</div><div class="hint">الجواز: ${h(e.passport_number||'—')} · ${fmtDate(e.passport_expiry)}</div></div>`}
   ${k==='car'?agreementsFor(e.id):''}</div>`).join('');
 }else if(k==='closed'){
  body=`<section class="panel"><h2 class="section-title">الاتفاقات المغلقة</h2><p class="hint">تبقى الاتفاقات قابلة للمراجعة بعد إغلاقها وأرشفة أصولها، حتى إن لم توجد حركات بعد التأسيس.</p>${agreements.map(a=>{const entity=entityById(a.entity_id);return `<div class="line row"><div class="grow"><div class="line-title">${h(a.title)}</div><div class="line-sub">${h(entity?.name||'دون أصل مرتبط')}${entity?.archived?' · أصل مؤرشف':''} · ${agreementLabel(a)}</div><div class="line-sub">أُغلق في ${formatRiyadhDate(a.closed_at)} · الإجمالي ${money(a.total_cents)} ر.س</div></div>${agreementButtons(a)}</div>`}).join('')}</section>`;
 }else{
  body=`<div class="panel"><h3 class="section-title">العمليات المجدولة في «أخرى»</h3>${agreements.filter(a=>a.kind==='other'&&a.status==='active').map(a=>`<div class="line row"><div class="grow"><div class="line-title">${h(a.title)}</div><div class="line-sub">إجمالي: ${money(a.total_cents)} ر.س · مدفوع سابقًا: ${money(a.opening_cents)} ر.س · ${a.installment_count} أقساط</div></div>${agreementButtons(a)}</div>`).join('')||'<div class="empty">لا توجد عمليات مجدولة</div>'}</div>
  <div class="panel"><h3 class="section-title">المصروفات المباشرة</h3>${records.expenses.map(e=>`<div class="line row"><div class="grow"><div class="line-title">${h(e.title)}</div><div class="line-sub">${fmtDate(e.paid_at)}${e.note?' · '+h(e.note):''}</div></div><div class="duevalue">${money(e.amount_cents)} ر.س</div>${expenseButtons(e)}</div>`).join('')||'<div class="empty">لا توجد مصروفات مباشرة</div>'}</div>`;
 }
 return `${heading('البيانات','تُسجل الأصول مرة واحدة، وتظل الأقساط والحركات مرتبطة بها')}
 <div class="panel data-toolbar"><div class="row"><div class="tabs" aria-label="نوع البيانات">${['property','car','worker','other','closed'].map(kind=>`<button type="button" aria-pressed="${k===kind}" class="btn ${k===kind?'active':''}" data-action="kind" data-id="${kind}">${categoryNames[kind]}</button>`).join('')}</div><button class="btn small" data-action="dataMode">${state.dataMode==='cards'?'عرض جدولي':'عرض البطاقات'}</button></div><div class="search-bar"><div class="field"><label for="data-search">البحث في ${categoryNames[k]}</label><input id="data-search" type="search" autocomplete="off" placeholder="الاسم، الرقم، الموقع أو العقد" value="${h(state.search)}"></div>${state.search?btn('مسح البحث','clearSearch','','small'):''}</div><p class="hint search-meta" role="status">${records.resultCount} سجل${state.search?' مطابق للبحث':''} من ${records.totalCount}</p></div>
 ${isAssistant()&&k!=='closed'?`<div class="row" style="margin-bottom:15px"><span class="hint">الإضافة من نموذج، والمراجعة والتعديل من جدول أو بطاقات</span>${btn('＋ إضافة '+categoryNames[k],k==='other'?'otherAdd':'entityAdd',k,'primary')}</div>`:''}
 ${records.resultCount===0?`<div class="empty">${state.search?'لا توجد سجلات مطابقة للبحث.':k==='closed'?'لا توجد اتفاقات مغلقة.':'لا توجد بيانات مسجلة حتى الآن.'}${state.search?'<div>'+btn('عرض جميع السجلات','clearSearch','','small')+'</div>':''}</div>`:state.dataMode==='table'?dataTable(k,records):(body||'<div class="empty">لا توجد بيانات مسجلة حتى الآن</div>')}`;
}
function agreementLabel(a){return `${{purchase:'شراء',sale:'بيع',rent:'إيجار',other:'أخرى'}[a.kind]||a.kind}`}
const detailLabels={name:'الاسم',title:'العنوان',kind:'النوع',status:'الحالة',direction:'الاتجاه',parent_id:'العقار التابع له',entity_id:'الأصل المرتبط',agreement_id:'الاتفاق',reference_value_cents:'القيمة المرجعية',location:'الموقع',electricity_meter:'عداد الكهرباء',plate:'رقم اللوحة',insurance_expiry:'انتهاء التأمين',maintenance_date:'موعد الصيانة',odometer_km:'الكيلومترات الحالية',maintenance_due_km:'الصيانة عند',phone:'رقم التواصل',work_location:'مكان العمل',iqama_number:'رقم الإقامة',iqama_expiry:'انتهاء الإقامة',passport_number:'رقم الجواز',passport_expiry:'انتهاء الجواز',notes:'ملاحظات',note:'ملاحظات',description:'التفاصيل',contract_number:'رقم العقد',counterparty:'الطرف المرتبط',start_date:'بداية العقد',end_date:'نهاية العقد',first_due_date:'أول استحقاق',due_date:'موعد التنفيذ',total_cents:'إجمالي القيمة',opening_cents:'المدفوع قبل التأسيس',installment_count:'عدد الأقساط',frequency_months:'الدورية بالأشهر',amount_cents:'المبلغ',paid_at:'تاريخ التنفيذ الفعلي',slot_index:'رقم القسط',reschedule_method:'طريقة الجدولة',active:'حالة الحركة',archived:'الأرشفة',state:'حالة المهمة',assigned_to:'المكلّف',completed_at:'وقت الإتمام',completed_by:'من أتم المهمة',dismissed:'متابعة التنبيه',hidden:'إخفاء من العرض'};
function detailValue(key,value){
 if(value===undefined||value===null||value==='')return '—';
 if(key.endsWith('_cents'))return money(value)+' ر.س';
 if(key==='slot_index')return String(Number(value)+1);
 if(key==='closed_at')return formatRiyadhDate(value);
 if(['entity_id','parent_id'].includes(key))return entityById(value)?.name||'سجل مرتبط / مؤرشف';
 if(key==='agreement_id')return agreementById(value)?.title||'اتفاق مرتبط';
 if(key==='active')return Number(value)===1?'سارية':'ملغاة';
 if(['archived','dismissed','hidden'].includes(key))return value?'نعم':'لا';
 const labels={property:'عقار',unit:'وحدة',car:'سيارة',worker:'عامل',purchase:'شراء',sale:'بيع',rent:'إيجار',other:'أخرى',in:'تحصيل',out:'سداد',active:'نشط',closed:'مغلق',cancelled:'ملغى',available:'متاحة',rented:'مؤجرة',maintenance:'صيانة',unavailable:'غير متاحة',shorten:'تقليل المدة',spread:'تقليل قيمة الأقساط',open:'مفتوحة',done:'مكتملة',manager:'المدير',assistant:'المساعد'};
 return ['kind','direction','status','reschedule_method','state','assigned_to'].includes(key)?labels[value]||String(value):String(value);
}
function recordGrid(record){return `<dl class="detail-grid">${Object.entries(record).filter(([k,v])=>detailLabels[k]&&v!==null&&v!==undefined&&v!=='').map(([k,v])=>`<div><dt>${h(detailLabels[k])}</dt><dd>${h(detailValue(k,k==='status'&&record.closed_at?'closed':v))}</dd></div>`).join('')}</dl>`}
Object.assign(detailLabels,{closed_at:'تاريخ الإغلاق',closed_by:'أغلقه'});
function openEntityDetails(id){const entity=entityById(id);if(!entity)return;showModal(entity.name,(entity.archived?'<div class="alert">أصل مؤرشف؛ بياناته المرجعية واتفاقاته محفوظة للمراجعة.</div>':'')+recordGrid(entity)+(entity.kind==='worker'?'':agreementsFor(id)))}
function agreementButtons(a){return `<div class="flex">${a.closed_at?'<span class="pill done">مغلق</span>':''}${btn('التفاصيل','agreementDetails',a.id,'small')}${isAssistant()&&!a.closed_at?btn('تعديل','agreementEdit',a.id,'small'):''}</div>`}
function expenseButtons(e){return `<div class="flex">${btn('التفاصيل','expenseDetails',e.id,'small')}${isAssistant()?btn('حذف','expenseVoid',e.id,'small danger'):''}</div>`}
function openExpenseDetails(id){const expense=state.data.expenses.find(e=>e.id===id);if(expense)showModal(expense.title,recordGrid(expense)+`<div class="form-actions">${isAssistant()?btn('حذف المصروف','expenseVoid',id,'danger'):''}</div>`)}
function openAgreementDetails(id){
 const a=agreementById(id);if(!a)return;
  state.agreementReturn=id;
  const payments=agreementPayments(state.data,id),dues=state.data.dues.filter(d=>d.agreement_id===id);
 const remaining=dues.reduce((sum,d)=>sum+d.amount_cents,0);
  const canClose=!a.closed_at&&remaining===0&&(a.kind!=='rent'||a.end_date<state.data.today),archivedOrigin=Boolean(a.entity_id&&entityById(a.entity_id)?.archived);
  showModal(a.title,`${a.closed_at?`<div class="alert">اتفاق مغلق منذ ${formatRiyadhDate(a.closed_at)}${a.closed_by?' بواسطة '+h(a.closed_by):''}. ${archivedOrigin?'الأصل مؤرشف، وتبقى البيانات محفوظة للمراجعة.':'يلزم إعادة فتحه قبل تصحيح أي حركة.'}</div>`:''}<div class="ledger-rows agreement-summary">${ledgerRow('المتبقي',remaining,'وفق الجدول الحالي')}${ledgerRow('منفذ بعد التأسيس',payments.reduce((sum,p)=>sum+p.amount_cents,0),'حركات مسجلة فعليًا','good')}</div>${recordGrid(a)}
  <section class="agreement-payments"><h3 class="section-title">الحركات المنفذة عبر كل الأشهر (${payments.length})</h3>${payments.length?payments.map(p=>`<div class="line row"><div class="grow"><div class="line-title">${fmtDate(p.paid_at)} · القسط ${Number(p.slot_index)+1}</div><div class="line-sub">${h(p.note||'دون ملاحظات')}${p.created_by?' · '+h(p.created_by):''}</div></div><div class="duevalue">${money(p.amount_cents)} ر.س</div>${isAssistant()&&!a.closed_at?`<div class="flex">${btn('تعديل','payEdit',p.id,'small')}${btn('حذف','payVoid',p.id,'small danger')}</div>`:''}</div>`).join(''):'<div class="empty">لم تسجل حركات بعد تأسيس المحفظة على هذا الاتفاق.</div>'}<p class="hint">الحركات السارية فقط؛ يبقى أثر التصحيح والحذف في سجل العمليات.</p></section>
  <h3 class="section-title section">الاستحقاقات المتبقية</h3>${dues.length?dues.map(dueItem).join(''):'<div class="empty">لا توجد مبالغ متبقية على هذا الجدول.</div>'}
  ${isAssistant()?`<div class="form-actions">${a.closed_at?!archivedOrigin?btn('إعادة فتح الاتفاق','agreementReopen',id,'primary'):'':canClose?btn('إغلاق الاتفاق المسدد','agreementClose',id,'primary'):''}${!a.closed_at&&!payments.length?btn('إلغاء الجدول','agreementCancel',id,'danger'):''}</div>${a.closed_at&&archivedOrigin?'<p class="hint">لا يمكن إعادة فتح اتفاق مرتبط بأصل مؤرشف.</p>':''}${!a.closed_at&&remaining===0&&a.kind==='rent'&&!canClose?'<p class="hint">يمكن إغلاق عقد الإيجار بعد انتهاء مدته وتسوية كامل رصيده.</p>':''}${canClose?'<p class="hint">الإغلاق يحفظ الحركات ويتيح أرشفة الأصل عندما لا تبقى روابط نشطة أخرى.</p>':''}`:''}`);
}
function openStatement(){
 if(state.loading||state.error)throw new Error('انتظر اكتمال تحديث الشهر قبل فتح الكشف');
 state.statement=buildMonthStatement(state.data);
 showModal('كشف شهر '+state.statement.month,`<div class="statement-toolbar screen-only">${btn('طباعة الكشف','statementPrint','','primary')}${btn('تصدير الحركات CSV','statementCSV')}</div>${statementHTML(state.statement)}`);
}
function exportStatement(){
 if(!state.statement)throw new Error('افتح كشف الشهر أولًا');
 const blob=new Blob([statementCSV(state.statement)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=url;link.download=`mahfazati-transactions-${state.statement.month}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('تم تصدير الحركات المنفذة خلال الشهر');
}
function auditChanges(before,after){
 const keys=Object.keys(after||before||{}).filter(k=>detailLabels[k]&&(before?.[k]!==after?.[k])&&[before?.[k],after?.[k]].some(v=>v!==undefined&&v!==null&&v!==''));
 if(!keys.length)return '';
 return `<details class="audit-details"><summary>عرض تفاصيل العملية</summary><div class="tablewrap"><table class="tbl"><thead><tr><th scope="col">الحقل</th><th scope="col">قبل</th><th scope="col">بعد</th></tr></thead><tbody>${keys.map(k=>`<tr><th scope="row">${h(detailLabels[k])}</th><td>${h(detailValue(k,before?.[k]))}</td><td>${h(detailValue(k,after?.[k]))}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function agreementsFor(entityId){const a=state.data.agreements.filter(x=>x.entity_id===entityId&&x.status==='active');
 return a.length?`<div class="section"><h4 class="smalltitle">العقود والعمليات</h4>${a.map(x=>`<div class="line row"><div class="grow"><div class="line-title">${h(x.title)} <span class="tag">${agreementLabel(x)}</span></div><div class="line-sub">${x.contract_number?'رقم العقد: '+h(x.contract_number)+' · ':''}${money(x.total_cents)} ر.س · أول قسط: ${fmtDate(x.first_due_date)}</div></div>${agreementButtons(x)}</div>`).join('')}</div>`:'';
}
function currentUnitStatus(unit){const a=state.data.agreements.find(a=>a.entity_id===unit.id&&a.kind==='rent'&&a.status==='active'&&!a.closed_at&&a.start_date<=state.data.today&&a.end_date>=state.data.today);return a?'rented':unit.status}
function renderUnit(u){return `<div class="line row"><div class="grow"><div class="line-title">${h(u.name)} <span class="tag">${{available:'متاحة',rented:'مؤجرة',maintenance:'صيانة',unavailable:'غير متاحة'}[currentUnitStatus(u)]||'متاحة'}</span></div>${u.notes?`<div class="line-sub">${h(u.notes)}</div>`:''}${agreementsFor(u.id)}</div>${entityButtons(u)}</div>`}
function entityButtons(e){
 const details=btn('التفاصيل','entityDetails',e.id,'small');if(!isAssistant()||e.archived)return details;
 const act=e.kind==='worker'?'':btn('＋ '+(e.kind==='unit'?'عقد/عملية':'شراء/بيع'),'agreementAdd',e.id,'small');
 return `<div class="flex">${details}${act}${btn('تعديل','entityEdit',e.id,'small')}${btn('أرشفة','entityDelete',e.id,'small danger')}</div>`;
}
let returnFocus=null;
function showModal(title,content){
  if(state.loading)throw new Error('انتظر اكتمال تحديث البيانات قبل فتح هذا العرض.');
 if(modalRoot.hidden)returnFocus=document.activeElement;
 content=content.replace(/(<form\b[^>]*>)([\s\S]*?)(<\/form>)/g,'$1<fieldset>$2</fieldset>$3');
 modalRoot.hidden=false;root.inert=true;document.body.style.overflow='hidden';
 modalRoot.innerHTML=`<div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title" tabindex="-1"><div class="modal-head"><h2 id="modal-title">${h(title)}</h2><button class="iconbtn" type="button" aria-label="إغلاق" data-action="modalClose">×</button></div><div class="modal-content">${content}</div></div>`;
 const first=modalRoot.querySelector('input:not([type=hidden]):not(:disabled),select:not(:disabled)')||modalRoot.querySelector('.modal-card');first?.focus();
}
function closeModal(force=false){
 const form=modalRoot.querySelector('form:not(#history-form)');
 if(!force&&form?.dataset.saving==='1')return;
  if(!force&&(form?.dataset.dirty==='1'||form?.dataset.uncertain==='1')&&globalThis.confirm?.(form.dataset.uncertain==='1'?'لم يصل تأكيد الحفظ. يفضل إعادة المحاولة بالبيانات نفسها قبل الإغلاق. إغلاق النموذج؟':'إغلاق النموذج وترك التعديلات غير المحفوظة؟')===false)return;
  state.history.request++;state.agreementReturn=null;state.statement=null;modalRoot.hidden=true;modalRoot.innerHTML='';root.inert=false;document.body.style.overflow='';
 if(returnFocus?.isConnected)returnFocus.focus();else root.querySelector('[aria-current=page]')?.focus();
}
function field(label,name,value='',type='text',desc='',required=false){
 const integer=['count','odometer_km','maintenance_due_km'].includes(name),max=name==='phone'?50:name==='notes'?1500:['note','description'].includes(name)?1200:255;
 const numeric=type==='number'?`min="${name==='count'?1:0}" ${name==='count'?'max="600"':''} step="${integer?'1':'0.01'}" inputmode="${integer?'numeric':'decimal'}"`:'';
 const date=type==='date'?'min="1000-01-01" max="9999-12-31"':'';
 return `<div class="field"><label for="field-${h(name)}">${h(label)}${required?' <span aria-hidden="true">*</span>':''}</label>${type==='textarea'?`<textarea id="field-${h(name)}" name="${h(name)}" maxlength="${max}" ${required?'required':''} ${desc?`aria-describedby="help-${h(name)}"`:''}>${h(value)}</textarea>`:`<input id="field-${h(name)}" name="${h(name)}" type="${type}" value="${h(value??'')}" ${numeric} ${date} ${['text','tel'].includes(type)?`maxlength="${max}"`:''} ${required?'required':''} ${desc?`aria-describedby="help-${h(name)}"`:''}/>`}${desc?`<span id="help-${h(name)}" class="description">${h(desc)}</span>`:''}</div>`;
}
function formButtons(title='حفظ'){return `<div class="form-error" role="alert" tabindex="-1"></div><div class="form-actions"><button type="button" class="btn" data-action="modalClose">إلغاء</button><button type="submit" class="btn primary">${title}</button></div>`}
function opt(items,value=''){return items.map(([k,v])=>`<option value="${h(k)}" ${String(k)===String(value)?'selected':''}>${h(v)}</option>`).join('')}
function openEntityForm(kind,id=null,parent=null){const e=id?entityById(id):null;if(!e&&!['property','unit','car','worker'].includes(kind))return;
 const fields=kind==='property'?`${field('اسم العقار','name',e?.name,'text','مثل عمارة الياسمين',true)}${field('الموقع','location',e?.location)}${field('رقم عداد الكهرباء','electricity_meter',e?.electricity_meter)}${field('قيمة العقار المرجعية بالريال','reference_value_cents',e?.reference_value_cents!=null?toInput(e.reference_value_cents):'','number','لا تدخل تلقائيًا في التحصيل أو السداد')}`:
 kind==='unit'?`${field('اسم الوحدة','name',e?.name,'text','مثل شقة 1 أو محل 3',true)}${!e?`<div class="field"><label for="field-parent_id">تتبع لعقار (اختياري)</label><select id="field-parent_id" name="parent_id">${opt([['','وحدة مستقلة'],...state.data.entities.filter(x=>x.kind==='property').map(x=>[x.id,x.name])],parent)}</select></div>`:''}<div class="field"><label for="field-status">حالة الوحدة</label><select id="field-status" name="status">${opt([['available','متاحة'],['rented','مؤجرة'],['maintenance','صيانة'],['unavailable','غير متاحة']],e?.status||'available')}</select></div><div class="grid">${field('رقم عداد الكهرباء (اختياري)','electricity_meter',e?.electricity_meter)}${field('القيمة المرجعية (اختياري)','reference_value_cents',e?.reference_value_cents!=null?toInput(e.reference_value_cents):'','number','معلومة مرجعية لا تدخل في الحسابات')}</div>`:
 kind==='car'?`${field('اسم السيارة','name',e?.name,'text','مثل كامري 2025',true)}${field('رقم اللوحة','plate',e?.plate)}${field('القيمة المرجعية بالريال','reference_value_cents',e?.reference_value_cents!=null?toInput(e.reference_value_cents):'','number')}
 <div class="grid">${field('انتهاء التأمين','insurance_expiry',e?.insurance_expiry,'date')}${field('موعد الصيانة القادمة','maintenance_date',e?.maintenance_date,'date')}${field('الكيلومترات الحالية','odometer_km',e?.odometer_km,'number')}${field('الصيانة عند كم كيلومتر','maintenance_due_km',e?.maintenance_due_km,'number')}</div>`:
 `${field('اسم العامل','name',e?.name,'text','',true)}<div class="grid">${field('رقم التواصل','phone',e?.phone,'tel')}${field('مكان العمل','work_location',e?.work_location)}${field('رقم الإقامة','iqama_number',e?.iqama_number)}${field('انتهاء الإقامة','iqama_expiry',e?.iqama_expiry,'date')}${field('رقم الجواز','passport_number',e?.passport_number)}${field('انتهاء الجواز','passport_expiry',e?.passport_expiry,'date')}</div>`;
 showModal((e?'تعديل ':'إضافة ')+categoryNames[kind],`<form id="entity-form" data-id="${h(id||'')}" data-kind="${h(kind)}" data-version="${e?.version??0}">${fields}${field('ملاحظات (اختياري)','notes',e?.notes,'textarea')}${formButtons()}</form>`);
}
function openAgreementForm(kind,entityId=null,id=null){const a=id?agreementById(id):null;
  if(a?.closed_at)return notify('أعد فتح الاتفاق من التفاصيل قبل تعديله.',true);
 if(!a&&!kind){const e=entityById(entityId);const options=e?.kind==='unit'?[['rent','إيجار'],['purchase','شراء'],['sale','بيع']]:[['purchase','شراء'],['sale','بيع']];
 return showModal('إضافة عقد أو عملية',`<p class="hint">حدد نوع العملية المرتبطة بـ ${h(e?.name)}</p><div class="stack">${options.map(([k,v])=>`<button class="btn block" data-action="agreementType" data-id="${h(k)}::${h(entityId)}">${v}</button>`).join('')}</div>`)}
 const k=a?.kind||kind,entity=entityById(a?.entity_id||entityId),hasPays=a&&state.data.payments.some(p=>p.agreement_id===a.id);
 showModal((a?'تعديل ':'إضافة ')+({purchase:'شراء',sale:'بيع',rent:'إيجار',other:'عملية مجدولة'}[k]),
 `<form id="agreement-form" data-id="${h(id||'')}" data-kind="${h(k)}" data-entity="${h(entity?.id||'')}" data-version="${a?.version??0}">
 <div class="alert">${k==='rent'?'يمكن إنشاء عقد لشهر واحد ودفعة واحدة. رقم العقد نص فقط دون إرفاق مستند.':k==='other'?'عملية مالية مجدولة ضمن «أخرى»، وتُسجل في السداد.':'شراء يُولد سدادًا، وبيع يُولد تحصيلًا. قيمة الأصل نفسها لا تُحسب كحركة نقدية.'}</div>
 ${entity?`<p class="hint" style="margin:12px 0">الأصل المرتبط: <strong>${h(entity.name)}</strong></p>`:''}
 ${field('اسم العملية أو العقد','title',a?.title||([k==='rent'?'إيجار':k==='purchase'?'شراء':k==='sale'?'بيع':'قسط',entity?.name||''].join(' ').trim()),'text','',true)}
 ${k==='rent'?`<div class="grid">${field('رقم عقد الإيجار','contract_number',a?.contract_number,'text','رقم فقط دون رفع العقد')}${field('اسم المستأجر','counterparty',a?.counterparty)}${field('رقم التواصل','phone',a?.phone,'tel')}${field('بداية العقد','start_date',a?.start_date,'date','',true)}${field('نهاية العقد','end_date',a?.end_date,'date','',true)}</div>`:`${field('الطرف المرتبط (اختياري)','counterparty',a?.counterparty)}`}
 <div class="grid">${field('إجمالي القيمة (ر.س)','total',a?toInput(a.total_cents):'','number','',true)}${field(k==='sale'||k==='rent'?'المحصّل قبل تأسيس المحفظة':'المدفوع قبل تأسيس المحفظة','opening',a?toInput(a.opening_cents):'0','number','لا يُحسب ضمن حركات الشهر')}</div>
 <div class="grid">${field('عدد الأقساط','count',a?.installment_count||1,'number','1 لدفعة واحدة',true)}<div class="field"><label for="field-frequency">دورية الأقساط</label><select id="field-frequency" name="frequency">${opt([['1','شهريًا'],['3','كل 3 أشهر'],['6','كل 6 أشهر'],['12','سنويًا']],a?.frequency_months||1)}</select></div>${field('موعد أول قسط','first_due_date',a?.first_due_date||state.data.today,'date','',true)}</div>
 ${field('ملاحظات (اختياري)','note',a?.note,'textarea')}
 ${hasPays?'<div class="alert warn">بدأ تنفيذ هذا الجدول؛ يمكنك تعديل البيانات الوصفية فقط. لا تُستبدل الأرقام التاريخية بعد التنفيذ.</div>':''}${formButtons()}</form>`);
 if(hasPays)for(const name of ['total','opening','count','frequency','first_due_date','start_date','end_date']){
   const input=document.getElementById('agreement-form').elements[name];if(input){input.disabled=true;input.title='ثابت بعد تسجيل دفعات'}
 }
}
function openExpense(){showModal('تسجيل مصروف مباشر',`<div class="alert">مثل مبلغ صُرف على السفر بالفعل؛ يسجل بتاريخ الصرف الفعلي دون جدول أقساط.</div><form id="expense-form">${field('وصف المصروف','title','','text','مصاريف سفر، صيانة...',true)}<div class="grid">${field('المبلغ المصروف فعليًا (ر.س)','amount','','number','',true)}${field('تاريخ الصرف','paid_at',state.data.today,'date','',true)}</div><div class="field"><label for="field-entity_id">ربط المصروف بأصل (اختياري)</label><select id="field-entity_id" name="entity_id">${opt([['','بدون ربط'],...state.data.entities.filter(x=>x.kind!=='worker').map(x=>[x.id,x.name])])}</select></div>${field('ملاحظات','note','','textarea')}${formButtons('تسجيل المصروف')}</form>`)}
function openOther(){showModal('إضافة في «أخرى»',`<div class="stack"><button class="btn block" data-action="otherScheduled">عملية مجدولة (مثل هاتف بالأقساط)</button><button class="btn block" data-action="otherDirect">مصروف مباشر (تم صرفه فعليًا)</button></div>`)}
function openQuick(){showModal('إضافة جديدة',`<div class="grid">${[['property','🏢 عقار'],['unit','▤ وحدة'],['car','🚙 سيارة'],['worker','👤 عامل'],['other','↗ أخرى'],['task','☑ مهمة شخصية']].map(([k,label])=>`<button class="btn" data-action="quickType" data-id="${k}">${label}</button>`).join('')}</div>`)}
function dueForKey(key){const [id,slot]=key.split('::');return state.data.dues.find(d=>d.agreement_id===id&&d.slot===Number(slot))}
function openPayment(key,paymentId){let d=null,p=null;
 if(paymentId){p=state.data.payments.find(x=>x.id===paymentId);if(!p)return notify('الحركة غير موجودة؛ حدّث البيانات',true);d={agreement_id:p.agreement_id,slot:p.slot_index,amount_cents:state.data.payment_contexts?.[p.id]?.expected_cents??p.amount_cents};}
 else d=dueForKey(key);
 if(!d)return notify('الاستحقاق غير موجود أو تم تنفيذه',true);
  const a=agreementById(d.agreement_id);if(a?.closed_at)return notify('أعد فتح الاتفاق من التفاصيل قبل تصحيح حركاته.',true);const actual=p?p.amount_cents:d.amount_cents;
 showModal(p?'تعديل حركة مالية':`تأكيد ${a.direction==='in'?'التحصيل':'السداد'}`,
 `<div class="alert"><strong>${h(a.title)}</strong><div>موعد الاستحقاق: ${p?fmtDate(state.data.payment_contexts?.[p.id]?.due_date):fmtDate(state.data.dues.find(x=>x.agreement_id===a.id&&x.slot===d.slot)?.due_date)} · المبلغ المتوقع: ${money(d.amount_cents)} ر.س</div></div>
 <form id="payment-form" data-id="${h(paymentId||'')}" data-agreement="${h(a.id)}" data-slot="${d.slot}" data-expected="${d.amount_cents}" data-version="${a.version}">
 <div class="grid">${field('المبلغ الفعلي (ر.س)','amount',toInput(actual),'number','',true)}${field('تاريخ التنفيذ الفعلي','paid_at',p?.paid_at||state.data.today,'date','',true)}</div>
 <div id="overpay" style="display:${Number(actual)>d.amount_cents?'block':'none'}"><div class="alert warn">المبلغ أعلى من القسط المختار. اختر كيف يُعدل النظام جدول الأقساط القادمة.</div><div class="form-choice"><label><input type="radio" name="reschedule_method" value="shorten" ${p?.reschedule_method==='shorten'?'checked':''}> تقليل المدة</label><label><input type="radio" name="reschedule_method" value="spread" ${p?.reschedule_method==='spread'?'checked':''}> تقليل قيمة الأقساط</label></div></div>
 ${field('ملاحظات','note',p?.note,'textarea')}${formButtons(p?'حفظ التعديل':'تأكيد التنفيذ')}</form>`);
  const input=modalRoot.querySelector('input[name="amount"]');input.addEventListener('input',()=>{let amount;try{amount=inputCents(input.value)}catch{amount=0}modalRoot.querySelector('#overpay').style.display=amount>d.amount_cents?'block':'none'});
}
function openTaskForm(){showModal(isAssistant()?'مهمة شخصية':'مهمة جديدة للمساعد',`<form id="task-form">${field('عنوان المهمة','title','','text','',true)}${field('تاريخ التنفيذ','due_date',state.data.today,'date')}${field('التفاصيل','description','','textarea')}${formButtons('حفظ المهمة')}</form>`)}
function openTasks(){const list=state.data.tasks;
 showModal('المهام',`${role()==='manager'?'<div class="row"><p class="hint">المهام التي أسندها المدير للمساعد</p>'+btn('＋ مهمة للمساعد','taskAdd')+'</div>':'<div class="row"><p class="hint">المهام اليدوية</p>'+btn('＋ مهمة شخصية','taskAdd')+'</div>'}<div class="section">${list.length?list.map(taskItem).join(''):'<div class="empty">لا توجد مهام</div>'}</div>`)}
function openAlerts(){showModal('التنبيهات والمتابعات',`<p class="hint">«تمت المتابعة» يخفي هذا التنبيه بعد مراجعته؛ لا يغيّر بيانات السجل ولا يؤكد حركة مالية.</p><div class="stack"><h3 class="section-title">التنبيهات الإدارية</h3>${state.data.alerts.length?state.data.alerts.map(alertItem).join(''):'<div class="empty">لا توجد تنبيهات</div>'}<h3 class="section-title">الاستحقاقات القريبة</h3>${state.data.dues.filter(x=>x.due_date<=plusDays(state.data.today,14)).map(dueItem).join('')||'<div class="empty">لا توجد استحقاقات قريبة</div>'}</div>`)}
function historyEntry(a){
 const types={entity:'بيانات',agreement:'عقد / التزام',payment:'حركة مالية',expense:'مصروف',task:'مهمة',alert:'تنبيه',audit:'سجل العمليات'};
 let before=null,after=null;try{before=JSON.parse(a.before_json||'null');after=JSON.parse(a.after_json||'null')}catch{}
 const detail=after||before||{};
 const when=new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{dateStyle:'medium',timeStyle:'short',timeZone:'Asia/Riyadh'}).format(new Date(a.created_at));
 return `<div class="line history-entry"><div class="grow"><div class="line-title">${h(a.action)} <span class="tag">${h(types[a.target_type]||a.target_type)}</span></div>${detail.title||detail.name?`<div>${h(detail.title||detail.name)}</div>`:''}<div class="line-sub overflow">${h(a.actor)}</div><time class="line-sub" datetime="${h(a.created_at)}">${h(when)}</time>${auditChanges(before,after)}</div>${role()==='manager'&&!state.demo?btn('إزالة من العرض','historyHide',a.id,'small danger'):''}</div>`;
}
function renderHistoryResults(){
 const container=document.getElementById('history-results');if(!container)return;
 const s=state.history;
 const period=s.from||s.to?`${s.from?'من '+fmtDate(s.from):'من بداية السجل'} — ${s.to?'إلى '+fmtDate(s.to):'حتى آخر عملية'}`:'كل الفترات';
 container.setAttribute('aria-busy',String(s.loading));
 container.innerHTML=`<div class="history-summary"><strong>${s.entries.length} عملية معروضة</strong><span>${h(period)} · ${s.sort==='newest'?'الأحدث أولًا':'الأقدم أولًا'}</span></div>
 ${s.error?`<div class="alert warn" role="alert">${h(s.error)} ${btn('إعادة المحاولة','historyRetry','','small')}</div>`:''}
 ${s.entries.length?s.entries.map(historyEntry).join(''):s.loading?'<div class="empty">جارٍ تحميل العمليات…</div>':s.error?'':'<div class="empty">لا توجد عمليات ضمن الفترة المحددة.</div>'}
 ${s.entries.length&&s.loading?'<p class="hint">جارٍ تحميل المزيد…</p>':''}
 ${s.hasMore&&!s.loading?`<div class="history-more">${btn('عرض المزيد','historyMore','','block')}<p class="hint">توجد عمليات إضافية ضمن الفترة نفسها</p></div>`:''}`;
}
async function loadHistory(more=false){
 const s=state.history;if(more&&(s.loading||!s.cursor))return;
 const request=++s.request;
 s.loading=true;s.error='';
 if(!more){s.entries=[];s.cursor=null;s.hasMore=false}
 renderHistoryResults();
 const params=new URLSearchParams({from:s.from,to:s.to,sort:s.sort});
 if(more)params.set('cursor',s.cursor);
 try{
   const result=state.demo?filterHistory(globalThis.mahfazatiPreview.history(),parseHistoryFilters(params)):await api('/api/history?'+params);
   if(request!==s.request||!document.getElementById('history-form'))return;
   s.entries=more?[...new Map([...s.entries,...result.entries].map(x=>[x.id,x])).values()]:result.entries;
   s.cursor=result.next_cursor;s.hasMore=result.has_more;
 }catch(error){if(request===s.request)s.error=error.message}
 finally{if(request===s.request){s.loading=false;renderHistoryResults()}}
}
function openHistory(){
 const s=state.history;
 showModal('سجل العمليات',`<p class="hint">الفلترة حسب وقت تسجيل الإضافة أو التعديل أو الحذف، بتوقيت الرياض، وتشمل يومَي البداية والنهاية.</p>
 ${state.demo?'<div class="alert history-note">بيانات توضيحية لتجربة الفلترة؛ لا تُحفظ أي تغييرات.</div>':''}
 <form id="history-form" class="history-form">
 <div class="grid"><div class="field"><label for="history-period">الفترة</label><select id="history-period" name="period">${opt([['all','كل الفترات'],['today','اليوم'],['week','آخر 7 أيام'],['month','هذا الشهر حتى اليوم'],['year','هذا العام حتى اليوم'],['custom','فترة مخصصة']],s.preset)}</select></div>
 <div class="field"><label for="history-sort">ترتيب العمليات</label><select id="history-sort" name="sort">${opt([['newest','الأحدث أولًا'],['oldest','الأقدم أولًا']],s.sort)}</select></div></div>
 <div class="grid"><div class="field"><label for="history-from">من تاريخ</label><input id="history-from" name="from" type="date" min="1000-01-01" max="9999-12-31" value="${h(s.from)}"></div><div class="field"><label for="history-to">إلى تاريخ</label><input id="history-to" name="to" type="date" min="1000-01-01" max="9999-12-31" value="${h(s.to)}"></div></div>
 <p id="history-validation" class="history-validation" role="alert"></p>
 <div class="history-actions"><button type="submit" class="btn primary">تطبيق الفترة</button>${btn('إعادة ضبط','historyReset')}</div></form>
 <p class="hint history-note">يبقى أثر العمليات محفوظًا في سجل التدقيق عند إزالتها من العرض بواسطة المدير.</p>
 <div id="history-results" aria-live="polite"></div>`);
 return loadHistory();
}
function applyHistoryFilters(form){
 const data=formData(form),validation=document.getElementById('history-validation');
 try{
   const parsed=parseHistoryFilters(new URLSearchParams({from:data.from,to:data.to,sort:data.sort}));
   Object.assign(state.history,{from:parsed.from,to:parsed.to,sort:parsed.sort,preset:data.period});
   validation.textContent='';
   return loadHistory();
 }catch(error){validation.textContent=error.message}
}
function formData(form){return Object.fromEntries(new FormData(form).entries())}
async function doSave(form){
 if(form.dataset.saving==='1')return;
 const id=form.dataset.id,kind=form.dataset.kind,obj=formData(form);let url,method='POST';
 if(form.id==='entity-form'){if(!id){obj.kind=kind;url='/api/entities'}else{url=`/api/entities/${id}`;method='PATCH'}}
 else if(form.id==='agreement-form'){if(!id){obj.kind=kind;obj.entity_id=form.dataset.entity||null;url='/api/agreements'}else{url=`/api/agreements/${id}`;method='PATCH'}}
 else if(form.id==='expense-form')url='/api/expenses';
 else if(form.id==='task-form')url='/api/tasks';
 else if(form.id==='payment-form'){
   obj.slot=Number(form.dataset.slot);
   if(inputCents(obj.amount)>Number(form.dataset.expected)&&!obj.reschedule_method)throw new Error('اختر طريقة إعادة جدولة المبلغ الزائد');
   if(!obj.reschedule_method)obj.reschedule_method=null;
   if(!id)url=`/api/agreements/${form.dataset.agreement}/payments`;else{url=`/api/payments/${id}`;method='PATCH'}
 }else return;
 if(id||form.id==='payment-form')obj.expected_version=Number(form.dataset.version??agreementById(form.dataset.agreement)?.version);
 const fingerprint=JSON.stringify(obj);
 if(form.dataset.uncertain==='1'&&form.dataset.requestPayload!==fingerprint)throw new Error('لم تتأكد نتيجة الإرسال السابق. أعد البيانات السابقة وأرسلها لتأكيد النتيجة، ثم عدّل السجل المحفوظ.');
 form.dataset.requestPayload=fingerprint;form.dataset.saving='1';
 const submit=form.querySelector('button[type=submit]'),fieldset=form.querySelector('fieldset');
 if(submit)submit.disabled=true;if(fieldset)fieldset.disabled=true;form.setAttribute?.('aria-busy','true');
 try{
   await api(url,method,obj);delete form.dataset.uncertain;delete form.dataset.dirty;const returnAgreement=state.agreementReturn;closeModal(true);
   const refreshed=await reload();if(refreshed&&returnAgreement&&agreementById(returnAgreement)?.status==='active')openAgreementDetails(returnAgreement);
   const message=form.id==='payment-form'?`تم حفظ ${money(inputCents(obj.amount))} ر.س بتاريخ ${fmtDate(obj.paid_at)}. المتبقي على الاتفاق: ${money(state.data.dues.filter(d=>d.agreement_id===form.dataset.agreement).reduce((sum,d)=>sum+d.amount_cents,0))} ر.س`:'تم الحفظ وتحديث المحفظة وسجل العمليات';
   notify(refreshed?message:'تم الحفظ. تعذر تحديث العرض؛ اضغط تحديث البيانات.',!refreshed);
 }catch(error){if(error.uncertain)form.dataset.uncertain='1';else delete form.dataset.uncertain;throw error}
 finally{delete form.dataset.saving;if(submit)submit.disabled=false;if(fieldset)fieldset.disabled=false;form.setAttribute?.('aria-busy','false')}
}
document.addEventListener('submit',async e=>{
 if(!e.target.matches('#modal form'))return;e.preventDefault();
 if(e.target.id==='history-form')return applyHistoryFilters(e.target);
 const errorBox=e.target.querySelector('.form-error');if(errorBox)errorBox.innerHTML='';
 try{await doSave(e.target)}catch(err){
   if(errorBox){errorBox.innerHTML=`${h(err.message)}${err.code===409?'<div>'+btn('تحديث البيانات وإغلاق النموذج','refreshForm','','small')+'</div>':''}`;errorBox.focus()}else notify(err.message,true);
 }
});
document.addEventListener('click',async e=>{
 const b=e.target.closest('[data-action]');if(!b)return;
 const action=b.dataset.action,id=b.dataset.id;if(b.dataset.busy==='1')return;
 b.dataset.busy='1';if(['backup','entityDelete','agreementCancel','agreementClose','agreementReopen','payVoid','expenseVoid','taskToggle','alertDismiss','historyHide'].includes(action))b.disabled=true;
 try{
  if(action==='reload')return await reload();
  if(action==='refreshForm'){closeModal(true);return await reload()}
  if(action==='moreDues'){state.visibleDues+=20;render();return}
  if(action==='dueScope'){state.dueScope=id;render();return}
  if(action==='entityDetails')return openEntityDetails(id);
  if(action==='expenseDetails')return openExpenseDetails(id);
  if(action==='agreementDetails')return openAgreementDetails(id);
  if(action==='statement')return openStatement();
  if(action==='statementCSV')return exportStatement();
  if(action==='statementPrint'){if(!state.statement)return;document.body.classList.add('printing-statement');globalThis.addEventListener('afterprint',()=>document.body.classList.remove('printing-statement'),{once:true});try{globalThis.print()}catch(error){document.body.classList.remove('printing-statement');throw error}return}
  if(action==='modalClose'){closeModal();return}
  if(action==='page'){state.page=id;state.filter='all';render();return}
  if(action==='kind'){state.kind=id;state.search='';render();return}
  if(action==='dataMode'){state.dataMode=state.dataMode==='table'?'cards':'table';render();return}
  if(action==='clearSearch'){state.search='';render();document.getElementById('data-search')?.focus();return}
  if(action==='filter'){state.filter=id;render();return}
  if(action==='quickadd')return openQuick();
  if(action==='quickType'){if(id==='other')return openOther();if(id==='task')return openTaskForm();return openEntityForm(id)}
  if(action==='entityAdd'){const [kind,parent]=id.split('::');return openEntityForm(kind,null,parent||null)}
  if(action==='entityEdit'){const ent=entityById(id);return openEntityForm(ent.kind,id)}
  if(action==='otherAdd')return openOther();
  if(action==='otherScheduled')return openAgreementForm('other');
  if(action==='otherDirect')return openExpense();
  if(action==='agreementAdd')return openAgreementForm(null,id);
  if(action==='agreementType'){const [kind,entityId]=id.split('::');return openAgreementForm(kind,entityId)}
  if(action==='agreementEdit'){return openAgreementForm(null,null,id)}
  if(action==='payConfirm')return openPayment(id,null);
  if(action==='payEdit')return openPayment(null,id);
  if(action==='taskAdd')return openTaskForm();
  if(action==='tasks')return openTasks();
  if(action==='alerts')return openAlerts();
  if(action==='history')return await openHistory();
  if(action==='historyMore')return await loadHistory(true);
  if(action==='historyRetry')return await loadHistory(state.history.entries.length>0&&!!state.history.cursor);
  if(action==='historyReset'){Object.assign(state.history,{from:'',to:'',sort:'newest',preset:'all'});return await openHistory()}
  if(action==='backup'){
    if(state.demo)throw new Error('لا توجد نسخة احتياطية في المعاينة');
    if(!confirm('النسخة الاحتياطية تحتوي على بيانات مالية وشخصية حساسة. احفظ الملف في مكان آمن. هل تريد تصديرها؟'))return;
    const res=await fetch('/api/backup');if(!res.ok)throw new Error('فشل تصدير النسخة الاحتياطية');
    const blob=await res.blob(),u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=`mahfazati-backup-${state.data.today}.json`;a.click();URL.revokeObjectURL(u);notify('تم تصدير ملف النسخة الاحتياطية');return;
  }
  const apiAction=async(url,method,payload,message)=>{await api(url,method,payload);const returnAgreement=state.agreementReturn;closeModal(true);const refreshed=await reload();if(refreshed&&returnAgreement&&agreementById(returnAgreement)?.status==='active')openAgreementDetails(returnAgreement);notify(refreshed?message:message+'؛ تعذر تحديث العرض. اضغط تحديث البيانات.',!refreshed)};
  if(action==='entityDelete'){if(confirm('أرشفة السجل وإزالته من القوائم؟ يبقى تاريخه محفوظًا. يجب معالجة الوحدات والجداول النشطة المرتبطة أولًا.'))await apiAction('/api/entities/'+id,'DELETE',{expected_version:entityById(id).version},'تمت أرشفة السجل');return}
  if(action==='agreementCancel'){if(confirm('إلغاء الجدول؟ ستُزال استحقاقاته المستقبلية ويبقى أثر الإلغاء في السجل.'))await apiAction('/api/agreements/'+id,'DELETE',{expected_version:agreementById(id).version},'تم إلغاء الجدول');return}
  if(action==='agreementClose'){if(confirm('إغلاق الاتفاق المسدد؟ تبقى حركاته محفوظة، ويلزم إعادة فتحه قبل أي تصحيح.'))await apiAction('/api/agreements/'+id+'/close','POST',{expected_version:agreementById(id).version},'تم إغلاق الاتفاق مع حفظ حركاته');return}
  if(action==='agreementReopen'){if(confirm('إعادة فتح الاتفاق؟ يجب أن يكون أصله متاحًا وألا يتعارض الإيجار مع عقد آخر.'))await apiAction('/api/agreements/'+id+'/reopen','POST',{expected_version:agreementById(id).version},'تمت إعادة فتح الاتفاق');return}
  if(action==='payVoid'){if(confirm('حذف الحركة؟ سيعاد حساب جميع الأقساط المرتبطة تلقائيًا.'))await apiAction('/api/payments/'+id,'DELETE',{expected_version:agreementById(state.data.payments.find(p=>p.id===id).agreement_id).version},'حُذفت الحركة وأعيد حساب الجدول');return}
  if(action==='expenseVoid'){if(confirm('حذف المصروف المباشر؟'))await apiAction('/api/expenses/'+id,'DELETE',{expected_version:state.data.expenses.find(e=>e.id===id).version},'حُذف المصروف من الحسابات');return}
  if(action==='taskToggle'){const task=state.data.tasks.find(x=>x.id===id);await apiAction('/api/tasks/'+id,'PATCH',{state:task.state==='done'?'open':'done',expected_version:task.version},'تم تحديث المهمة');return}
  if(action==='alertDismiss'){await apiAction('/api/alerts/dismiss','POST',{key:id},'تمت متابعة التنبيه وإخفاؤه من القائمة');return}
  if(action==='historyHide'){if(confirm('إزالة العملية من سجل العرض فقط؟ يبقى أثرها في سجل التدقيق المحمي.')){await api('/api/history/'+id+'/hide','POST',{});await loadHistory();notify('أُزيلت العملية من العرض مع حفظ أثرها')}return}
 }catch(err){notify(err.message,true)}finally{delete b.dataset.busy;b.disabled=false}
});
document.addEventListener('input',e=>{
 const form=e.target.closest('form');if(form&&form.id!=='history-form')form.dataset.dirty='1';
 if(e.target.id==='data-search'){
  state.search=e.target.value;render();
 }
});
document.addEventListener('change',async e=>{
 const formChanged=e.target.closest('form');if(formChanged&&formChanged.id!=='history-form')formChanged.dataset.dirty='1';
 if(e.target.id==='month'){if(!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(e.target.value)){e.target.value=state.month;return}await reload(e.target.value);return}
 if(!e.target.closest('#history-form'))return;
 const form=e.target.form;
 if(e.target.id==='history-period'){
   if(e.target.value==='custom'){document.getElementById('history-from').focus();return}
   const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Riyadh'});
   const range=historyPeriod(e.target.value,today);
   form.elements.from.value=range.from;form.elements.to.value=range.to;
   await applyHistoryFilters(form);
 }else if(e.target.id==='history-sort'){await applyHistoryFilters(form)}
 else if(['history-from','history-to'].includes(e.target.id)){
   form.elements.period.value='custom';
   document.getElementById('history-validation').textContent='اضغط «تطبيق الفترة» لتحديث النتائج.';
 }
});
modalRoot.addEventListener('click',e=>{if(e.target===modalRoot)closeModal()});
document.addEventListener('keydown',e=>{
 if(modalRoot.hidden)return;
 if(e.key==='Escape'){e.preventDefault();closeModal()}
 if(e.key==='Tab'){
  const items=[...modalRoot.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')].filter(el=>el.getClientRects().length);
  const first=items[0],last=items.at(-1);if(!first){e.preventDefault();return}
  if(!items.includes(document.activeElement)){e.preventDefault();(e.shiftKey?last:first).focus();return}
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
 }
});

reload();
