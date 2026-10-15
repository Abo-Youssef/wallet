/** Core math for Mahfazati. Pure and independently testable. Amounts are INTEGER halalas. */
export function assert(cond, message='بيانات غير صحيحة') { if (!cond) throw Object.assign(new Error(message),{code:400}); }
export function parseMoney(value, label='المبلغ') {
  assert(typeof value==='string'||typeof value==='number',`${label}: نوع القيمة غير صحيح`);
  const s = String(value ?? '').trim();
  assert(/^\d+(\.\d{1,2})?$/.test(s), `${label}: أدخل مبلغًا صحيحًا بحد أقصى منزلتين عشريتين`);
  const [whole,fraction='']=s.split('.');
  const cents = Number(whole)*100+Number(fraction.padEnd(2,'0'));
  assert(Number.isSafeInteger(cents) && cents>=0 && cents<=1e13, `${label}: القيمة خارج النطاق`);
  return cents;
}
export function isDate(s) {
  if (typeof s!=='string'||!/^\d{4}-\d\d-\d\d$/.test(s)||s<'1000-01-01') return false;
  const d=new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10)===s;
}
export function addMonths(s, count) {
  assert(isDate(s), 'التاريخ غير صحيح');
  assert(Number.isSafeInteger(count)&&count>=0&&count<=7200,'فترة الجدولة غير صحيحة');
  const [y,m,d]=s.split('-').map(Number);
  const z=new Date(Date.UTC(y,m-1+count,1,12));
  const yy=z.getUTCFullYear(), mm=z.getUTCMonth();
  assert(yy<=9999,'نهاية الجدولة تتجاوز نطاق التاريخ المدعوم');
  const day=Math.min(d,new Date(Date.UTC(yy,mm+1,0,12)).getUTCDate());
  return `${yy}-${String(mm+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
/** Equalize what remains, capped by each slot's previous balance. No payment
 * may increase a partly paid installment. Integer remainders go to later slots. */
export function distributeCapped(sum,caps){
  assert(Number.isSafeInteger(sum)&&sum>=0&&caps.length>0&&caps.every(x=>Number.isSafeInteger(x)&&x>=0),'توزيع غير صحيح');
  assert(sum<=caps.reduce((a,b)=>a+b,0),'التوزيع يتجاوز المتبقي');
  let lo=0,hi=Math.max(...caps);
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(caps.reduce((s,c)=>s+Math.min(c,mid),0)<=sum)lo=mid;else hi=mid-1}
  const parts=caps.map(c=>Math.min(c,lo));
  let remainder=sum-parts.reduce((a,b)=>a+b,0);
  // Preserve the established rule: the final eligible installment receives
  // rounding halalas, without exceeding its cap.
  for(let i=parts.length-1;i>=0&&remainder;i--){const n=Math.min(remainder,caps[i]-parts[i]);parts[i]+=n;remainder-=n}
  assert(remainder===0,'تعذر موازنة الأقساط');return parts;
}
export function splitEvenly(sum, count) {
  assert(Number.isSafeInteger(sum)&&sum>=0&&Number.isSafeInteger(count)&&count>0&&count<=600,'قيمة أو مدة غير صحيحة');
  const each=Math.floor(sum/count), remainder=sum%count;
  return Array.from({length:count},(_,i)=>each+(i===count-1?remainder:0));
}
/**
 * Each payment targets the installment SLOT selected at the time of recording.
 * A partial receipt leaves that same slot open for its remaining balance.
 * An overpayment is applied to future slots by either reducing the number of
 * remaining payments (shorten) or redistributing their amounts (spread).
 * Rebuilding from the immutable agreement and active payments means that
 * corrections and voids cannot silently create mismatched totals.
 */
export function project(agreement, payments=[]) {
  const total=Number(agreement.total_cents), opening=Number(agreement.opening_cents);
  const count=Number(agreement.installment_count), frequency=Number(agreement.frequency_months);
  assert(Number.isSafeInteger(total)&&Number.isSafeInteger(opening)&&total>=0&&opening>=0&&opening<=total,'قيمة الاتفاق أو الرصيد الافتتاحي غير صحيحة');
  assert(Number.isInteger(count)&&count>=1&&count<=600,'عدد الأقساط يجب أن يكون بين 1 و600');
  assert([1,3,6,12].includes(frequency),'دورية الدفعات غير مدعومة');
  assert(isDate(agreement.first_due_date),'تاريخ أول استحقاق غير صحيح');
  const original=splitEvenly(total-opening,count);
  const rows=original.map((amount,i)=>({slot:i, due_date:addMonths(agreement.first_due_date,i*frequency), remaining_cents:amount, applied_cents:0, initial_cents:amount}));
  const active=payments.filter(p=>Number(p.active??1)===1)
    .sort((a,b)=>String(a.created_at??'').localeCompare(String(b.created_at??'')) || String(a.id).localeCompare(String(b.id)));
  let paid=0;const payment_contexts={};
  for(const p of active) {
    const amount=Number(p.amount_cents), slot=Number(p.slot_index);
    assert(Number.isSafeInteger(amount)&&amount>0,'المبلغ المنفذ يجب أن يكون أكبر من الصفر');
    assert(Number.isInteger(slot)&&slot>=0&&slot<rows.length,'القسط المختار غير موجود');
    const row=rows[slot];
    assert(row.remaining_cents>0,'لا يمكن تسجيل دفعة على قسط مكتمل أو أُلغي بالجدولة');
    payment_contexts[p.id]={expected_cents:row.remaining_cents,due_date:row.due_date};
    const outstanding=rows.reduce((v,r)=>v+r.remaining_cents,0);
    assert(amount<=outstanding,'المبلغ يتجاوز كامل الرصيد المتبقي');
    const applied=Math.min(amount,row.remaining_cents);
    row.remaining_cents-=applied;
    row.applied_cents+=applied;
    let extra=amount-applied;
    if(extra>0) {
      const candidates=rows.filter(r=>r.slot>slot&&r.remaining_cents>0);
      assert(candidates.length>0,'لا توجد أقساط قادمة لتوزيع المبلغ الإضافي');
      assert(['shorten','spread'].includes(p.reschedule_method),'اختر طريقة إعادة الجدولة للمبلغ الزائد');
      const available=candidates.reduce((v,r)=>v+r.remaining_cents,0);
      assert(extra<=available,'الزيادة تتجاوز قيمة الأقساط القادمة');
      if(p.reschedule_method==='shorten') {
        for(let i=candidates.length-1;i>=0&&extra>0;i--) {
          const d=Math.min(extra,candidates[i].remaining_cents);
          candidates[i].remaining_cents-=d;
          candidates[i].advanced_cents=(candidates[i].advanced_cents??0)+d;
          extra-=d;
        }
      } else {
        const portions=distributeCapped(available-extra,candidates.map(r=>r.remaining_cents));
        for(let i=0;i<candidates.length;i++) {
          const old=candidates[i].remaining_cents;
          candidates[i].remaining_cents=portions[i];
          candidates[i].advanced_cents=(candidates[i].advanced_cents??0)+(old-portions[i]);
        }
      }
    }
    paid+=amount;
  }
  const left=rows.reduce((v,r)=>v+r.remaining_cents,0);
  assert(left===total-opening-paid,'خطأ في اتزان الاستحقاقات والحركات');
  return {rows,payment_contexts,total_cents:total,opening_cents:opening,paid_since_opening_cents:paid,paid_total_cents:opening+paid,remaining_cents:left};
}
export function monthOf(s) {return String(s||'').slice(0,7)}
export function dueStatus(date, now) {return date<now?'متأخر':date===now?'اليوم':'قادم'}
export function currentSummary(agreements, payments, expenses, month, today) {
  const summary={due_in:0,fulfilled_in:0,remaining_in:0,due_out:0,fulfilled_out:0,remaining_out:0,
    overdue_in:0,overdue_out:0,future_in:0,future_out:0,cash_in:0,cash_out:0,net:0};
  const dues=[],payment_contexts={},agreementMap=new Map(agreements.map(a=>[a.id,a])),grouped=new Map();
  for(const p of payments){if(!grouped.has(p.agreement_id))grouped.set(p.agreement_id,[]);grouped.get(p.agreement_id).push(p)}
  for(const a of agreements) {
    if(a.status!=='active') continue;
    const related=grouped.get(a.id)||[];
    const p=project(a,related);
    Object.assign(payment_contexts,p.payment_contexts);
    const direction=a.direction==='in'?'in':'out';
    for(const r of p.rows) {
      const isThisMonth=monthOf(r.due_date)===month;
      if(isThisMonth) {
        summary[`due_${direction}`]+=r.remaining_cents+r.applied_cents;
        summary[`fulfilled_${direction}`]+=r.applied_cents;
        summary[`remaining_${direction}`]+=r.remaining_cents;
      }
      if(r.remaining_cents>0) {
        if(r.due_date<today) summary[`overdue_${direction}`]+=r.remaining_cents;
        if(r.due_date>today) summary[`future_${direction}`]+=r.remaining_cents;
        dues.push({agreement_id:a.id, slot:r.slot, title:a.title, kind:a.kind, entity_id:a.entity_id,
          direction:a.direction, due_date:r.due_date, amount_cents:r.remaining_cents, status:dueStatus(r.due_date,today),
          agreement_version:a.version, agreement_title:a.title});
      }
    }
  }
  for(const p of payments) if(Number(p.active??1)===1 && monthOf(p.paid_at)===month) {
    const a=agreementMap.get(p.agreement_id);
    if(a) summary[`cash_${a.direction==='in'?'in':'out'}`]+=Number(p.amount_cents);
  }
  for(const e of expenses) if(Number(e.active??1)===1 && monthOf(e.paid_at)===month) {
    summary[`cash_${e.direction==='in'?'in':'out'}`]+=Number(e.amount_cents);
  }
  summary.net=summary.cash_in-summary.cash_out;
  dues.sort((a,b)=>a.due_date.localeCompare(b.due_date)||a.title.localeCompare(b.title));
  assert(Object.values(summary).every(Number.isSafeInteger),'الإجماليات تتجاوز نطاق الأرقام الدقيق');
  return {summary,dues,payment_contexts};
}
