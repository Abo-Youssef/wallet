import React, { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "../state/WalletProvider.jsx";
import {
  Money,
  Badge,
  Empty,
  Button,
  Field,
  Modal,
  useFormMutation,
} from "../components/ui.jsx";
import {
  fmtDate,
  money,
  entityById,
  agreementById,
  plusDays,
} from "../lib/format.js";
import {
  alertDestination,
  buildMonthStatement,
  formatRiyadhDate,
} from "../../shared/client-model.mjs";
import {
  historyPeriod,
  parseHistoryFilters,
  filterHistory,
} from "../../shared/history.mjs";
import { statementCSV } from "../../shared/statements.mjs";
import { normalizeDigits } from "../../shared/numerals.mjs";
import { propertyTypeNames } from "../../shared/property-types.mjs";
import RestoreDialog from "./RestoreDialog.jsx";

function MutationMessage({ error, uncertain }) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {normalizeDigits(typeof error === "string" ? error : error.message)}
        </p>
      )}
      {uncertain && (
        <p className="notice">
          نتيجة الإرسال لم تتأكد. أعد المحاولة بالبيانات نفسها لتأكيدها.
        </p>
      )}
    </>
  );
}
function download(contents, type, name) {
  const url = URL.createObjectURL(new Blob([contents], { type })),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function savedMessage(notify, result, message) {
  notify(
    result?.refreshed === false
      ? message + "؛ تعذر تحديث العرض. حدّث البيانات."
      : message,
    result?.refreshed === false,
  );
}

function TaskRow({ task }) {
  const { data, notify, canManageData } = useWallet(),
    { submit, pending, error, uncertain } = useFormMutation();
  const done = task.state === "done",
    late = !done && task.due_date && task.due_date < data.today;
  return (
    <div className="record-row task-record">
      <div className="record-main">
        <strong>{normalizeDigits(task.title)}</strong>
        {task.description && <p className="muted">{normalizeDigits(task.description)}</p>}
        <small className="muted">
          {task.due_date ? fmtDate(task.due_date) : "دون موعد محدد"}
        </small>
        <MutationMessage error={error} uncertain={uncertain} />
      </div>
      <Badge tone={done ? "success" : late ? "danger" : "neutral"}>
        {done ? "مكتملة" : late ? "متأخرة" : "مفتوحة"}
      </Badge>
      {canManageData && <Button
        variant="secondary"
        disabled={pending}
        onClick={() =>
          submit(
            "/api/tasks/" + task.id,
            { state: done ? "open" : "done", expected_version: task.version },
            (result) =>
              savedMessage(
                notify,
                result,
                done ? "أُعيد فتح المهمة" : "تم إنجاز المهمة",
              ),
            "PATCH",
          )
        }
      >
        {pending ? "جارٍ الحفظ…" : done ? "إعادة فتح" : "تم التنفيذ"}
      </Button>}
    </div>
  );
}
function TasksDialog() {
  const { data, isAssistant, canManageData, open, close } = useWallet();
  const [filter, setFilter] = useState("open"),
    tasks = data.tasks.filter(
      (t) =>
        filter === "all" ||
        (filter === "done" ? t.state === "done" : t.state !== "done"),
    );
  return (
    <Modal title="المهام والمتابعة" onClose={close} wide>
      <div className="section-head">
        <p className="muted">
          {isAssistant
            ? "مهامك اليومية وما أُسند إليك."
            : "تابع المهام وإنجازها. فعّل وضع المساعد لإضافة مهمة أو تعديلها."}
        </p>
        {canManageData && <Button variant="primary" onClick={() => open("taskAdd")}>
          {isAssistant ? "مهمة شخصية" : "مهمة للمساعد"}
        </Button>}
      </div>
      <div className="tabs" aria-label="حالة المهام">
        {[
          ["open", "المفتوحة"],
          ["done", "المكتملة"],
          ["all", "الكل"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={filter === value}
            className={filter === value ? "active" : ""}
            onClick={() => setFilter(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="stack">
        {tasks.length ? (
          tasks.map((task) => <TaskRow key={task.id} task={task} />)
        ) : (
          <Empty>
            {filter === "open"
              ? "كل المهام منجزة. يمكنك إضافة متابعة جديدة."
              : "لا توجد مهام في هذا التصنيف."}
          </Empty>
        )}
      </div>
    </Modal>
  );
}
function TaskForm({ dialog }) {
  const { data, isAssistant, canManageData, close, notify } = useWallet(),
    { submit, pending, error, uncertain } = useFormMutation();
  const [values, setValues] = useState({
      title: dialog.title || "",
      description: dialog.description || "",
      due_date: dialog.due_date || data.today,
    }),
    [dirty, setDirty] = useState(false);
  const change = (e) => {
    setDirty(true);
    setValues((v) => ({ ...v, [e.target.name]: e.target.value }));
  };
  const save = (e) => {
    e.preventDefault();
    submit("/api/tasks", values, (result) => {
      setDirty(false);
      close();
      savedMessage(notify, result, "تم حفظ المهمة");
    });
  };
  if (!canManageData) return <Modal title="عرض فقط" onClose={close}><Empty>فعّل وضع المساعد من المزيد لتسجيل التغييرات.</Empty></Modal>;
  return (
    <Modal
      title={isAssistant ? "مهمة شخصية جديدة" : "مهمة جديدة للمساعد"}
      onClose={close}
      dirty={dirty || uncertain}
      busy={pending}
      uncertain={uncertain}
    >
      <form onSubmit={save}>
        <fieldset disabled={pending || uncertain}>
          <div className="form-grid">
            <Field label="عنوان المهمة">
              <input
                name="title"
                value={values.title}
                onChange={change}
                required
                maxLength="180"
                autoFocus
              />
            </Field>
            <Field label="موعد التنفيذ">
              <input
                name="due_date"
                type="date"
                value={values.due_date}
                onChange={change}
              />
            </Field>
            <Field label="التفاصيل">
              <textarea
                name="description"
                value={values.description}
                onChange={change}
                rows="4"
                maxLength="1200"
              />
            </Field>
          </div>
        </fieldset>
        <MutationMessage error={error} uncertain={uncertain} />
        <div className="form-actions">
          <Button variant="primary" type="submit" disabled={pending}>
            {pending
              ? "جارٍ الحفظ…"
              : uncertain
                ? "تأكيد نتيجة الإرسال"
                : "حفظ المهمة"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function AlertRow({ alert }) {
  const { data, canManageData, open, notify } = useWallet(),
    { submit, pending, error, uncertain } = useFormMutation(),
    destination = alertDestination(alert, data);
  return (
    <div className="record-row">
      <div className="record-main">
        <strong>{normalizeDigits(alert.title)}</strong>
        <p className="muted">
          {alert.source} · {fmtDate(alert.due_date)}
        </p>
        <MutationMessage error={error} uncertain={uncertain} />
      </div>
      <Badge tone={alert.late ? "danger" : "warning"}>
        {alert.late ? "متأخر" : "قادم"}
      </Badge>
      <div className="record-actions">
        {destination && (
          <Button
            variant="secondary"
            onClick={() => open(destination.action, { id: destination.id })}
          >
            {destination.label}
          </Button>
        )}
        {canManageData && (
          <Button
            variant="ghost"
            disabled={pending}
            onClick={() =>
              submit("/api/alerts/dismiss", { key: alert.key }, (result) =>
                savedMessage(notify, result, "تمت متابعة التنبيه"),
              )
            }
          >
            {pending ? "جارٍ الحفظ…" : "تمت المتابعة"}
          </Button>
        )}
      </div>
    </div>
  );
}
function AlertsDialog() {
  const { data, open, close } = useWallet(),
    dues = data.dues.filter((d) => d.due_date <= plusDays(data.today, 7));
  return (
    <Modal title="التنبيهات والمتابعات" onClose={close} wide>
      <p className="muted">
        متابعة التنبيه تخفيه من القائمة، ولا تغير السجل أو تؤكد حركة مالية.
      </p>
      <section className="stack">
        <h3>التنبيهات الإدارية</h3>
        {data.alerts.length ? (
          data.alerts.map((alert) => <AlertRow key={alert.key} alert={alert} />)
        ) : (
          <Empty>لا توجد تنبيهات إدارية تحتاج متابعة.</Empty>
        )}
        <h3>الاستحقاقات خلال 7 أيام والمتأخرة</h3>
        {dues.length ? (
          dues.map((due) => (
            <div
              className="record-row"
              key={
                due.id || `${due.agreement_id}:${due.slot_index ?? due.slot}`
              }
            >
              <div className="record-main">
                <strong>
                  {normalizeDigits(due.title ||
                    agreementById(data, due.agreement_id)?.title ||
                    "استحقاق")}
                </strong>
                <p className="muted">
                  {fmtDate(due.due_date)} ·{" "}
                  {due.direction === "in" ? "تحصيل" : "سداد"}
                </p>
              </div>
              <Money value={due.amount_cents} />
              <Badge tone={due.status === "متأخر" ? "danger" : "neutral"}>
                {due.status}
              </Badge>
              <Button
                variant="secondary"
                onClick={() =>
                  open("agreementDetails", { id: due.agreement_id })
                }
              >
                مراجعة الاتفاق
              </Button>
            </div>
          ))
        ) : (
          <Empty>لا توجد استحقاقات قريبة أو متأخرة.</Empty>
        )}
      </section>
    </Modal>
  );
}

const detailLabels = {
  property_type: "نوع العقار",
  name: "الاسم",
  title: "العنوان",
  kind: "النوع",
  status: "الحالة",
  direction: "الاتجاه",
  parent_id: "العقار التابع له",
  entity_id: "الأصل المرتبط",
  agreement_id: "الاتفاق",
  reference_value_cents: "القيمة المرجعية",
  location: "الموقع",
  electricity_meter: "عداد الكهرباء",
  plate: "رقم اللوحة",
  insurance_expiry: "انتهاء التأمين",
  maintenance_date: "موعد الصيانة",
  odometer_km: "الكيلومترات الحالية",
  maintenance_due_km: "الصيانة عند",
  phone: "التواصل",
  work_location: "مكان العمل",
  iqama_number: "رقم الإقامة",
  iqama_expiry: "انتهاء الإقامة",
  passport_number: "رقم الجواز",
  passport_expiry: "انتهاء الجواز",
  notes: "ملاحظات",
  note: "ملاحظات",
  description: "التفاصيل",
  contract_number: "رقم العقد",
  counterparty: "الطرف المرتبط",
  start_date: "بداية العقد",
  end_date: "نهاية العقد",
  schedule_end_date: "نهاية جدول الدفعات",
  first_due_date: "أول استحقاق",
  due_date: "موعد التنفيذ",
  total_cents: "إجمالي القيمة",
  opening_cents: "المدفوع قبل التأسيس",
  installment_count: "عدد الأقساط",
  frequency_months: "الدورية بالأشهر",
  amount_cents: "المبلغ",
  paid_at: "التنفيذ الفعلي",
  slot_index: "رقم القسط",
  reschedule_method: "طريقة الجدولة",
  active: "حالة الحركة",
  archived: "الأرشفة",
  state: "حالة المهمة",
  assigned_to: "المكلّف",
  completed_at: "وقت الإتمام",
  completed_by: "أتمها",
  dismissed: "متابعة التنبيه",
  hidden: "إخفاء من العرض",
  closed_at: "تاريخ الإغلاق",
  closed_by: "أغلقه",
  vacated_on: "تاريخ الإخلاء",
  vacated_at: "وقت حفظ الإخلاء",
  vacated_by: "أكد الإخلاء",
  vacate_note: "ملاحظة الإخلاء",
  rental_mode: "نوع الإيجار",
  booking_cancelled_at: "وقت إلغاء الحجز",
  booking_cancelled_by: "ألغى الحجز",
  booking_cancel_note: "سبب إلغاء الحجز",
  paid_total_cents: "المحصّل المحفوظ",
  remaining_cents: "المديونية المتبقية",
};
const valueLabels = {
  daily: "حجز يومي",
  period: "إيجار دوري",
  ...propertyTypeNames,
  property: "عقار",
  unit: "وحدة",
  car: "سيارة",
  worker: "عامل",
  purchase: "شراء",
  sale: "بيع",
  rent: "إيجار",
  other: "أخرى",
  in: "تحصيل",
  out: "سداد",
  active: "نشط",
  closed: "مغلق",
  cancelled: "ملغى",
  available: "متاحة",
  rented: "مؤجرة",
  maintenance: "صيانة",
  unavailable: "غير متاحة",
  shorten: "تقليل المدة",
  spread: "تقليل قيمة الأقساط",
  open: "مفتوحة",
  done: "مكتملة",
  manager: "المدير",
  assistant: "المساعد",
};
function detailValue(key, value, data) {
  if (value == null || value === "") return "—";
  if (key.endsWith("_cents")) return money(value) + " ر.س";
  if (key === "slot_index") return String(Number(value) + 1);
  if (key === "closed_at") return formatRiyadhDate(value);
  if (["entity_id", "parent_id"].includes(key))
    return normalizeDigits(entityById(data, value)?.name || "سجل مرتبط / مؤرشف");
  if (key === "agreement_id")
    return normalizeDigits(agreementById(data, value)?.title || "اتفاق مرتبط");
  if (key === "active") return Number(value) === 1 ? "سارية" : "ملغاة";
  if (["archived", "dismissed", "hidden"].includes(key))
    return value ? "نعم" : "لا";
  if (
    [
      "kind",
      "property_type",
      "direction",
      "status",
      "reschedule_method",
      "state",
      "assigned_to",
    ].includes(key)
  )
    return valueLabels[value] || normalizeDigits(value);
  return normalizeDigits(value);
}
function HistoryEntry({ entry, onHidden }) {
  const { data, isAssistant, canManageData, notify } = useWallet(),
    { submit, pending, error, uncertain } = useFormMutation(),
    [confirm, setConfirm] = useState(false);
  let before = null,
    after = null;
  try {
    before = JSON.parse(entry.before_json || "null");
    after = JSON.parse(entry.after_json || "null");
  } catch {}
  const detail = after || before || {},
    keys = [
      ...new Set([...Object.keys(before || {}), ...Object.keys(after || {})]),
    ].filter(
      (k) =>
        detailLabels[k] &&
        before?.[k] !== after?.[k] &&
        [before?.[k], after?.[k]].some((v) => v != null && v !== ""),
    );
  const types = {
    entity: "بيانات",
    agreement: "اتفاق",
    payment: "حركة مالية",
    expense: "مصروف",
    task: "مهمة",
    alert: "تنبيه",
    audit: "السجل",
  };
  let when = "—";
  try {
    when = new Intl.DateTimeFormat("ar-SA-u-ca-gregory-nu-latn", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Riyadh",
    }).format(new Date(entry.created_at));
  } catch {}
  return (
    <article className="history-entry">
      <div className="section-head">
        <div>
          <strong>{entry.action}</strong>{" "}
          <Badge>{types[entry.target_type] || entry.target_type}</Badge>
          {(detail.title || detail.name) && (
            <p>{normalizeDigits(detail.title || detail.name)}</p>
          )}
          <div className="muted">
            <bdi>{normalizeDigits(entry.actor)}</bdi> ·{" "}
            <time dateTime={entry.created_at}>{when}</time>
          </div>
        </div>
        {!isAssistant && canManageData && !confirm && (
          <Button variant="ghost" onClick={() => setConfirm(true)}>
            إزالة من العرض
          </Button>
        )}
      </div>
      {keys.length > 0 && (
        <details className="audit-details">
          <summary>تفاصيل التغيير</summary>
          <div
            className="tablewrap"
            tabIndex="0"
            role="region"
            aria-label="تفاصيل التغيير"
          >
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">الحقل</th>
                  <th scope="col">قبل</th>
                  <th scope="col">بعد</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((key) => (
                  <tr key={key}>
                    <th scope="row">{detailLabels[key]}</th>
                    <td>{detailValue(key, before?.[key], data)}</td>
                    <td>{detailValue(key, after?.[key], data)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {confirm && canManageData && (
        <div className="notice">
          <p>إزالة العملية من العرض؟ سيبقى أثرها محفوظًا في سجل التدقيق.</p>
          <div className="record-actions">
            <Button
              variant="danger"
              disabled={pending}
              onClick={() =>
                submit("/api/history/" + entry.id + "/hide", {}, () => {
                  notify("أُزيلت العملية من العرض مع حفظ أثرها");
                  onHidden();
                })
              }
            >
              {pending ? "جارٍ الحفظ…" : "إزالة من العرض"}
            </Button>
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              إلغاء
            </Button>
          </div>
        </div>
      )}
      <MutationMessage error={error} uncertain={uncertain} />
    </article>
  );
}
const initialHistory = { from: "", to: "", sort: "newest", preset: "all" };
function HistoryDialog() {
  const { api, data, close } = useWallet(),
    [draft, setDraft] = useState(initialHistory),
    [applied, setApplied] = useState(initialHistory),
    [validation, setValidation] = useState(""),
    [result, setResult] = useState({
      entries: [],
      next_cursor: null,
      has_more: false,
    }),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const request = useRef(0),
    alive = useRef(true),
    apiRef = useRef(api);
  apiRef.current = api;
  async function load(filters = applied, cursor = null) {
    const seq = ++request.current;
    setPending(true);
    setError("");
    if (!cursor) setResult({ entries: [], next_cursor: null, has_more: false });
    const params = new URLSearchParams({
      from: filters.from,
      to: filters.to,
      sort: filters.sort,
    });
    if (cursor) params.set("cursor", cursor);
    try {
      const response =
        __PREVIEW__ && globalThis.walletPreview
          ? filterHistory(
              globalThis.walletPreview.history(),
              parseHistoryFilters(params),
            )
          : await apiRef.current("/api/history?" + params);
      if (!alive.current || seq !== request.current) return;
      setResult((previous) => ({
        ...response,
        entries: cursor
          ? [
              ...new Map(
                [...previous.entries, ...response.entries].map((e) => [
                  e.id,
                  e,
                ]),
              ).values(),
            ]
          : response.entries,
      }));
    } catch (failure) {
      if (alive.current && seq === request.current) setError(failure.message);
    } finally {
      if (alive.current && seq === request.current) setPending(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current++;
    };
  }, []);
  useEffect(() => {
    load(applied);
  }, [applied]);
  const changePreset = (value) => {
    if (value === "custom") {
      setDraft((v) => ({ ...v, preset: value }));
      return;
    }
    setDraft((v) => ({
      ...v,
      preset: value,
      ...historyPeriod(value, data.today),
    }));
  };
  const apply = (e) => {
    e.preventDefault();
    try {
      parseHistoryFilters(
        new URLSearchParams({
          from: draft.from,
          to: draft.to,
          sort: draft.sort,
        }),
      );
      setValidation("");
      setApplied({ ...draft });
    } catch (failure) {
      setValidation(failure.message);
    }
  };
  return (
    <Modal title="سجل العمليات" onClose={close} wide>
      <p className="muted">
        وقت تسجيل الإضافة أو التعديل أو الحذف، بتوقيت الرياض. تشمل الفترة يومَي
        البداية والنهاية.
      </p>
      <form className="history-filters" onSubmit={apply}>
        <div className="form-grid">
          <Field label="الفترة">
            <select
              value={draft.preset}
              onChange={(e) => changePreset(e.target.value)}
            >
              {[
                ["all", "كل الفترات"],
                ["today", "اليوم"],
                ["week", "آخر 7 أيام"],
                ["month", "هذا الشهر حتى اليوم"],
                ["year", "هذا العام حتى اليوم"],
                ["custom", "فترة مخصصة"],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الترتيب">
            <select
              value={draft.sort}
              onChange={(e) =>
                setDraft((v) => ({ ...v, sort: e.target.value }))
              }
            >
              <option value="newest">الأحدث أولًا</option>
              <option value="oldest">الأقدم أولًا</option>
            </select>
          </Field>
          <Field label="من تاريخ">
            <input
              type="date"
              min="1000-01-01"
              max="9999-12-31"
              value={draft.from}
              onChange={(e) =>
                setDraft((v) => ({
                  ...v,
                  preset: "custom",
                  from: e.target.value,
                }))
              }
            />
          </Field>
          <Field label="إلى تاريخ">
            <input
              type="date"
              min="1000-01-01"
              max="9999-12-31"
              value={draft.to}
              onChange={(e) =>
                setDraft((v) => ({
                  ...v,
                  preset: "custom",
                  to: e.target.value,
                }))
              }
            />
          </Field>
        </div>
        {validation && (
          <p className="form-error" role="alert">
            {validation}
          </p>
        )}
        <div className="form-actions">
          <Button variant="primary" type="submit">
            تطبيق الفترة
          </Button>
          <Button
            variant="secondary"
            type="button"
            onClick={() => {
              setDraft(initialHistory);
              setApplied({ ...initialHistory });
              setValidation("");
            }}
          >
            إعادة ضبط
          </Button>
        </div>
      </form>
      <div className="history-results" aria-live="polite" aria-busy={pending}>
        <div className="section-head">
          <strong>{result.entries.length} عملية معروضة</strong>
          <small className="muted">
            {applied.from || applied.to
              ? `${applied.from ? fmtDate(applied.from) : "بداية السجل"} إلى ${applied.to ? fmtDate(applied.to) : "آخر عملية"}`
              : "كل الفترات"}{" "}
            · {applied.sort === "newest" ? "الأحدث أولًا" : "الأقدم أولًا"}
          </small>
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() =>
                load(applied, result.entries.length ? result.next_cursor : null)
              }
            >
              إعادة المحاولة
            </Button>
          </div>
        )}
        {result.entries.map((entry) => (
          <HistoryEntry
            key={entry.id}
            entry={entry}
            onHidden={() => load(applied)}
          />
        ))}
        {pending && (
          <p className="muted" role="status">
            جارٍ تحميل العمليات…
          </p>
        )}
        {!pending && !error && !result.entries.length && (
          <Empty>لا توجد عمليات ضمن هذه الفترة.</Empty>
        )}
        {result.has_more && !pending && (
          <Button
            variant="secondary"
            onClick={() => load(applied, result.next_cursor)}
          >
            عرض المزيد
          </Button>
        )}
      </div>
    </Modal>
  );
}

function StatementDialog() {
  const { data, loading, error, close, notify } = useWallet();
  const statement = useMemo(
    () => (!loading && !error ? buildMonthStatement(data) : null),
    [data, loading, error],
  );
  useEffect(
    () => () => document.body.classList.remove("printing-statement"),
    [],
  );
  if (!statement)
    return (
      <Modal title="كشف الشهر" onClose={close}>
        <Empty>أكمل تحديث بيانات الشهر قبل فتح الكشف.</Empty>
      </Modal>
    );
  const summary = statement.summary;
  const print = () => {
    document.body.classList.add("printing-statement");
    const cleanup = () => document.body.classList.remove("printing-statement");
    window.addEventListener("afterprint", cleanup, { once: true });
    try {
      window.print();
    } catch (failure) {
      cleanup();
      notify(failure.message, true);
    }
  };
  return (
    <Modal title={"كشف شهر " + statement.month} onClose={close} wide>
      <div className="statement-toolbar screen-only">
        <Button variant="primary" onClick={print}>
          طباعة الكشف
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            download(
              statementCSV(statement),
              "text/csv;charset=utf-8",
              `wallet-transactions-${statement.month}.csv`,
            );
            notify("تم تصدير الحركات المنفذة خلال الشهر");
          }}
        >
          تصدير CSV
        </Button>
      </div>
      <section className="statement-document" aria-label="الكشف الشهري">
        <header className="statement-heading">
          <span className="eyebrow">wallet · كشف شهري</span>
          <h2>
            <bdi>{statement.month}</bdi>
          </h2>
          <p className="muted">
            جميع المبالغ بالريال السعودي. الاستحقاقات منفصلة عن التنفيذ النقدي.
          </p>
        </header>
        <h3>استحقاقات الشهر المختار</h3>
        <div className="tablewrap">
          <table className="data-table statement-summary-table">
            <thead>
              <tr>
                <th scope="col">البيان</th>
                <th scope="col">تحصيل</th>
                <th scope="col">سداد</th>
              </tr>
            </thead>
            <tbody>
              {[
                ["إجمالي المستحق", "due_in", "due_out"],
                ["منفذ من هذه الاستحقاقات", "fulfilled_in", "fulfilled_out"],
                ["المتبقي", "remaining_in", "remaining_out"],
              ].map(([label, incoming, outgoing]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>
                    <Money value={summary[incoming]} />
                  </td>
                  <td>
                    <Money value={summary[outgoing]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <h3>النقد المنفذ خلال الشهر</h3>
        <dl className="statement-cash entity-facts">
          {[
            ["دخل فعليًا", "cash_in"],
            ["خرج فعليًا", "cash_out"],
            ["صافي التدفق", "net"],
          ].map(([label, key]) => (
            <div key={key}>
              <dt>{label}</dt>
              <dd>
                <Money value={summary[key]} />
              </dd>
            </div>
          ))}
        </dl>
        <p className="muted">
          الصافي هو الداخل ناقص الخارج خلال الشهر، ولا يمثل رصيد حساب بنكي.
        </p>
        <h3>الحركات المنفذة ({statement.transactions.length})</h3>
        {statement.transactions.length ? (
          <div
            className="tablewrap"
            tabIndex="0"
            role="region"
            aria-label="حركات الشهر؛ يمكن التمرير أفقيًا"
          >
            <table className="data-table">
              <thead>
                <tr>
                  {[
                    "تاريخ التنفيذ",
                    "النوع",
                    "العملية / الأصل",
                    "المبلغ",
                    "الملاحظات",
                  ].map((label) => (
                    <th key={label} scope="col">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statement.transactions.map((transaction) => (
                  <tr key={transaction.id}>
                    <td>{fmtDate(transaction.date)}</td>
                    <td>{transaction.type}</td>
                    <td>
                      {normalizeDigits(transaction.title)}
                      {transaction.entity && (
                        <small className="muted">{normalizeDigits(transaction.entity)}</small>
                      )}
                    </td>
                    <td>
                      <Money value={transaction.amount_cents} />
                    </td>
                    <td>{normalizeDigits(transaction.note || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>لا توجد حركات منفذة خلال هذا الشهر.</Empty>
        )}
        <p className="muted statement-footnote">
          القيم الافتتاحية قبل تأسيس المحفظة لا تدخل في الحركات النقدية. يعكس
          الكشف آخر بيانات محمّلة للشهر.
        </p>
      </section>
    </Modal>
  );
}
function BackupDialog() {
  const { data, isAssistant, api, close, notify } = useWallet(),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const save = async () => {
    if (pending || isAssistant) return;
    setPending(true);
    setError("");
    try {
      const backup = await api("/api/backup");
      download(
        JSON.stringify(backup, null, 2),
        "application/json;charset=utf-8",
        `wallet-backup-${data.today}.json`,
      );
      notify("تم تصدير النسخة الاحتياطية");
      close();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setPending(false);
    }
  };
  return (
    <Modal title="نسخة احتياطية" onClose={close} busy={pending}>
      {isAssistant ? (
        <Empty>تصدير النسخة الاحتياطية متاح للمدير.</Empty>
      ) : (
        <>
          <p>نزّل نسخة من بيانات المحفظة وسجلها لحفظها لديك.</p>
          <p className="muted">
            الملف يحتوي على بيانات مالية وشخصية. احفظه في مكان آمن.
          </p>
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
          <div className="form-actions">
            <Button variant="primary" disabled={pending} onClick={save}>
              {pending ? "جارٍ تجهيز النسخة…" : "تنزيل النسخة الاحتياطية"}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={close}>
              إلغاء
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
function OperationConfirm({ dialog }) {
  const { data, canManageData, close, notify } = useWallet(),
    { submit, pending, error, uncertain } = useFormMutation();
  const task =
    dialog.type === "taskToggle"
      ? data.tasks.find((t) => t.id === dialog.id)
      : null;
  if (dialog.type === "taskToggle" && !task)
    return (
      <Modal title="المهمة" onClose={close}>
        <Empty>لم تعد المهمة موجودة. حدّث البيانات.</Empty>
      </Modal>
    );
  if (!canManageData)
    return (
      <Modal title="عرض فقط" onClose={close}>
        <Empty>فعّل وضع المساعد من المزيد لتسجيل التغييرات.</Empty>
      </Modal>
    );
  const done = task?.state === "done",
    title = task
      ? done
        ? "إعادة فتح المهمة"
        : "تأكيد إنجاز المهمة"
      : "متابعة التنبيه";
  const save = () =>
    submit(
      task ? "/api/tasks/" + task.id : "/api/alerts/dismiss",
      task
        ? { state: done ? "open" : "done", expected_version: task.version }
        : { key: dialog.key || dialog.id },
      (result) => {
        close();
        savedMessage(
          notify,
          result,
          task ? "تم تحديث المهمة" : "تمت متابعة التنبيه",
        );
      },
      task ? "PATCH" : "POST",
    );
  return (
    <Modal title={title} onClose={close} busy={pending}>
      <p>
        {normalizeDigits(task?.title ||
          "سيُخفى التنبيه من القائمة دون تغيير السجل أو تسجيل حركة مالية.")}
      </p>
      <MutationMessage error={error} uncertain={uncertain} />
      <div className="form-actions">
        <Button variant="primary" disabled={pending} onClick={save}>
          {pending ? "جارٍ الحفظ…" : title}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={close}>
          إلغاء
        </Button>
      </div>
    </Modal>
  );
}

export default function OperationsDialogs({ dialog }) {
  const { isAssistant, close } = useWallet();
  if (!dialog) return null;
  switch (dialog.type) {
    case "tasks":
      return <TasksDialog />;
    case "taskAdd":
    case "taskForm":
      return <TaskForm dialog={dialog} />;
    case "alerts":
      return <AlertsDialog />;
    case "history":
      return isAssistant ? <Modal title="سجل العمليات" onClose={close}><Empty>سجل العمليات متاح للمدير فقط.</Empty></Modal> : <HistoryDialog />;
    case "statement":
      return <StatementDialog />;
    case "backup":
      return <BackupDialog />;
    case "restore":
      return <RestoreDialog />;
    case "taskToggle":
    case "alertDismiss":
      return <OperationConfirm dialog={dialog} />;
    default:
      return null;
  }
}
