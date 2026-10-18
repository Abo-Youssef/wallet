import {currentSummary} from '../shared/finance.mjs';
const plusDays=(date,num)=>{const x=new Date(`${date}T12:00:00Z`);x.setUTCDate(x.getUTCDate()+num);return x.toISOString().slice(0,10)};
export function demoHistory(){
 const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Riyadh'});
 return Array.from({length:125},(_,i)=>({
   id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,
   created_at:new Date(`${plusDays(today,-Math.floor(i/3))}T${String(9+i%3).padStart(2,'0')}:30:00+03:00`).toISOString(),
   actor:i%4?'المساعد — بيانات تجريبية':'المدير — بيانات تجريبية',
   action:['إضافة','تسجيل حركة','تحديث مهمة','تعديل'][i%4],
   target_type:['entity','payment','task','agreement'][i%4],
   after_json:JSON.stringify({title:['إضافة وحدة سكنية','تحصيل إيجار شقة 1','متابعة تأمين السيارة','تحديث بيانات عقد'][i%4]})
 }));
}

export function demoData(month){const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Riyadh'});
 const entities=[{id:'p1',kind:'property',name:'عمارة النخيل',location:'الرياض',electricity_meter:'1234567',reference_value_cents:90000000},{id:'u1',kind:'unit',name:'شقة 1',parent_id:'p1',status:'rented'},{id:'u2',kind:'unit',name:'محل 3',parent_id:'p1',status:'available'},{id:'c1',kind:'car',name:'كامري 2025',plate:'أ ب ج 1234',reference_value_cents:12000000,odometer_km:24000,maintenance_due_km:30000,insurance_expiry:plusDays(today,7)},{id:'w1',kind:'worker',name:'عامل 1',phone:'0500000000',work_location:'الرياض',iqama_number:'—',iqama_expiry:plusDays(today,20)}];
 const agreements=[{id:'a1',kind:'rent',direction:'in',entity_id:'u1',title:'إيجار شقة 1',start_date:today,end_date:plusDays(today,30),first_due_date:today,total_cents:300000,opening_cents:0,installment_count:1,frequency_months:1,status:'active',version:0},{id:'a2',kind:'purchase',direction:'out',entity_id:'c1',title:'قسط سيارة كامري',first_due_date:today,total_cents:12000000,opening_cents:6000000,installment_count:24,frequency_months:1,status:'active',version:0},{id:'a3',kind:'other',direction:'out',entity_id:null,title:'شراء هاتف بالأقساط',first_due_date:plusDays(today,10),total_cents:600000,opening_cents:200000,installment_count:10,frequency_months:1,status:'active',version:0}];
 const payments=[{id:'payment-demo',agreement_id:'a1',slot_index:0,amount_cents:120000,paid_at:today,active:1,created_at:today+'T09:00:00.000Z',created_by:'المساعد — بيانات توضيحية'}];
 const expenses=[{id:'expense-demo',title:'صيانة توضيحية',amount_cents:24000,paid_at:today,direction:'out',active:1,version:0,created_at:today+'T10:00:00.000Z'}];
 for(const e of entities)e.version=0;agreements[0].version=1;
 const finances=currentSummary(agreements,payments,expenses,month,today);
 return {user:{role:new URLSearchParams(location.search).get('role')==='assistant'?'assistant':'manager',email:'preview@example.com'},today,month,entities,agreements,payments,expenses,tasks:[{id:'t1',version:0,title:'مراجعة أوراق السيارة',description:'مهمة توضيحية',due_date:today,assigned_to:'assistant',state:'open'}],alerts:[{key:'demo1',title:'انتهاء تأمين: كامري 2025',due_date:plusDays(today,7),source:'سيارة',late:false}],...finances};
}
globalThis.walletPreview={data:demoData,history:demoHistory};
