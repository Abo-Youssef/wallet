import React, { useState } from "react";
import {
  Plus,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
  Wallet,
  TriangleAlert,
  CheckSquare,
  CalendarDays,
  Building2,
  Car,
  Users,
  DoorOpen,
  Info,
  Check,
} from "lucide-react";
import { useWallet } from "../state/WalletProvider.jsx";
import {
  Money,
  Button,
  Empty,
  SectionHead,
  ProgressRing,
  Badge,
} from "../components/ui.jsx";
import {
  MonthTools,
  PageHeading,
  DueRow,
  TaskRow,
} from "../components/workspace.jsx";
import {
  fmtDate,
  entityById,
  agreementById,
  plusDays,
  monthName,
} from "../lib/format.js";
import { agreementPayments } from "../../public/client-model.mjs";
import { project } from "../../src/finance.mjs";
import {
  CashFlowChart,
  DueComparisonChart,
} from "../components/WalletCharts.jsx";
export function ManagerHome({ navigate }) {
  const { data, open, month } = useWallet(),
    s = data.summary,
    late = data.dues.filter((d) => d.due_date < data.today),
    tasks = data.tasks.filter((t) => t.state === "open");
  return (
    <>
      <PageHeading title="نظرة على محفظتك">
        <MonthTools />
      </PageHeading>
      <div className="manager-layout">
        <div className="manager-primary">
          <section
            className="obligations"
            aria-label={`التزامات ${monthName(month)}`}
          >
            {["in", "out"].map((direction) => (
              <button
                className={`obligation obligation-${direction}`}
                key={direction}
                onClick={() => navigate(direction === "in" ? "collect" : "pay")}
              >
                <div className="obligation-title">
                  <span className="metric-icon">
                    {direction === "in" ? (
                      <ArrowDownToLine size={21} />
                    ) : (
                      <ArrowUpFromLine size={21} />
                    )}
                  </span>
                  <h2>{direction === "in" ? "التحصيل" : "السداد"}</h2>
                  <ArrowLeft className="card-arrow" size={17} />
                </div>
                <Money value={s[`due_${direction}`]} />
                <p className="muted">المستحق في {monthName(month)}</p>
                <ProgressRing
                  semi
                  paid={s[`fulfilled_${direction}`]}
                  total={s[`due_${direction}`]}
                />
                <div className="obligation-values">
                  <div className="success-text">
                    <Money value={s[`fulfilled_${direction}`]} />
                    <span>{direction === "in" ? "محصّل" : "مسدّد"}</span>
                  </div>
                  <div>
                    <Money value={s[`remaining_${direction}`]} />
                    <span>متبقي</span>
                  </div>
                </div>
              </button>
            ))}
          </section>
          <section className="cash-panel">
            <SectionHead
              title="التدفق النقدي الفعلي"
              subtitle="بحسب تاريخ التنفيذ"
            >
              <Wallet size={23} />
            </SectionHead>
            <div className="cash-values">
              <div>
                <span>داخل</span>
                <Money value={s.cash_in} />
              </div>
              <div>
                <span>خارج</span>
                <Money value={s.cash_out} />
              </div>
              <div>
                <span>صافي التدفق</span>
                <Money value={s.net} />
              </div>
            </div>
            <p className="cash-note">
              <Info size={15} />
              الداخل ناقص الخارج خلال الشهر، ولا يمثل رصيدًا بنكيًا.
            </p>
          </section>
          <section className="cash-chart-panel">
            <CashFlowChart data={data} month={month} />
          </section>
          <section className="portfolio-strip">
            <SectionHead title="أصول محفظتك">
              <Button variant="ghost" onClick={() => navigate("data")}>
                التفاصيل
                <ArrowLeft size={16} />
              </Button>
            </SectionHead>
            <div className="portfolio-counts">
              {[
                ["property", "عقار", Building2],
                ["unit", "وحدة", DoorOpen],
                ["car", "سيارة", Car],
                ["worker", "عامل", Users],
              ].map(([kind, label, Icon]) => (
                <button
                  key={kind}
                  onClick={() =>
                    navigate("data", kind === "unit" ? "property" : kind)
                  }
                >
                  <Icon size={20} />
                  <strong>
                    {data.entities.filter((e) => e.kind === kind).length}
                  </strong>
                  <span>{label}</span>
                </button>
              ))}
            </div>
            <p className="muted footnote">
              قيم الأصول مرجعية، ولا تدخل في التدفق النقدي.
            </p>
          </section>
        </div>
        <aside className="manager-aside">
          <section className="attention-panel">
            <SectionHead
              title="يحتاج متابعتك"
              subtitle="الاستحقاقات المتأخرة · كل الفترات"
            >
              <TriangleAlert size={22} />
            </SectionHead>
            {late.length ? (
              late
                .slice(0, 4)
                .map((due) => (
                  <DueRow
                    compact
                    key={`${due.agreement_id}-${due.slot}`}
                    due={due}
                  />
                ))
            ) : (
              <Empty>لا توجد استحقاقات متأخرة.</Empty>
            )}
            {late.length > 4 && (
              <Button variant="ghost" onClick={() => open("alerts")}>
                مراجعة الاستحقاقات
              </Button>
            )}
          </section>
          <DueComparisonChart summary={s} month={month} />
          <section className="task-panel">
            <SectionHead title="مهام المتابعة">
              <Button variant="ghost" onClick={() => open("taskAdd")}>
                <Plus size={16} />
                مهمة
              </Button>
            </SectionHead>
            {tasks.length ? (
              tasks
                .slice(0, 3)
                .map((task) => <TaskRow key={task.id} task={task} />)
            ) : (
              <Empty>كل مهام المتابعة مكتملة.</Empty>
            )}
            <Button
              variant="ghost"
              className="section-link"
              onClick={() => open("tasks")}
            >
              جميع المهام
              <ArrowLeft size={16} />
            </Button>
          </section>
          <section className="future-summary">
            <span>قادم في الفترات التالية</span>
            <div>
              <span>تحصيل مستقبلي</span>
              <Money value={s.future_in} />
            </div>
            <div>
              <span>سداد مستقبلي</span>
              <Money value={s.future_out} />
            </div>
            <small>جميع الاستحقاقات بعد {fmtDate(data.today)}</small>
          </section>
        </aside>
      </div>
    </>
  );
}
export function AssistantHome({ navigate }) {
  const { data, open } = useWallet(),
    [scope, setScope] = useState("all"),
    [selectedKey, setSelectedKey] = useState(null),
    [limit, setLimit] = useState(12),
    candidates = data.dues.filter(
      (d) => d.due_date <= plusDays(data.today, 30),
    ),
    late = candidates.filter((d) => d.due_date < data.today),
    today = candidates.filter((d) => d.due_date === data.today),
    tasks = data.tasks.filter((t) => t.state === "open"),
    filtered = scope === "late" ? late : scope === "today" ? today : candidates,
    selected =
      filtered.find((d) => `${d.agreement_id}:${d.slot}` === selectedKey) ||
      filtered[0];
  return (
    <>
      <PageHeading title="جدول أعمالك" subtitle={fmtDate(data.today)}>
        <Button variant="primary" onClick={() => open("quickadd")}>
          <Plus size={21} />
          إضافة جديدة
        </Button>
      </PageHeading>
      <div className="assistant-layout">
        <div className="agenda-main">
          <div className="agenda-stats">
            <button
              className={`stat stat-late ${scope === "late" ? "chosen" : ""}`}
              aria-pressed={scope === "late"}
              onClick={() => setScope(scope === "late" ? "all" : "late")}
            >
              <span className="stat-icon">
                <TriangleAlert size={22} />
              </span>
              <strong>{late.length}</strong>
              <span>متأخر</span>
            </button>
            <button
              className={`stat ${scope === "today" ? "chosen" : ""}`}
              aria-pressed={scope === "today"}
              onClick={() => setScope(scope === "today" ? "all" : "today")}
            >
              <span className="stat-icon">
                <CalendarDays size={22} />
              </span>
              <strong>{today.length}</strong>
              <span>اليوم</span>
            </button>
            <button className="stat stat-task" onClick={() => open("tasks")}>
              <span className="stat-icon">
                <CheckSquare size={22} />
              </span>
              <strong>{tasks.length}</strong>
              <span>مهمة مفتوحة</span>
            </button>
          </div>
          <section className="agenda">
            <SectionHead
              title="التحصيل والسداد"
              subtitle="المتأخر والقادم خلال 30 يومًا"
            >
              <Button
                variant="ghost"
                onClick={() => {
                  setScope("all");
                  setLimit(candidates.length);
                }}
              >
                عرض الكل
                <ArrowLeft size={16} />
              </Button>
            </SectionHead>
            {filtered.length ? (
              <div className="agenda-rows">
                {filtered.slice(0, limit).map((due) => (
                  <DueRow
                    due={due}
                    key={`${due.agreement_id}:${due.slot}`}
                    selected={due === selected}
                    onSelect={() =>
                      setSelectedKey(`${due.agreement_id}:${due.slot}`)
                    }
                  />
                ))}
              </div>
            ) : (
              <Empty>لا توجد استحقاقات في هذا التصنيف.</Empty>
            )}
            {filtered.length > limit && (
              <Button
                className="section-link"
                onClick={() => setLimit(limit + 12)}
              >
                عرض المزيد ({filtered.length - limit})
              </Button>
            )}
          </section>
          <section className="task-panel">
            <SectionHead
              title="المهام"
              subtitle={`${tasks.length} مهام بانتظار الإنجاز`}
            >
              <Button variant="ghost" onClick={() => open("taskAdd")}>
                <Plus size={17} />
                إضافة مهمة
              </Button>
            </SectionHead>
            {tasks.length ? (
              tasks
                .slice(0, 4)
                .map((task) => <TaskRow key={task.id} task={task} />)
            ) : (
              <Empty>لا توجد مهام معلّقة.</Empty>
            )}
          </section>
          <section className="admin-alerts">
            <SectionHead title="تنبيهات الأصول">
              <Button variant="ghost" onClick={() => open("alerts")}>
                عرض {data.alerts.length} تنبيهات
                <ArrowLeft size={16} />
              </Button>
            </SectionHead>
            <p className="muted">مواعيد العقود والتأمين والصيانة والوثائق.</p>
          </section>
        </div>
        <aside className="detail-aside">
          {selected ? (
            <SelectedDue due={selected} />
          ) : (
            <div className="detail-placeholder">
              <Check size={36} />
              <h2>أعمالك تحت السيطرة</h2>
              <p>اختر استحقاقًا لعرض التفاصيل هنا.</p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
function SelectedDue({ due }) {
  const { data, open, loading, error } = useWallet(),
    agreement = agreementById(data, due.agreement_id),
    payments = agreementPayments(data, agreement.id),
    summary = project(agreement, payments),
    entity = entityById(data, due.entity_id);
  return (
    <div className="selected-detail">
      <div className="detail-caption">
        <span>تفاصيل الالتزام</span>
        <Button
          variant="ghost"
          onClick={() => open("agreementDetails", { id: agreement.id })}
        >
          المزيد
          <ArrowLeft size={16} />
        </Button>
      </div>
      <div className="selected-title">
        <h2>{agreement.title}</h2>
        <Badge>{due.status}</Badge>
        <p className="muted">
          {entity?.name || "عملية مجدولة"} ·{" "}
          {agreement.frequency_months === 1
            ? "شهري"
            : `كل ${agreement.frequency_months} أشهر`}
        </p>
      </div>
      <ProgressRing paid={summary.paid_total_cents} total={summary.total_cents}>
        <strong>
          {Math.round(
            summary.total_cents
              ? (summary.paid_total_cents / summary.total_cents) * 100
              : 0,
          )}
          <small>٪</small>
        </strong>
        <span>{due.direction === "in" ? "تم تحصيله" : "تم سداده"}</span>
      </ProgressRing>
      <div className="detail-metrics">
        <div className="success-text">
          <Money value={summary.paid_total_cents} />
          <span>منفذ</span>
        </div>
        <div>
          <Money value={summary.total_cents} />
          <span>الإجمالي</span>
        </div>
        <div className="danger-text">
          <Money value={summary.remaining_cents} />
          <span>متبقي</span>
        </div>
      </div>
      {summary.opening_cents > 0 && (
        <p className="muted footnote">
          الإجمالي المنفذ يشمل <Money value={summary.opening_cents} /> قبل تأسيس
          المحفظة.
        </p>
      )}
      <div className="detail-history">
        <h3>آخر الحركات</h3>
        {payments.length ? (
          payments.slice(0, 3).map((payment) => (
            <div className="payment-mini" key={payment.id}>
              <span className="mini-check">
                <Check size={15} />
              </span>
              <div>
                <strong>{payment.note || "دفعة مسجلة"}</strong>
                <small>{fmtDate(payment.paid_at)}</small>
              </div>
              <Money value={payment.amount_cents} />
            </div>
          ))
        ) : (
          <p className="muted">لم تُسجل حركات بعد.</p>
        )}
      </div>
      <Button
        className="block"
        variant="primary"
        disabled={loading || Boolean(error)}
        onClick={() =>
          open("payConfirm", { id: `${due.agreement_id}::${due.slot}` })
        }
      >
        <Plus size={18} />
        {due.direction === "in" ? "تسجيل تحصيل" : "تسجيل سداد"}
      </Button>
      {agreement.note && (
        <div className="detail-note">
          <h3>ملاحظات</h3>
          <p>{agreement.note}</p>
        </div>
      )}
    </div>
  );
}
