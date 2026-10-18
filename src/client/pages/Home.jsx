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
import { agreementPayments } from "../../shared/client-model.mjs";
import { project } from "../../shared/finance.mjs";
import { normalizeDigits } from "../../shared/numerals.mjs";
import {
  CashFlowChart,
  DueComparisonChart,
} from "../components/WalletCharts.jsx";
export function ManagerHome({ navigate }) {
  const { data, open, month, canManageData } = useWallet(),
    s = data.summary,
    late = data.dues.filter((due) => due.due_date < data.today),
    tasks = data.tasks.filter((task) => task.state === "open");
  return (
    <>
      <PageHeading title="النظرة الشاملة" subtitle="أصولك والتزاماتك وحركة النقد، في مكان واحد.">
        <MonthTools />
      </PageHeading>
      <div className="overview-actions">
        <Button variant="secondary" onClick={() => navigate("data", "property")}><Building2 size={18} /> الأصول والتأجير <ArrowLeft size={16} /></Button>
        {canManageData && <Button variant="primary" onClick={() => open("quickadd")}><Plus size={18} /> إضافة جديدة</Button>}
      </div>
      <div className="overview-layout">
        <div className="overview-main">
          <section className="overview-section monthly-summary">
            <SectionHead title="التزامات الشهر" subtitle={monthName(month)} />
            <div className="collection-progress-grid" role="region" aria-label="ملخص التحصيل والسداد">
              {["in", "out"].map((direction) => {
                const total = s["due_" + direction], paid = s["fulfilled_" + direction];
                const percent = total > 0 ? Math.max(0, Math.min(100, paid / total * 100)) : 0;
                const label = direction === "in" ? "التحصيل" : "السداد";
                return <button key={direction} className={`collection-progress-card collection-${direction}`}
                  onClick={() => navigate(direction === "in" ? "collect" : "pay")}
                  aria-label={`تفاصيل ${label} للشهر`}>
                  <span className="collection-heading">{direction === "in" ? <ArrowDownToLine size={20} /> : <ArrowUpFromLine size={20} />}<strong>{label}</strong><ArrowLeft size={16} /></span>
                  <span className="collection-total"><span>إجمالي المستحق</span><Money value={total} /></span>
                  <span className="collection-progress-label"><span>{total ? "نسبة الإنجاز" : "لا توجد مستحقات"}</span><bdi>{Math.round(percent)}%</bdi></span>
                  <span className="collection-progress" role="progressbar" aria-label={`نسبة ${label}`} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
                    <span style={{ transform: `scaleX(${percent / 100})` }} />
                  </span>
                  <span className="collection-paid"><span>{direction === "in" ? "المحصّل فعليًا" : "المسدّد فعليًا"}</span><Money value={paid} /></span>
                  <span className="collection-remaining"><span>المتبقي</span><Money value={s["remaining_" + direction]} /></span>
                </button>;
              })}
            </div>
            <p className="muted footnote">استحقاقات الشهر المحدد وما نُفذ منها، حتى لو اختلف تاريخ التحصيل أو السداد.</p>
          </section>
          <section className="overview-section overview-cash">
            <SectionHead title="حركة النقد الفعلية" subtitle="المبالغ المنفذة خلال الشهر المحدد"><Wallet size={21} /></SectionHead>
            <div className="cash-values">
              <div><span>داخل</span><Money value={s.cash_in} /></div>
              <div><span>خارج</span><Money value={s.cash_out} /></div>
              <div><span>صافي التدفق</span><Money value={s.net} /></div>
            </div>
            <p className="cash-note"><Info size={15} />الداخل ناقص الخارج خلال الشهر، ولا يمثل رصيدًا بنكيًا.</p>
          </section>
          <details className="overview-reports record-disclosure">
            <summary>تحليل الشهر <span>التدفق النقدي ومقارنة التنفيذ</span></summary>
            <div className="overview-chart-content"><CashFlowChart data={data} month={month} /><DueComparisonChart summary={s} month={month} /></div>
          </details>
          <section className="portfolio-strip overview-portfolio">
            <SectionHead title="أصول المحفظة"><Button variant="ghost" onClick={() => navigate("data")}>إدارة الأصول <ArrowLeft size={16} /></Button></SectionHead>
            <div className="portfolio-counts">{[["property", "عقار", Building2], ["unit", "وحدة", DoorOpen], ["car", "سيارة", Car], ["worker", "عامل", Users]].map(([kind, label, Icon]) => <button key={kind} onClick={() => navigate("data", kind === "unit" ? "property" : kind)}><Icon size={19} /><strong>{data.entities.filter((entity) => entity.kind === kind).length}</strong><span>{label}</span></button>)}</div>
          </section>
        </div>
        <aside className="overview-followup" aria-label="المتابعة والإجراءات">
          <section className="overview-section">
            <SectionHead title="يحتاج متابعتك" subtitle="الاستحقاقات المتأخرة · كل الفترات"><Badge tone={late.length ? "warning" : "neutral"}>{late.length}</Badge></SectionHead>
            {late.length ? late.slice(0,3).map((due) => <DueRow compact key={due.agreement_id + ":" + due.slot} due={due} />) : <Empty>لا توجد استحقاقات متأخرة.</Empty>}
            {late.length > 3 && <Button variant="ghost" onClick={() => open("alerts")}>جميع التنبيهات</Button>}
          </section>
          <section className="overview-section overview-tasks">
            <SectionHead title="مهام المتابعة">{canManageData && <Button variant="ghost" onClick={() => open("taskAdd")}><Plus size={16} /> مهمة</Button>}</SectionHead>
            {tasks.length ? tasks.slice(0,2).map((task) => <TaskRow key={task.id} task={task} />) : <Empty>كل مهام المتابعة مكتملة.</Empty>}
            <Button variant="ghost" className="section-link" onClick={() => open("tasks")}>جميع المهام <ArrowLeft size={16} /></Button>
          </section>
          <section className="future-summary">
            <span>الاستحقاقات القادمة</span>
            <div><span>تحصيل مستقبلي</span><Money value={s.future_in} /></div>
            <div><span>سداد مستقبلي</span><Money value={s.future_out} /></div>
            <small>بعد {fmtDate(data.today)}، وقد تشمل بقية الشهر الحالي.</small>
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
      (d) => d.due_date <= plusDays(data.today, 7),
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
              subtitle="مهام اليوم والقادمة خلال 7 أيام، مع إبقاء المتأخر ظاهرًا"
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
                {[
                  ["متأخرات", due => due.due_date < data.today],
                  ["مهام اليوم", due => due.due_date === data.today],
                  ["المهام القادمة", due => due.due_date > data.today],
                ].map(([label, matches]) => {
                  const rows = filtered.slice(0, limit).filter(matches);
                  return rows.length ? <section className="agenda-group" key={label} aria-label={label}>
                    <h3>{label}</h3>{rows.map(due => <DueRow due={due} key={`${due.agreement_id}:${due.slot}`}
                      selected={due === selected} onSelect={() => setSelectedKey(`${due.agreement_id}:${due.slot}`)} />)}
                  </section> : null;
                })}
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
            {data.alerts.length ? data.alerts.slice(0, 3).map(alert => <button className="task-row" key={alert.key} onClick={() => open("alerts")}>
              <span><strong>{normalizeDigits(alert.title)}</strong><small>{fmtDate(alert.due_date)}{alert.days_remaining != null ? alert.days_remaining < 0 ? " · متأخر " + Math.abs(alert.days_remaining) + " يومًا" : " · باقي " + alert.days_remaining + " يومًا" : ""}</small></span><ArrowLeft size={16} />
            </button>) : <p className="muted">لا توجد مواعيد تحتاج متابعة حاليًا.</p>}
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
        <h2>{normalizeDigits(agreement.title)}</h2>
        <Badge>{due.status}</Badge>
        <p className="muted">
          {normalizeDigits(entity?.name || "عملية مجدولة")} ·{" "}
          {agreement.rental_mode==="daily" ? agreement.booking_cancelled_at ? "حجز ملغى · مديونية محفوظة" : "حجز يومي" : agreement.frequency_months === 1
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
                <strong>{normalizeDigits(payment.note || "دفعة مسجلة")}</strong>
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
          <p>{normalizeDigits(agreement.note)}</p>
        </div>
      )}
    </div>
  );
}
