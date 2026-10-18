import React, { useState } from "react";
import {
  Plus,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChartNoAxesCombined,
} from "lucide-react";
import { useWallet } from "../state/WalletProvider.jsx";
import { Money, Button, Empty, SectionHead } from "../components/ui.jsx";
import { PageHeading, MonthTools, DueRow } from "../components/workspace.jsx";
import { agreementById, fmtDate, monthName } from "../lib/format.js";
import { CashFlowChart } from "../components/WalletCharts.jsx";
import { normalizeDigits } from "../../shared/numerals.mjs";
export default function CashPage({ direction }) {
  const { data, month, canManageData, open } = useWallet(),
    [scope, setScope] = useState("month"),
    [filter, setFilter] = useState("all"),
    s = data.summary,
    dues = data.dues.filter(
      (d) =>
        d.direction === direction &&
        (scope === "all" || d.due_date.startsWith(month)) &&
        (filter === "all" || d.status === filter),
    ),
    payments = data.payments
      .filter(
        (p) =>
          Number(p.active ?? 1) === 1 &&
          agreementById(data, p.agreement_id)?.direction === direction &&
          p.paid_at.startsWith(month),
      )
      .sort((a, b) => b.paid_at.localeCompare(a.paid_at)),
    expenses =
      direction === "out"
        ? data.expenses.filter(
            (e) => Number(e.active ?? 1) === 1 && e.paid_at.startsWith(month),
          )
        : [];
  return (
    <>
      <PageHeading
        title={direction === "in" ? "التحصيل" : "السداد"}
        subtitle="راجع الاستحقاقات، وتابع أثر كل حركة."
      >
        <MonthTools />
      </PageHeading>
      <div className="cash-summary-strip">
        {[
          [`due_${direction}`, "المستحق للشهر"],
          [`fulfilled_${direction}`, "منفذ من استحقاق الشهر"],
          [`remaining_${direction}`, "المتبقي للشهر"],
        ].map(([key, label]) => (
          <div key={key}>
            <span>{label}</span>
            <Money value={s[key]} />
          </div>
        ))}
      </div>
      <details className="cash-chart-disclosure">
        <summary>
          <ChartNoAxesCombined size={20} aria-hidden="true" />
          حركة النقد خلال الشهر
          <span>الداخل والخارج الفعلي</span>
        </summary>
        <CashFlowChart data={data} month={month} />
      </details>
      <section className="panel cash-worklist">
        <SectionHead title="الاستحقاقات المفتوحة">
          <span className="muted">{dues.length} استحقاق</span>
        </SectionHead>
        <div className="filter-bar">
          <div className="segmented" aria-label="نطاق الاستحقاقات">
            {[
              ["month", "الشهر المختار"],
              ["all", "جميع الفترات"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={scope === key}
                onClick={() => setScope(key)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="filter-chips" aria-label="حالة الاستحقاق">
            {[
              ["all", "الكل"],
              ["متأخر", "متأخر"],
              ["اليوم", "اليوم"],
              ["قادم", "قادم"],
            ].map(([key, label]) => (
              <button
                key={key}
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {dues.length ? (
          dues.map((due) => (
            <DueRow key={`${due.agreement_id}:${due.slot}`} due={due} />
          ))
        ) : (
          <Empty>لا توجد استحقاقات مفتوحة في هذا التصنيف.</Empty>
        )}
      </section>
      <section className="panel">
        <SectionHead title="الحركات المنفذة" subtitle={monthName(month)} />
        {payments.length ? (
          payments.map((payment) => {
            const agreement = agreementById(data, payment.agreement_id);
            return (
              <div className="record-row transaction-row" key={payment.id}>
                <span
                  className={`record-icon ${direction === "in" ? "green" : "purple"}`}
                >
                  {direction === "in" ? (
                    <ArrowDownToLine />
                  ) : (
                    <ArrowUpFromLine />
                  )}
                </span>
                <button
                  className="record-title"
                  onClick={() => open("agreementDetails", { id: agreement.id })}
                >
                  <strong>{normalizeDigits(agreement.title)}</strong>
                  <small>
                    {fmtDate(payment.paid_at)}
                    {payment.note ? " · " + normalizeDigits(payment.note) : ""}
                  </small>
                </button>
                <Money value={payment.amount_cents} />
                {canManageData && !agreement.closed_at && (
                  <div className="row-actions">
                    <Button
                      variant="ghost"
                      onClick={() => open("payEdit", { id: payment.id })}
                    >
                      تصحيح
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => open("payVoid", { id: payment.id })}
                    >
                      حذف
                    </Button>
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <Empty>لا توجد حركات مسجلة خلال الشهر.</Empty>
        )}
        {direction === "out" && (
          <>
            <SectionHead title="المصروفات المباشرة">
              {canManageData && (
                <Button variant="ghost" onClick={() => open("expenseForm")}>
                  <Plus size={17} />
                  مصروف
                </Button>
              )}
            </SectionHead>
            {expenses.length ? (
              expenses.map((expense) => (
                <div className="record-row" key={expense.id}>
                  <button
                    className="record-title"
                    onClick={() => open("expenseDetails", { id: expense.id })}
                  >
                    <strong>{normalizeDigits(expense.title)}</strong>
                    <small>{fmtDate(expense.paid_at)}</small>
                  </button>
                  <Money value={expense.amount_cents} />
                  {canManageData && (
                    <Button
                      variant="ghost"
                      onClick={() => open("expenseVoid", { id: expense.id })}
                    >
                      حذف
                    </Button>
                  )}
                </div>
              ))
            ) : (
              <Empty>لا توجد مصروفات مباشرة خلال الشهر.</Empty>
            )}
          </>
        )}
      </section>
    </>
  );
}
