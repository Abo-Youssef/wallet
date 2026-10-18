import { normalizeDigits } from './numerals.mjs';
const escapeStatementText=value=>normalizeDigits(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statementMoney=cents=>(Number(cents||0)/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
function csvText(value){
 let text=normalizeDigits(value);
 // Spreadsheet programs interpret these prefixes as executable formulas.
 if(/^[\s]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
 return '"'+text.replace(/"/g,'""')+'"';
}
export function statementCSV(statement){
 const rows=[['الشهر','تاريخ التنفيذ','نوع الحركة','العملية','الأصل','الاتجاه','المبلغ بالريال','الملاحظات'],...statement.transactions.map(t=>[statement.month,t.date,t.type,t.title,t.entity,t.direction==='in'?'داخل':'خارج',(t.amount_cents/100).toFixed(2),t.note])];
 return '\ufeff'+rows.map(row=>row.map(csvText).join(',')).join('\r\n')+'\r\n';
}
export function statementHTML(statement){
 const e=escapeStatementText,s=statement.summary;
 const metricRow=(label,incoming,outgoing)=>`<tr><th scope="row">${e(label)}</th><td>${statementMoney(incoming)}</td><td>${statementMoney(outgoing)}</td></tr>`;
 return `<section class="statement-document" aria-label="الكشف الشهري"><div class="statement-heading"><p class="eyebrow">wallet · كشف شهري</p><h3>${e(statement.month)}</h3><p class="hint">جميع المبالغ بالريال السعودي. الاستحقاقات منفصلة عن التنفيذ النقدي.</p></div>
 <div class="statement-summary"><h3 class="section-title">استحقاقات الشهر المختار</h3><div class="tablewrap"><table class="tbl statement-table"><thead><tr><th scope="col">البيان</th><th scope="col">تحصيل</th><th scope="col">سداد</th></tr></thead><tbody>${metricRow('إجمالي المستحق',s.due_in,s.due_out)}${metricRow('منفذ من هذه الاستحقاقات',s.fulfilled_in,s.fulfilled_out)}${metricRow('المتبقي',s.remaining_in,s.remaining_out)}</tbody></table></div>
 <h3 class="section-title">النقد المنفذ خلال الشهر</h3><div class="ledger-rows"><div class="ledger-row"><span>دخل فعليًا</span><strong>${statementMoney(s.cash_in)} ر.س</strong></div><div class="ledger-row"><span>خرج فعليًا</span><strong>${statementMoney(s.cash_out)} ر.س</strong></div><div class="ledger-row"><span>صافي التدفق</span><strong>${statementMoney(s.net)} ر.س</strong></div></div><p class="hint">الصافي هو الداخل ناقص الخارج خلال الشهر؛ لا يمثل رصيد حساب بنكي.</p></div>
 <h3 class="section-title section">الحركات المنفذة (${statement.transactions.length})</h3>${statement.transactions.length?`<div class="tablewrap"><table class="tbl statement-table"><thead><tr><th scope="col">تاريخ التنفيذ</th><th scope="col">النوع</th><th scope="col">العملية / الأصل</th><th scope="col">المبلغ</th><th scope="col">ملاحظات</th></tr></thead><tbody>${statement.transactions.map(t=>`<tr><td>${e(t.date)}</td><td>${e(t.type)}</td><td>${e(t.title)}${t.entity?'<br><span class="muted">'+e(t.entity)+'</span>':''}</td><td>${statementMoney(t.amount_cents)}</td><td>${e(t.note||'—')}</td></tr>`).join('')}</tbody></table></div>`:'<p class="empty">لا توجد حركات منفذة خلال هذا الشهر.</p>'}
 <p class="hint statement-footnote">القيم الافتتاحية قبل تأسيس المحفظة لا تدخل في الحركات النقدية. يعكس الكشف آخر بيانات محمّلة للشهر.</p></section>`;
}
