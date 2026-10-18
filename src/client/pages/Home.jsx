import React, { useMemo, useState } from "react";
import { Plus, ArrowLeft, ArrowUpLeft, Building2, Car, Users, Receipt, Search, CalendarDays, CheckSquare, TriangleAlert, Info } from "lucide-react";
import { useWallet } from "../state/WalletProvider.jsx";
import { Money, Button, Empty } from "../components/ui.jsx";
import { MonthTools, PageHeading } from "../components/workspace.jsx";
import { CashFlowChart, DueComparisonChart } from "../components/WalletCharts.jsx";
import { HomeCashFlow } from "../components/HomeCashFlow.jsx";
import { fmtDate, plusDays } from "../lib/format.js";
import { alertDestination, recordMatches } from "../../shared/client-model.mjs";
import { effectiveUnitStatus, unitStatusNames } from "../../shared/unit-status.mjs";
import { normalizeDigits } from "../../shared/numerals.mjs";

function CollectionCard({ direction, summary, navigate }) {
  const incoming = direction === "in", label = incoming ? "التحصيل" : "السداد";
  const total = summary[`due_${direction}`], paid = summary[`fulfilled_${direction}`];
  const percent = total > 0 ? Math.max(0, Math.min(100, paid / total * 100)) : 0;
  return <button className={`home-statement home-statement-${direction}`}
    aria-label={`تفاصيل ${label} للشهر`} onClick={() => navigate(incoming ? "collect" : "pay")}>
    <span className="home-statement-label">{incoming ? "إجمالي المستحق للتحصيل" : "مستحقات الدفع"}<ArrowUpLeft size={19} aria-hidden="true" /></span>
    <Money value={total} className="home-statement-total" />
    <span className="home-progress-row">
      <span className="home-progress" role="progressbar" aria-label={`نسبة ${label}`} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ transform: `scaleX(${percent / 100})` }} />
      </span><bdi>{Math.round(percent)}%</bdi>
    </span>
    <span className="home-statement-values">
      <span><small>{incoming ? "المحصّل فعليًا" : "المدفوع"}</small><Money value={paid} /></span>
      <span><small>المتبقي</small><Money value={summary[`remaining_${direction}`]} /></span>
    </span>
  </button>;
}

function Occupancy({ data, navigate }) {
  const units = data.entities.filter(entity => entity.kind === "unit" && !entity.archived);
  const counts = { rented: 0, available: 0, maintenance: 0, personal_use: 0, unavailable: 0 };
  for (const unit of units) counts[effectiveUnitStatus(unit, data.agreements, data.today)]++;
  let offset = 0;
  const slices = Object.entries(counts).map(([status, count]) => {
    const length = units.length ? count / units.length * 100 : 0;
    const slice = { status, count, length, offset }; offset += length; return slice;
  });
  return <section className="home-panel home-occupancy" aria-label="إشغال الوحدات">
    <div className="home-panel-heading"><h2>إشغال الوحدات</h2><Building2 size={20} aria-hidden="true" /></div>
    {units.length ? <>
      <div className="home-occupancy-ring" role="img" aria-label={`${units.length} وحدة: ${slices.map(s => `${s.count} ${unitStatusNames[s.status]}`).join("، ")}`}>
        <svg viewBox="0 0 180 180" aria-hidden="true"><circle className="home-ring-track" cx="90" cy="90" r="73" />
          {slices.filter(s => s.count).map(s => <circle key={s.status} className={`home-ring-${s.status}`} cx="90" cy="90" r="73" pathLength="100"
            strokeDasharray={`${Math.max(0, s.length - 0.8)} ${100 - Math.max(0, s.length - 0.8)}`} strokeDashoffset={-s.offset} />)}
        </svg><div><strong>{units.length}</strong><span>وحدة</span></div>
      </div>
      <dl className="home-occupancy-legend">{slices.filter(s => s.status !== "unavailable" || s.count).map(s => <div key={s.status}>
        <dt><i className={`home-dot home-dot-${s.status}`} />{unitStatusNames[s.status]}</dt><dd>{s.count}</dd>
      </div>)}</dl>
    </> : <Empty>أضف العقارات والوحدات من قسم الأصول ليظهر الإشغال هنا.</Empty>}
    <Button variant="ghost" className="home-section-link" onClick={() => navigate("data", "property")}>عرض الأصول <ArrowLeft size={16} /></Button>
  </section>;
}

export function ManagerHome({ navigate }) {
  const { data, month } = useWallet(), s = data.summary;
  return <div className="home-dashboard home-manager">
    <PageHeading title="نظرة عامة"><MonthTools /></PageHeading>
    <div className="home-manager-grid">
      <CollectionCard direction="in" summary={s} navigate={navigate} />
      <CollectionCard direction="out" summary={s} navigate={navigate} />
      <section className="home-panel home-cash" aria-label="حركة الأموال">
        <div className="home-panel-heading"><h2>حركة الأموال</h2></div>
        <div className="home-cash-values">
          <div><span><i className="home-dot home-dot-rented" />المقبوضات</span><Money value={s.cash_in} /></div>
          <div><span><i className="home-dot home-dot-maintenance" />المدفوعات</span><Money value={s.cash_out} /></div>
        </div>
        <HomeCashFlow data={data} month={month} />
        <div className="home-net"><span>صافي الحركة <Info size={15} aria-label="المقبوضات ناقص المدفوعات، ولا يمثل رصيدًا بنكيًا" /></span><Money value={s.net} className={s.net < 0 ? "danger-text" : "success-text"} /></div>
      </section>
      <Occupancy data={data} navigate={navigate} />
    </div>
    <div className="home-portfolio" aria-label="الأصول المسجلة">
      {[["property", "عقارات", Building2], ["car", "سيارات", Car], ["worker", "عمال", Users]].map(([kind, label, Icon]) => <button key={kind} onClick={() => navigate("data", kind)}>
        <Icon size={20} aria-hidden="true" /><strong>{data.entities.filter(e => e.kind === kind && !e.archived).length}</strong><span>{label}</span><ArrowLeft size={16} aria-hidden="true" />
      </button>)}
    </div>
    <details className="home-analysis">
      <summary>تفاصيل التقرير</summary>
      <p className="muted">التحصيل والسداد أعلاه يخصان استحقاقات الشهر المحدد. حركة الأموال تخص تاريخ التنفيذ الفعلي، ولا تمثل رصيدًا بنكيًا.</p>
      <div className="home-future-values"><span>تحصيل مستقبلي <Money value={s.future_in} /></span><span>سداد مستقبلي <Money value={s.future_out} /></span></div>
      <p className="muted">الاستحقاقات بعد {fmtDate(data.today)}، وقد تشمل بقية الشهر الحالي.</p>
      <CashFlowChart data={data} month={month} /><DueComparisonChart summary={s} month={month} />
    </details>
  </div>;
}

// One timeline, using the dates and destinations already supplied by the system.
function agendaEntries(data) {
  const entities = new Map([...(data.archived_entities || []), ...data.entities].map(entity => [entity.id, entity]));
  const agreements = new Map(data.agreements.map(agreement => [agreement.id, agreement]));
  const cutoff = plusDays(data.today, 7);
  const entries = data.dues.filter(due => due.due_date <= cutoff).map(due => {
    const entity = entities.get(due.entity_id), agreement = agreements.get(due.agreement_id);
    return { key: `due:${due.agreement_id}:${due.slot}`, type: due.direction, date: due.due_date,
      title: due.title, description: [entities.get(entity?.parent_id)?.name, entity?.name, agreement?.counterparty].filter(Boolean).join(" · "),
      phone: agreement?.phone, due, Icon: entity?.kind === "car" ? Car : due.kind === "rent" ? Building2 : Receipt };
  });
  for (const task of data.tasks.filter(t => t.state === "open")) entries.push({ key: `task:${task.id}`, type: "followup", date: task.due_date || data.today, title: task.title, description: task.description || "مهمة متابعة", task, Icon: CheckSquare });
  for (const alert of data.alerts) entries.push({ key: `alert:${alert.key}`, type: "followup", date: alert.due_date || data.today, title: alert.title, description: alert.source, alert, Icon: CalendarDays });
  return entries.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key));
}

function AgendaCard({ entry, compact = false }) {
  const { data, open, canManageData, loading, error } = useWallet();
  const { Icon, due, task, alert } = entry;
  const days = Math.round((Date.parse(entry.date + "T12:00:00Z") - Date.parse(data.today + "T12:00:00Z")) / 86400000);
  const destination = alert ? alertDestination(alert, data) : null;
  const details = () => due ? open("agreementDetails", { id: due.agreement_id }) : task ? open(canManageData ? "taskToggle" : "tasks", { id: task.id }) : destination ? open(destination.action, { id: destination.id }) : open("alerts");
  return <article className={`home-agenda-card ${due?.direction === "in" ? "home-agenda-income" : ""} ${compact ? "home-agenda-compact" : ""}`}>
    <button className="home-agenda-main" onClick={details} aria-label={`تفاصيل ${normalizeDigits(entry.title)}`}>
      {compact && days > 0 ? <span className="home-date-tile" aria-label={fmtDate(entry.date)}><bdi>{Number(entry.date.slice(-2))}</bdi><small>{new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", { month: "short", timeZone: "UTC" }).format(new Date(entry.date + "T12:00:00Z"))}</small></span> : <span className="home-agenda-icon"><Icon size={20} aria-hidden="true" /></span>}
      <span><strong>{normalizeDigits(entry.title)}</strong><small>{normalizeDigits(entry.description)}</small></span>
    </button>
    <div className="home-agenda-meta">{due && <Money value={due.amount_cents} />}
      {days !== 0 && <small className={days < 0 ? "danger-text" : "home-countdown"}>{days < 0 ? `متأخر ${Math.abs(days)} يومًا` : `باقي ${days} يومًا`}</small>}
    </div>
    {canManageData && <Button className={due?.direction === "in" ? "home-collect-button" : ""} disabled={loading || Boolean(error)} onClick={() => due ? open("payConfirm", { id: `${due.agreement_id}::${due.slot}` }) : details()}>
      {due ? due.direction === "in" ? "تحصيل" : "تسجيل الدفع" : task ? "إتمام المهمة" : "متابعة"}
    </Button>}
  </article>;
}

function AgendaList({ entries, compact = false, empty }) {
  const [limit, setLimit] = useState(6);
  return <>{entries.length ? entries.slice(0, limit).map(entry => <AgendaCard key={entry.key} entry={entry} compact={compact} />) : <Empty>{empty}</Empty>}
    {entries.length > limit && <Button variant="ghost" className="home-section-link" onClick={() => setLimit(limit + 12)}>عرض المزيد ({entries.length - limit})</Button>}
  </>;
}

export function AssistantHome({ navigate }) {
  const { data, open, canManageData } = useWallet();
  const [scope, setScope] = useState("all"), [query, setQuery] = useState("");
  const entries = useMemo(() => agendaEntries(data), [data]);
  const matching = entries.filter(entry => recordMatches(entry, query, [entry.description, entry.phone]));
  const today = matching.filter(e => e.date === data.today && (scope === "all" || e.type === scope));
  const late = matching.filter(e => e.date < data.today);
  const upcoming = matching.filter(e => e.date > data.today && e.date <= plusDays(data.today, 7));
  const later = matching.filter(e => e.date > plusDays(data.today, 7) && !e.due);
  return <div className="home-dashboard home-assistant">
    <PageHeading title={<>مهام اليوم <span className="home-title-count">{entries.filter(e => e.date === data.today).length}</span></>} subtitle={fmtDate(data.today)}>
      {canManageData && <Button variant="primary" aria-label="إضافة جديدة" onClick={() => open("quickadd")}><Plus size={20} />إضافة</Button>}
    </PageHeading>
    <div className="home-assistant-grid">
      <div className="home-today-column">
        <label className="home-search"><Search size={20} aria-hidden="true" /><span className="sr-only">البحث في المهام</span><input type="search" value={query} onChange={e => setQuery(normalizeDigits(e.target.value))} placeholder="ابحث عن وحدة، سيارة أو اسم…" /></label>
        <div className="home-task-filters" role="group" aria-label="تصفية مهام اليوم">{[["all", "الكل"], ["in", "تحصيل"], ["out", "دفع"], ["followup", "متابعة"]].map(([key, label]) => <button key={key} aria-pressed={scope === key} onClick={() => setScope(key)}>{label}</button>)}</div>
        <section className="home-today" aria-label="مهام اليوم"><AgendaList key={scope + query} entries={today} empty={query || scope !== "all" ? "لا توجد مهام تطابق هذا الاختيار." : "لا توجد مهام مستحقة اليوم."} /></section>
        <section className="home-followup" aria-label="تحتاج متابعة">
          <div className="home-panel-heading"><h2><TriangleAlert size={17} aria-hidden="true" />تحتاج متابعة <span>{late.length}</span></h2></div>
          <AgendaList entries={late} compact empty="لا توجد مهام أو استحقاقات متأخرة." />
        </section>
        <div className="home-assistant-links">
          <Button variant="ghost" onClick={() => open("tasks")}>جميع المهام <ArrowLeft size={16} /></Button>
          {canManageData && <Button variant="ghost" onClick={() => open("taskAdd")}><Plus size={16} />إضافة مهمة</Button>}
          <Button variant="ghost" onClick={() => navigate("data", "property")}>الأصول والحجوزات <ArrowLeft size={16} /></Button>
        </div>
      </div>
      <aside className="home-upcoming" aria-label="المهام القادمة">
        <div className="home-panel-heading"><h2>المهام القادمة</h2><CalendarDays size={19} aria-hidden="true" /></div>
        <AgendaList entries={upcoming} compact empty="لا توجد مهام خلال الأيام الـ7 القادمة." />
        {later.length > 0 && <details className="home-early-reminders"><summary>مواعيد لاحقة وتنبيهات مبكرة ({later.length})</summary><AgendaList entries={later} compact /></details>}
        <Button variant="ghost" className="home-section-link" onClick={() => open("alerts")}>جميع التنبيهات <ArrowLeft size={16} /></Button>
      </aside>
    </div>
  </div>;
}
