import React, { useState } from "react";
import { Plus } from "lucide-react";
import { useWallet } from "../state/WalletProvider.jsx";
import { Button, Money, Empty } from "../components/ui.jsx";
import { PageHeading, MonthTools } from "../components/workspace.jsx";
import { fmtDate, entityById } from "../lib/format.js";
import { normalizeDigits } from "../../shared/numerals.mjs";
import { recordMatches } from "../../shared/client-model.mjs";

export default function InvoicesPage() {
  const { data, month, canManageData, open } = useWallet();
  const [search, setSearch] = useState("");
  const expenses = data.expenses.filter(e => Number(e.active ?? 1) === 1 && e.paid_at.startsWith(month)
    && recordMatches(e, search, [entityById(data, e.entity_id)?.name])).sort((a,b) => b.paid_at.localeCompare(a.paid_at));
  return <div className="stack">
    <PageHeading title="الفواتير" subtitle="فواتير الصيانة والتجديد والمصروفات المسجلة."><MonthTools /></PageHeading>
    <div className="search-row"><label className="search-field"><span className="sr-only">البحث في الفواتير</span>
      <input type="search" placeholder="ابحث باسم الفاتورة أو الأصل" value={search} onChange={e => setSearch(normalizeDigits(e.target.value))} /></label>
      {canManageData && <Button variant="primary" onClick={() => open("expenseForm")}><Plus size={18} />إضافة فاتورة</Button>}
    </div>
    <section className="panel"><div className="section-head"><h2>{expenses.length} فواتير</h2><Money value={expenses.reduce((sum,e) => sum + e.amount_cents,0)} /></div>
      {expenses.length ? expenses.map(expense => <div className="record-row" key={expense.id}>
        <button className="record-title" onClick={() => open("expenseDetails", {id:expense.id})}><strong>{normalizeDigits(expense.title)}</strong>
          <small>{fmtDate(expense.paid_at)}{expense.entity_id ? " · " + normalizeDigits(entityById(data,expense.entity_id)?.name || "") : ""}</small></button>
        <Money value={expense.amount_cents} /><Button variant="secondary" onClick={() => open("expenseDetails", {id:expense.id})}>التفاصيل</Button>
      </div>) : <Empty>{search ? "لا توجد فواتير تطابق البحث." : "لا توجد فواتير مسجلة خلال هذا الشهر."}</Empty>}
    </section>
  </div>;
}
