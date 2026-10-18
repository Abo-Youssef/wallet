import {propertyTypeNames} from './property-types.mjs';

export function normalizeSearch(value){
 return String(value??'').normalize('NFKC').toLocaleLowerCase('ar')
  .replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776))
  .replace(/[\u064B-\u065F\u0670\u0640]/g,'').replace(/[أإآٱ]/g,'ا').replace(/ى/g,'ي').trim();
}
const searchableFields=['name','title','location','plate','electricity_meter','phone','work_location','iqama_number','passport_number','contract_number','counterparty','notes','note','insurance_expiry','maintenance_date','iqama_expiry','passport_expiry'];
export function entityReference(data,id){
 const active=data?.entities?.find(e=>e.id===id);if(active)return active;
 const archived=data?.archived_entities?.find(e=>e.id===id);return archived?{...archived,archived:1}:undefined;
}
export function formatRiyadhDate(value){
 if(!value)return '—';
 const instant=new Date(value);if(Number.isNaN(instant.getTime()))return '—';
 return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Riyadh'}).format(instant);
}
export function recordMatches(record,query,context=[]){
 const words=normalizeSearch(query).split(/\s+/).filter(Boolean);
 const haystack=normalizeSearch([...searchableFields.map(key=>record?.[key]),propertyTypeNames[record?.property_type],...context].join(' '));
 return words.every(word=>haystack.includes(word));
}
export function selectDataRecords(data,kind,query=''){
 const allEntities=data.entities||[],allAgreements=data.agreements||[],allExpenses=data.expenses||[];
 if(kind==='closed'){
  const closed=allAgreements.filter(a=>Boolean(a.closed_at));
  const agreements=closed.filter(a=>{const entity=entityReference(data,a.entity_id);return recordMatches(a,query,[entity?.name,entityReference(data,entity?.parent_id)?.name])})
   .sort((a,b)=>b.closed_at.localeCompare(a.closed_at)||a.id.localeCompare(b.id));
  return {entities:[],agreements,expenses:[],resultCount:agreements.length,totalCount:closed.length};
 }
 const candidates=allEntities.filter(e=>kind==='property'?['property','unit'].includes(e.kind):e.kind===kind);
 let entities=candidates.filter(e=>recordMatches(e,query,[allEntities.find(p=>p.id===e.parent_id)?.name,...allAgreements.filter(a=>a.entity_id===e.id).flatMap(a=>[a.title,a.contract_number,a.counterparty,a.phone])]));
 // Keep a matching unit under its property in both representations.
 if(kind==='property'){
  const ids=new Set(entities.map(e=>e.id));
  for(const e of entities)if(e.parent_id)ids.add(e.parent_id);
  entities=candidates.filter(e=>ids.has(e.id));
 }
 const agreements=allAgreements.filter(a=>a.kind==='other'&&a.status==='active'&&recordMatches(a,query));
 const expenses=allExpenses.filter(e=>Number(e.active??1)===1&&recordMatches(e,query,[entityReference(data,e.entity_id)?.name]));
 return {entities,agreements,expenses,resultCount:kind==='other'?agreements.length+expenses.length:entities.length,totalCount:kind==='other'?allAgreements.filter(a=>a.kind==='other'&&a.status==='active').length+allExpenses.length:candidates.length};
}
export function agreementPayments(data,id){
 return (data.payments||[]).filter(p=>p.agreement_id===id&&Number(p.active??1)===1)
  .sort((a,b)=>b.paid_at.localeCompare(a.paid_at)||b.created_at.localeCompare(a.created_at)||b.id.localeCompare(a.id));
}
export function alertDestination(alert,data){
 const [prefix,id]=String(alert.key||'').split(':');
 const type=alert.target_type||(prefix==='rent'?'agreement':['ins','maint','km','iqama','passport'].includes(prefix)?'entity':null);
 const targetId=alert.target_id||id;
 const record=(type==='agreement'?data.agreements:type==='entity'?data.entities:[])?.find(x=>x.id===targetId);
 return record?{action:type==='agreement'?'agreementDetails':'entityDetails',id:targetId,label:type==='agreement'?'عرض العقد':'عرض السجل'}:null;
}
export function buildMonthStatement(data){
 if(!data||!/^\d{4}-\d{2}$/.test(data.month))throw new Error('حدّث بيانات الشهر قبل فتح الكشف');
 const entities=new Map([...(data.archived_entities||[]),...(data.entities||[])].map(e=>[e.id,e]));
 const agreements=new Map((data.agreements||[]).map(a=>[a.id,a]));
 const transactions=[];
 for(const p of data.payments||[]){
  const agreement=agreements.get(p.agreement_id);
  if(!agreement||Number(p.active??1)!==1||p.paid_at.slice(0,7)!==data.month)continue;
  transactions.push({id:p.id,date:p.paid_at,created_at:p.created_at||'',type:agreement.direction==='in'?'تحصيل':'سداد',direction:agreement.direction,title:agreement.title,entity:entities.get(agreement.entity_id)?.name||'',amount_cents:p.amount_cents,note:p.note||''});
 }
 for(const e of data.expenses||[]){
  if(Number(e.active??1)!==1||e.paid_at.slice(0,7)!==data.month)continue;
  transactions.push({id:e.id,date:e.paid_at,created_at:e.created_at||'',type:'مصروف مباشر',direction:'out',title:e.title,entity:entities.get(e.entity_id)?.name||'',amount_cents:e.amount_cents,note:e.note||''});
 }
 transactions.sort((a,b)=>a.date.localeCompare(b.date)||a.created_at.localeCompare(b.created_at)||a.id.localeCompare(b.id));
 return {month:data.month,today:data.today,summary:{...data.summary},transactions,openDues:(data.dues||[]).filter(d=>d.due_date.slice(0,7)===data.month)};
}
