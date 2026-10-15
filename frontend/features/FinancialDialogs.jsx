import React, { useEffect, useRef, useState } from "react";
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
import { toInput, fmtDate, entityById, agreementById } from "../lib/format.js";
import { inputCents } from "../../public/money-client.mjs";
import {
  agreementPayments,
  formatRiyadhDate,
} from "../../public/client-model.mjs";

const entityNames = {
  property: "عقار",
  unit: "وحدة",
  car: "سيارة",
  worker: "عامل",
};
const agreementNames = {
  purchase: "شراء",
  sale: "بيع",
  rent: "إيجار",
  other: "عملية مجدولة",
};
const detailLabels = {
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
  phone: "رقم التواصل",
  work_location: "مكان العمل",
  iqama_number: "رقم الإقامة",
  iqama_expiry: "انتهاء الإقامة",
  passport_number: "رقم الجواز",
  passport_expiry: "انتهاء الجواز",
  notes: "ملاحظات",
  note: "ملاحظات",
  contract_number: "رقم العقد",
  counterparty: "الطرف المرتبط",
  start_date: "بداية العقد",
  end_date: "نهاية العقد",
  first_due_date: "أول استحقاق",
  total_cents: "إجمالي القيمة",
  opening_cents: "المدفوع قبل التأسيس",
  installment_count: "عدد الأقساط",
  frequency_months: "الدورية بالأشهر",
  amount_cents: "المبلغ",
  paid_at: "تاريخ التنفيذ الفعلي",
  slot_index: "رقم القسط",
  reschedule_method: "طريقة الجدولة",
  active: "حالة الحركة",
  archived: "الأرشفة",
  closed_at: "تاريخ الإغلاق",
  closed_by: "أغلقه",
};
const valueNames = {
  ...entityNames,
  ...agreementNames,
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
};

function errorText(error) {
  return typeof error === "string" ? error : error?.message || "";
}
function ErrorNotice({ error }) {
  const ref = useRef(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return error ? (
    <div ref={ref} className="form-error" role="alert" tabIndex={-1}>
      {errorText(error)}
    </div>
  ) : null;
}
function ConflictRefresh({ mutation }) {
  const { close, reload } = useWallet();
  return mutation.errorCode === 409 ? (
    <Button
      variant="secondary"
      onClick={async () => {
        close();
        await reload();
      }}
    >
      تحديث البيانات وإغلاق النموذج
    </Button>
  ) : null;
}
function Notice({ children, warning = false }) {
  return (
    <div className={`notice ${warning ? "notice-warning" : ""}`}>
      {children}
    </div>
  );
}
function TextField({
  label,
  name,
  value = "",
  type = "text",
  hint,
  required = false,
  disabled = false,
  onChange,
}) {
  const integer = ["count", "odometer_km", "maintenance_due_km"].includes(name);
  const maxLength =
    name === "phone"
      ? 50
      : name === "notes"
        ? 1500
        : name === "note"
          ? 1200
          : 255;
  const common = {
    name,
    defaultValue: value ?? "",
    required,
    disabled,
    onChange,
  };
  return (
    <Field label={label} hint={hint}>
      {type === "textarea" ? (
        <textarea {...common} maxLength={maxLength} rows={3} />
      ) : (
        <input
          {...common}
          type={type}
          {...(type === "number"
            ? {
                min: name === "count" ? 1 : 0,
                max: name === "count" ? 600 : undefined,
                step: integer ? "1" : "0.01",
                inputMode: integer ? "numeric" : "decimal",
              }
            : {})}
          {...(type === "date" ? { min: "1000-01-01", max: "9999-12-31" } : {})}
          {...(["text", "tel"].includes(type) ? { maxLength } : {})}
        />
      )}
    </Field>
  );
}
function SelectField({
  label,
  name,
  value = "",
  options,
  disabled = false,
  hint,
}) {
  return (
    <Field label={label} hint={hint}>
      <select name={name} defaultValue={value ?? ""} disabled={disabled}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}
function RecordGrid({ record }) {
  const { data } = useWallet();
  const format = (key, value) => {
    if (key.endsWith("_cents")) return <Money value={value} />;
    if (key === "slot_index") return Number(value) + 1;
    if (key === "closed_at") return formatRiyadhDate(value);
    if (key === "entity_id" || key === "parent_id")
      return entityById(data, value)?.name || "سجل مرتبط / مؤرشف";
    if (key === "agreement_id")
      return agreementById(data, value)?.title || "اتفاق مرتبط";
    if (key === "active") return Number(value) === 1 ? "سارية" : "ملغاة";
    if (key === "archived") return value ? "نعم" : "لا";
    if (key === "status" && record.closed_at) return "مغلق";
    if (["kind", "direction", "status", "reschedule_method"].includes(key))
      return valueNames[value] || String(value);
    if (
      /^(start_date|end_date|first_due_date|paid_at|insurance_expiry|maintenance_date|iqama_expiry|passport_expiry)$/.test(
        key,
      )
    )
      return fmtDate(value);
    return String(value);
  };
  return (
    <dl className="detail-grid">
      {Object.entries(record)
        .filter(
          ([key, value]) =>
            detailLabels[key] &&
            value !== null &&
            value !== undefined &&
            value !== "",
        )
        .map(([key, value]) => (
          <div key={key}>
            <dt>{detailLabels[key]}</dt>
            <dd>{format(key, value)}</dd>
          </div>
        ))}
    </dl>
  );
}
function Missing({
  children = "السجل غير موجود؛ حدّث البيانات وحاول مجددًا.",
}) {
  const { close, reload } = useWallet();
  return (
    <Modal title="تعذر فتح السجل" onClose={close}>
      <Empty>{children}</Empty>
      <div className="form-actions">
        <Button
          onClick={async () => {
            close();
            await reload();
          }}
        >
          تحديث البيانات
        </Button>
      </div>
    </Modal>
  );
}
function ReadOnly({
  children = "تسجيل العمليات المالية وتعديلها متاح للمساعد فقط.",
}) {
  const { close } = useWallet();
  return (
    <Modal title="عرض فقط" onClose={close}>
      <Notice>{children}</Notice>
      <div className="form-actions">
        <Button variant="secondary" onClick={close}>
          إغلاق
        </Button>
      </div>
    </Modal>
  );
}

function FormFrame({
  title,
  children,
  onSubmit,
  mutation,
  submitLabel = "حفظ",
  wide = false,
  localError = "",
}) {
  const { close } = useWallet();
  const [dirty, setDirty] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const submitted = useRef(null);
  const submit = (event) => {
    event.preventDefault();
    // A failed response may still mean the write committed. Keep both the
    // visible fields and exact retry values fixed until its outcome is known.
    const payload = mutation.uncertain
      ? submitted.current
      : Object.fromEntries(new FormData(event.currentTarget));
    submitted.current = structuredClone(payload);
    onSubmit(structuredClone(payload));
  };
  return (
    <Modal
      title={title}
      onClose={close}
      dirty={dirty || mutation.uncertain}
      busy={mutation.pending}
      wide={wide}
      uncertain={mutation.uncertain}
    >
      <form
        onSubmit={submit}
        onChange={() => setDirty(true)}
        aria-busy={mutation.pending}
      >
        <fieldset
          disabled={mutation.pending || mutation.uncertain}
          className="form-fields"
        >
          {children}
        </fieldset>
        {mutation.uncertain && (
          <Notice warning>
            لم يصل تأكيد الحفظ. أعد إرسال البيانات نفسها لتأكيد النتيجة دون
            تكرار العملية.
          </Notice>
        )}
        <ErrorNotice error={localError || mutation.error} />
        <ConflictRefresh mutation={mutation} />
        {confirmCancel && (
          <Notice warning>
            {mutation.uncertain
              ? "لم تتأكد نتيجة الحفظ السابق. يمكنك البقاء وإعادة المحاولة لتأكيد النتيجة."
              : "لم تُحفظ التغييرات بعد. هل تريد ترك النموذج؟"}
            <div className="form-actions">
              <Button
                variant="secondary"
                onClick={() => setConfirmCancel(false)}
              >
                متابعة الإدخال
              </Button>
              <Button variant="danger" onClick={close}>
                ترك النموذج
              </Button>
            </div>
          </Notice>
        )}
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() =>
              dirty || mutation.uncertain ? setConfirmCancel(true) : close()
            }
            disabled={mutation.pending}
          >
            إلغاء
          </Button>
          <Button type="submit" variant="primary" disabled={mutation.pending}>
            {mutation.pending
              ? "جارٍ الحفظ…"
              : mutation.uncertain
                ? "إعادة المحاولة بالبيانات نفسها"
                : submitLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function useSavedResult(
  returnAgreement,
  message = "تم الحفظ وتحديث المحفظة وسجل العمليات",
) {
  const { close, open, notify } = useWallet();
  return (result) => {
    close();
    if (result?.refreshed === false) {
      notify("تم الحفظ. تعذر تحديث العرض؛ اضغط تحديث البيانات.", true);
      return;
    }
    if (returnAgreement) open("agreementDetails", { id: returnAgreement });
    notify(message);
  };
}

function QuickAdd() {
  const { open, close, isAssistant } = useWallet();
  if (!isAssistant) return <ReadOnly />;
  const choices = [
    ["property", "عقار", "مبنى أو أرض ضمن المحفظة"],
    ["unit", "وحدة", "وحدة مستقلة أو تابعة لعقار"],
    ["car", "سيارة", "البيانات والمواعيد والمتابعة"],
    ["worker", "عامل", "التواصل والوثائق والمواعيد"],
    ["other", "أخرى", "أقساط أو مصروف تم تنفيذه"],
    ["task", "مهمة شخصية", "تذكير بمتابعة تحتاج إنجازها"],
  ];
  return (
    <Modal title="ماذا تريد أن تضيف؟" onClose={close}>
      <div className="choice-grid">
        {choices.map(([kind, label, hint]) => (
          <button
            key={kind}
            type="button"
            className="choice-card"
            onClick={() =>
              kind === "task"
                ? open("taskAdd")
                : kind === "other"
                  ? open("otherAdd")
                  : open("entityForm", { kind })
            }
          >
            <strong>{label}</strong>
            <span className="muted">{hint}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
function OtherChoice() {
  const { open, close, isAssistant } = useWallet();
  if (!isAssistant) return <ReadOnly />;
  return (
    <Modal title="إضافة في أخرى" onClose={close}>
      <div className="choice-grid">
        <button
          type="button"
          className="choice-card"
          onClick={() => open("agreementForm", { kind: "other" })}
        >
          <strong>عملية مجدولة</strong>
          <span className="muted">التزام على دفعة واحدة أو عدة أقساط</span>
        </button>
        <button
          type="button"
          className="choice-card"
          onClick={() => open("expenseForm")}
        >
          <strong>مصروف مباشر</strong>
          <span className="muted">
            مبلغ تم صرفه بالفعل، مثل السفر أو الصيانة
          </span>
        </button>
      </div>
    </Modal>
  );
}

function EntityForm({ id, kind: requestedKind, parent_id }) {
  const { data, isAssistant } = useWallet();
  const [entity] = useState(() => (id ? entityById(data, id) : null));
  const kind = entity?.kind || requestedKind;
  const mutation = useFormMutation();
  const saved = useSavedResult();
  if (!isAssistant) return <ReadOnly />;
  if ((id && !entity) || !entityNames[kind]) return <Missing />;
  if (entity?.archived)
    return <ReadOnly>هذا الأصل مؤرشف، وتبقى بياناته محفوظة للمراجعة.</ReadOnly>;
  const submit = (body) => {
    if (id) body.expected_version = entity.version;
    else body.kind = kind;
    return mutation.submit(
      id ? `/api/entities/${id}` : "/api/entities",
      body,
      saved,
      id ? "PATCH" : "POST",
    );
  };
  const reference =
    entity?.reference_value_cents != null
      ? toInput(entity.reference_value_cents)
      : "";
  return (
    <FormFrame
      title={`${id ? "تعديل" : "إضافة"} ${entityNames[kind]}`}
      onSubmit={submit}
      mutation={mutation}
      wide
    >
      <TextField
        label={`اسم ${entityNames[kind]}`}
        name="name"
        value={entity?.name}
        required
        hint={
          kind === "property"
            ? "مثل عمارة الياسمين"
            : kind === "unit"
              ? "مثل شقة 1 أو محل 3"
              : kind === "car"
                ? "مثل كامري 2025"
                : undefined
        }
      />
      {kind === "property" && (
        <>
          <div className="form-grid">
            <TextField
              label="الموقع"
              name="location"
              value={entity?.location}
            />
            <TextField
              label="رقم عداد الكهرباء"
              name="electricity_meter"
              value={entity?.electricity_meter}
            />
          </div>
          <TextField
            label="قيمة العقار المرجعية بالريال"
            name="reference_value_cents"
            value={reference}
            type="number"
            hint="لا تدخل تلقائيًا في التحصيل أو السداد"
          />
        </>
      )}
      {kind === "unit" && (
        <>
          <div className="form-grid">
            {!entity && (
              <SelectField
                label="تتبع لعقار (اختياري)"
                name="parent_id"
                value={parent_id}
                options={[
                  ["", "وحدة مستقلة"],
                  ...data.entities
                    .filter((e) => e.kind === "property")
                    .map((e) => [e.id, e.name]),
                ]}
              />
            )}
            <SelectField
              label="حالة الوحدة"
              name="status"
              value={entity?.status || "available"}
              options={[
                ["available", "متاحة"],
                ["rented", "مؤجرة"],
                ["maintenance", "صيانة"],
                ["unavailable", "غير متاحة"],
              ]}
            />
          </div>
          <div className="form-grid">
            <TextField
              label="رقم عداد الكهرباء (اختياري)"
              name="electricity_meter"
              value={entity?.electricity_meter}
            />
            <TextField
              label="القيمة المرجعية (اختياري)"
              name="reference_value_cents"
              value={reference}
              type="number"
              hint="معلومة مرجعية لا تدخل في الحسابات"
            />
          </div>
        </>
      )}
      {kind === "car" && (
        <>
          <div className="form-grid">
            <TextField label="رقم اللوحة" name="plate" value={entity?.plate} />
            <TextField
              label="القيمة المرجعية بالريال"
              name="reference_value_cents"
              value={reference}
              type="number"
            />
          </div>
          <div className="form-grid">
            <TextField
              label="انتهاء التأمين"
              name="insurance_expiry"
              value={entity?.insurance_expiry}
              type="date"
            />
            <TextField
              label="موعد الصيانة القادمة"
              name="maintenance_date"
              value={entity?.maintenance_date}
              type="date"
            />
            <TextField
              label="الكيلومترات الحالية"
              name="odometer_km"
              value={entity?.odometer_km}
              type="number"
            />
            <TextField
              label="الصيانة عند كم كيلومتر"
              name="maintenance_due_km"
              value={entity?.maintenance_due_km}
              type="number"
            />
          </div>
        </>
      )}
      {kind === "worker" && (
        <div className="form-grid">
          <TextField
            label="رقم التواصل"
            name="phone"
            value={entity?.phone}
            type="tel"
          />
          <TextField
            label="مكان العمل"
            name="work_location"
            value={entity?.work_location}
          />
          <TextField
            label="رقم الإقامة"
            name="iqama_number"
            value={entity?.iqama_number}
          />
          <TextField
            label="انتهاء الإقامة"
            name="iqama_expiry"
            value={entity?.iqama_expiry}
            type="date"
          />
          <TextField
            label="رقم الجواز"
            name="passport_number"
            value={entity?.passport_number}
          />
          <TextField
            label="انتهاء الجواز"
            name="passport_expiry"
            value={entity?.passport_expiry}
            type="date"
          />
        </div>
      )}
      <TextField
        label="ملاحظات (اختياري)"
        name="notes"
        value={entity?.notes}
        type="textarea"
      />
    </FormFrame>
  );
}

function EntityDetails({ id }) {
  const { data, close, open, isAssistant } = useWallet();
  const entity = entityById(data, id);
  if (!entity) return <Missing />;
  const agreements = data.agreements.filter(
    (a) => a.entity_id === id && a.status === "active",
  );
  const units =
    entity.kind === "property"
      ? data.entities.filter((e) => e.parent_id === id)
      : [];
  return (
    <Modal title={entity.name} onClose={close} wide>
      {entity.archived && (
        <Notice>أصل مؤرشف؛ بياناته المرجعية واتفاقاته محفوظة للمراجعة.</Notice>
      )}
      <RecordGrid record={entity} />
      {!!units.length && (
        <section className="stack">
          <h3>الوحدات التابعة</h3>
          {units.map((unit) => (
            <div className="record-row" key={unit.id}>
              <div>
                <strong>{unit.name}</strong>
                <p className="muted">
                  {valueNames[unit.status] || unit.status}
                </p>
              </div>
              <Button
                variant="secondary"
                onClick={() => open("entityDetails", { id: unit.id })}
              >
                عرض الوحدة
              </Button>
            </div>
          ))}
        </section>
      )}
      {entity.kind !== "worker" && (
        <section className="stack">
          <h3>العقود والعمليات</h3>
          {agreements.length ? (
            agreements.map((a) => (
              <div className="record-row" key={a.id}>
                <div>
                  <strong>{a.title}</strong>
                  <p className="muted">
                    {agreementNames[a.kind]} · <Money value={a.total_cents} />
                  </p>
                  {a.closed_at && <Badge tone="success">مغلق</Badge>}
                </div>
                <Button
                  variant="secondary"
                  onClick={() => open("agreementDetails", { id: a.id })}
                >
                  التفاصيل
                </Button>
              </div>
            ))
          ) : (
            <Empty>لا توجد عقود أو عمليات مرتبطة بهذا الأصل.</Empty>
          )}
        </section>
      )}
      {isAssistant && !entity.archived && (
        <div className="form-actions">
          {entity.kind !== "worker" && (
            <Button onClick={() => open("agreementType", { entity_id: id })}>
              إضافة {entity.kind === "unit" ? "عقد أو عملية" : "شراء أو بيع"}
            </Button>
          )}
          {entity.kind === "property" && (
            <Button
              variant="secondary"
              onClick={() =>
                open("entityForm", { kind: "unit", parent_id: id })
              }
            >
              إضافة وحدة
            </Button>
          )}
          <Button
            variant="secondary"
            onClick={() => open("entityForm", { kind: entity.kind, id })}
          >
            تعديل البيانات
          </Button>
          <Button
            variant="danger"
            onClick={() => open("entityArchive", { id })}
          >
            أرشفة
          </Button>
        </div>
      )}
    </Modal>
  );
}

function AgreementType({ entity_id }) {
  const { data, open, close, isAssistant } = useWallet();
  const entity = entityById(data, entity_id);
  if (!isAssistant) return <ReadOnly />;
  if (!entity || entity.archived || entity.kind === "worker")
    return <Missing />;
  const options =
    entity.kind === "unit"
      ? ["rent", "purchase", "sale"]
      : ["purchase", "sale"];
  return (
    <Modal title="إضافة عقد أو عملية" onClose={close}>
      <p className="muted">حدد نوع العملية المرتبطة بـ {entity.name}</p>
      <div className="choice-grid">
        {options.map((kind) => (
          <button
            type="button"
            key={kind}
            className="choice-card"
            onClick={() => open("agreementForm", { kind, entity_id })}
          >
            <strong>{agreementNames[kind]}</strong>
            <span className="muted">
              {kind === "purchase"
                ? "جدول سداد"
                : kind === "sale"
                  ? "جدول تحصيل"
                  : "عقد إيجار وجدول تحصيل"}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
function AgreementForm({ id, kind: requestedKind, entity_id }) {
  const { data, isAssistant } = useWallet();
  const [agreement] = useState(() => (id ? agreementById(data, id) : null));
  const [hasPayments] = useState(() =>
    Boolean(id && agreementPayments(data, id).length),
  );
  const mutation = useFormMutation();
  const saved = useSavedResult(id);
  const kind = agreement?.kind || requestedKind;
  const entity = entityById(data, agreement?.entity_id || entity_id);
  if (!isAssistant) return <ReadOnly />;
  if (
    (id && !agreement) ||
    !agreementNames[kind] ||
    (kind !== "other" && !entity)
  )
    return <Missing />;
  if (agreement?.closed_at)
    return <ReadOnly>أعد فتح الاتفاق من التفاصيل قبل تعديله.</ReadOnly>;
  if (entity?.archived)
    return (
      <ReadOnly>الأصل المرتبط مؤرشف. لا يمكن تسجيل اتفاق جديد عليه.</ReadOnly>
    );
  const submit = (body) => {
    if (id) body.expected_version = agreement.version;
    else {
      body.kind = kind;
      body.entity_id = entity?.id || null;
    }
    return mutation.submit(
      id ? `/api/agreements/${id}` : "/api/agreements",
      body,
      saved,
      id ? "PATCH" : "POST",
    );
  };
  return (
    <FormFrame
      title={`${id ? "تعديل" : "إضافة"} ${agreementNames[kind]}`}
      onSubmit={submit}
      mutation={mutation}
      wide
    >
      <Notice>
        {kind === "rent"
          ? "يمكن إنشاء عقد لشهر واحد ودفعة واحدة. رقم العقد نص فقط دون إرفاق مستند."
          : kind === "other"
            ? "عملية مالية مجدولة ضمن «أخرى»، وتُسجل في السداد."
            : "شراء يُولد سدادًا، وبيع يُولد تحصيلًا. قيمة الأصل نفسها لا تُحسب كحركة نقدية."}
      </Notice>
      {entity && (
        <p className="muted">
          الأصل المرتبط: <strong>{entity.name}</strong>
        </p>
      )}
      <TextField
        label="اسم العملية أو العقد"
        name="title"
        value={
          agreement?.title ||
          [kind === "other" ? "قسط" : agreementNames[kind], entity?.name || ""]
            .join(" ")
            .trim()
        }
        required
      />
      {kind === "rent" ? (
        <>
          <div className="form-grid">
            <TextField
              label="رقم عقد الإيجار"
              name="contract_number"
              value={agreement?.contract_number}
              hint="رقم فقط دون رفع العقد"
            />
            <TextField
              label="اسم المستأجر"
              name="counterparty"
              value={agreement?.counterparty}
            />
            <TextField
              label="رقم التواصل"
              name="phone"
              value={agreement?.phone}
              type="tel"
            />
          </div>
          <div className="form-grid">
            <TextField
              label="بداية العقد"
              name="start_date"
              value={agreement?.start_date}
              type="date"
              required
              disabled={hasPayments}
            />
            <TextField
              label="نهاية العقد"
              name="end_date"
              value={agreement?.end_date}
              type="date"
              required
              disabled={hasPayments}
            />
          </div>
        </>
      ) : (
        <TextField
          label="الطرف المرتبط (اختياري)"
          name="counterparty"
          value={agreement?.counterparty}
        />
      )}
      {hasPayments && (
        <Notice warning>
          بدأ تنفيذ هذا الجدول؛ يمكنك تعديل البيانات الوصفية فقط. تُحفظ بيانات
          الجدولة الأصلية لحماية تاريخ الحركات.
        </Notice>
      )}
      <div className="form-grid">
        <TextField
          label="إجمالي القيمة (ر.س)"
          name="total"
          value={agreement ? toInput(agreement.total_cents) : ""}
          type="number"
          required
          disabled={hasPayments}
        />
        <TextField
          label={
            kind === "sale" || kind === "rent"
              ? "المحصّل قبل تأسيس المحفظة"
              : "المدفوع قبل تأسيس المحفظة"
          }
          name="opening"
          value={agreement ? toInput(agreement.opening_cents) : "0"}
          type="number"
          hint="لا يُحسب ضمن حركات الشهر"
          disabled={hasPayments}
        />
      </div>
      <div className="form-grid">
        <TextField
          label="عدد الأقساط"
          name="count"
          value={agreement?.installment_count || 1}
          type="number"
          hint="1 لدفعة واحدة"
          required
          disabled={hasPayments}
        />
        <SelectField
          label="دورية الأقساط"
          name="frequency"
          value={agreement?.frequency_months || 1}
          options={[
            [1, "شهريًا"],
            [3, "كل 3 أشهر"],
            [6, "كل 6 أشهر"],
            [12, "سنويًا"],
          ]}
          disabled={hasPayments}
        />
        <TextField
          label="موعد أول قسط"
          name="first_due_date"
          value={agreement?.first_due_date || data.today}
          type="date"
          required
          disabled={hasPayments}
        />
      </div>
      <TextField
        label="ملاحظات (اختياري)"
        name="note"
        value={agreement?.note}
        type="textarea"
      />
    </FormFrame>
  );
}

function AgreementDetails({ id }) {
  const { data, close, open, isAssistant } = useWallet();
  const agreement = agreementById(data, id);
  if (!agreement) return <Missing />;
  const payments = agreementPayments(data, id),
    dues = data.dues.filter((d) => d.agreement_id === id);
  const remaining = dues.reduce((sum, d) => sum + d.amount_cents, 0);
  const canClose =
    !agreement.closed_at &&
    remaining === 0 &&
    (agreement.kind !== "rent" || agreement.end_date < data.today);
  const archived = Boolean(
    agreement.entity_id && entityById(data, agreement.entity_id)?.archived,
  );
  return (
    <Modal title={agreement.title} onClose={close} wide>
      {agreement.closed_at && (
        <Notice>
          اتفاق مغلق منذ {formatRiyadhDate(agreement.closed_at)}
          {agreement.closed_by ? ` بواسطة ${agreement.closed_by}` : ""}.{" "}
          {archived
            ? "الأصل مؤرشف، وتبقى البيانات محفوظة للمراجعة."
            : "يلزم إعادة فتحه قبل تصحيح أي حركة."}
        </Notice>
      )}
      <div className="financial-summary">
        <div>
          <span className="muted">المتبقي وفق الجدول الحالي</span>
          <strong>
            <Money value={remaining} />
          </strong>
        </div>
        <div>
          <span className="muted">منفذ بعد التأسيس</span>
          <strong>
            <Money
              value={payments.reduce((sum, p) => sum + p.amount_cents, 0)}
            />
          </strong>
        </div>
      </div>
      <RecordGrid record={agreement} />
      <section className="stack">
        <h3>
          الحركات المنفذة عبر كل الأشهر{" "}
          <span className="muted">({payments.length})</span>
        </h3>
        {payments.length ? (
          payments.map((payment) => (
            <div className="record-row" key={payment.id}>
              <div>
                <strong>
                  {fmtDate(payment.paid_at)} · القسط{" "}
                  {Number(payment.slot_index) + 1}
                </strong>
                <p className="muted">
                  {payment.note || "دون ملاحظات"}
                  {payment.created_by ? ` · ${payment.created_by}` : ""}
                </p>
              </div>
              <Money value={payment.amount_cents} />
              {isAssistant && !agreement.closed_at && (
                <div className="record-actions">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      open("payEdit", { id: payment.id, returnAgreement: id })
                    }
                  >
                    تعديل
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      open("payVoid", { id: payment.id, returnAgreement: id })
                    }
                  >
                    حذف
                  </Button>
                </div>
              )}
            </div>
          ))
        ) : (
          <Empty>لم تسجل حركات بعد تأسيس المحفظة على هذا الاتفاق.</Empty>
        )}
        <p className="muted">
          الحركات السارية فقط؛ يبقى أثر التصحيح والحذف في سجل العمليات.
        </p>
      </section>
      <section className="stack">
        <h3>الاستحقاقات المتبقية</h3>
        {dues.length ? (
          dues.map((due) => (
            <div className="record-row" key={`${due.agreement_id}-${due.slot}`}>
              <div>
                <strong>القسط {Number(due.slot) + 1}</strong>
                <p className="muted">{fmtDate(due.due_date)}</p>
                <Badge
                  tone={
                    due.status === "متأخر"
                      ? "danger"
                      : due.status === "اليوم"
                        ? "warning"
                        : "neutral"
                  }
                >
                  {due.status}
                </Badge>
              </div>
              <Money value={due.amount_cents} />
              {isAssistant && !agreement.closed_at && (
                <Button
                  onClick={() =>
                    open("payConfirm", {
                      id: `${id}::${due.slot}`,
                      returnAgreement: id,
                    })
                  }
                >
                  {agreement.direction === "in" ? "تسجيل تحصيل" : "تسجيل سداد"}
                </Button>
              )}
            </div>
          ))
        ) : (
          <Empty>لا توجد مبالغ متبقية على هذا الجدول.</Empty>
        )}
      </section>
      {isAssistant && (
        <>
          <div className="form-actions">
            {!agreement.closed_at && (
              <Button
                variant="secondary"
                onClick={() => open("agreementForm", { id })}
              >
                تعديل الاتفاق
              </Button>
            )}
            {agreement.closed_at
              ? !archived && (
                  <Button onClick={() => open("agreementReopen", { id })}>
                    إعادة فتح الاتفاق
                  </Button>
                )
              : canClose && (
                  <Button onClick={() => open("agreementClose", { id })}>
                    إغلاق الاتفاق المسدد
                  </Button>
                )}
            {!agreement.closed_at && !payments.length && (
              <Button
                variant="danger"
                onClick={() => open("agreementCancel", { id })}
              >
                إلغاء الجدول
              </Button>
            )}
          </div>
          {agreement.closed_at && archived && (
            <p className="muted">لا يمكن إعادة فتح اتفاق مرتبط بأصل مؤرشف.</p>
          )}
          {!agreement.closed_at &&
            remaining === 0 &&
            agreement.kind === "rent" &&
            !canClose && (
              <p className="muted">
                يمكن إغلاق عقد الإيجار بعد انتهاء مدته وتسوية كامل رصيده.
              </p>
            )}
          {canClose && (
            <p className="muted">
              الإغلاق يحفظ الحركات ويتيح أرشفة الأصل عندما لا تبقى روابط نشطة
              أخرى.
            </p>
          )}
        </>
      )}
    </Modal>
  );
}

function PaymentForm({ id, editing = false, returnAgreement }) {
  const { data, isAssistant } = useWallet();
  const [initial] = useState(() => {
    const payment = editing ? data.payments.find((p) => p.id === id) : null;
    const [agreementId, slot] = String(id || "").split("::");
    const due = payment
      ? {
          agreement_id: payment.agreement_id,
          slot: payment.slot_index,
          amount_cents:
            data.payment_contexts?.[payment.id]?.expected_cents ??
            payment.amount_cents,
          due_date: data.payment_contexts?.[payment.id]?.due_date,
        }
      : data.dues.find(
          (d) => d.agreement_id === agreementId && d.slot === Number(slot),
        );
    return {
      payment,
      due,
      agreement: due ? agreementById(data, due.agreement_id) : null,
    };
  });
  const { payment, due, agreement } = initial;
  const [amount, setAmount] = useState(() =>
    toInput(payment?.amount_cents ?? due?.amount_cents ?? 0),
  );
  const [localError, setLocalError] = useState("");
  const mutation = useFormMutation();
  const saved = useSavedResult(
    returnAgreement || agreement?.id,
    "تم حفظ الحركة وتحديث جدول الاستحقاقات",
  );
  if (!isAssistant) return <ReadOnly />;
  if (!due || !agreement || (editing && !payment))
    return (
      <Missing>
        الحركة أو الاستحقاق غير موجود؛ ربما تم تنفيذه. حدّث البيانات.
      </Missing>
    );
  if (agreement.closed_at)
    return (
      <ReadOnly>
        أعد فتح الاتفاق من التفاصيل قبل تسجيل حركة أو تصحيحها.
      </ReadOnly>
    );
  let isOverpayment = false;
  try {
    isOverpayment = inputCents(amount) > due.amount_cents;
  } catch {}
  const submit = (body) => {
    setLocalError("");
    try {
      if (inputCents(body.amount) > due.amount_cents && !body.reschedule_method)
        throw new Error("اختر طريقة إعادة جدولة المبلغ الزائد");
    } catch (error) {
      setLocalError(error.message);
      return;
    }
    body.slot = Number(due.slot);
    body.expected_version = agreement.version;
    body.reschedule_method = body.reschedule_method || null;
    return mutation.submit(
      editing
        ? `/api/payments/${id}`
        : `/api/agreements/${agreement.id}/payments`,
      body,
      saved,
      editing ? "PATCH" : "POST",
    );
  };
  return (
    <FormFrame
      title={
        editing
          ? "تعديل حركة مالية"
          : `تأكيد ${agreement.direction === "in" ? "التحصيل" : "السداد"}`
      }
      onSubmit={submit}
      mutation={mutation}
      submitLabel={editing ? "حفظ التعديل" : "تأكيد التنفيذ"}
      localError={localError}
    >
      <Notice>
        <strong>{agreement.title}</strong>
        <p>
          موعد الاستحقاق: {due.due_date ? fmtDate(due.due_date) : "—"} · المبلغ
          المتوقع: <Money value={due.amount_cents} />
        </p>
      </Notice>
      <div className="form-grid">
        <TextField
          label="المبلغ الفعلي (ر.س)"
          name="amount"
          value={amount}
          type="number"
          required
          onChange={(event) => setAmount(event.target.value)}
        />
        <TextField
          label="تاريخ التنفيذ الفعلي"
          name="paid_at"
          value={payment?.paid_at || data.today}
          type="date"
          required
        />
      </div>
      <div hidden={!isOverpayment}>
        <Notice warning>
          المبلغ أعلى من القسط المختار. اختر كيف يُعدل النظام جدول الأقساط
          القادمة.
        </Notice>
        <fieldset className="form-choice">
          <legend>طريقة إعادة الجدولة</legend>
          <label>
            <input
              type="radio"
              name="reschedule_method"
              value="shorten"
              defaultChecked={payment?.reschedule_method === "shorten"}
            />{" "}
            تقليل المدة
          </label>
          <label>
            <input
              type="radio"
              name="reschedule_method"
              value="spread"
              defaultChecked={payment?.reschedule_method === "spread"}
            />{" "}
            تقليل قيمة الأقساط
          </label>
        </fieldset>
      </div>
      <TextField
        label="ملاحظات"
        name="note"
        value={payment?.note}
        type="textarea"
      />
    </FormFrame>
  );
}

function ExpenseForm({ entity_id, id }) {
  const { data, isAssistant } = useWallet();
  const mutation = useFormMutation();
  const saved = useSavedResult();
  if (!isAssistant) return <ReadOnly />;
  if (id)
    return (
      <ReadOnly>
        المصروف المباشر لا يدعم التعديل. يمكنك مراجعة تفاصيله وحذف الحركة ثم
        تسجيل المصروف الصحيح.
      </ReadOnly>
    );
  const submit = (body) => mutation.submit("/api/expenses", body, saved);
  return (
    <FormFrame
      title="تسجيل مصروف مباشر"
      onSubmit={submit}
      mutation={mutation}
      submitLabel="تسجيل المصروف"
    >
      <Notice>
        مبلغ صُرف بالفعل؛ يسجل بتاريخ الصرف الفعلي دون جدول أقساط.
      </Notice>
      <TextField
        label="وصف المصروف"
        name="title"
        required
        hint="مصاريف سفر، صيانة…"
      />
      <div className="form-grid">
        <TextField
          label="المبلغ المصروف فعليًا (ر.س)"
          name="amount"
          type="number"
          required
        />
        <TextField
          label="تاريخ الصرف"
          name="paid_at"
          value={data.today}
          type="date"
          required
        />
      </div>
      <SelectField
        label="ربط المصروف بأصل (اختياري)"
        name="entity_id"
        value={entity_id}
        options={[
          ["", "بدون ربط"],
          ...data.entities
            .filter((e) => e.kind !== "worker")
            .map((e) => [e.id, e.name]),
        ]}
      />
      <TextField label="ملاحظات" name="note" type="textarea" />
    </FormFrame>
  );
}
function ExpenseDetails({ id }) {
  const { data, open, close, isAssistant } = useWallet();
  const expense = data.expenses.find((e) => e.id === id);
  if (!expense) return <Missing />;
  return (
    <Modal title={expense.title} onClose={close}>
      <RecordGrid record={expense} />
      {isAssistant && (
        <div className="form-actions">
          <Button variant="danger" onClick={() => open("expenseVoid", { id })}>
            حذف المصروف
          </Button>
        </div>
      )}
    </Modal>
  );
}

function ConfirmFinancialAction({ type, id, returnAgreement }) {
  const { data, isAssistant, close, open, notify } = useWallet();
  const [initial] = useState(() => {
    const entity = type === "entityArchive" ? entityById(data, id) : null;
    const payment =
      type === "payVoid" ? data.payments.find((p) => p.id === id) : null;
    const expense =
      type === "expenseVoid" ? data.expenses.find((e) => e.id === id) : null;
    const agreement = type.startsWith("agreement")
      ? agreementById(data, id)
      : payment
        ? agreementById(data, payment.agreement_id)
        : null;
    return { entity, payment, expense, agreement };
  });
  const mutation = useFormMutation();
  const [confirmLeave, setConfirmLeave] = useState(false);
  if (!isAssistant) return <ReadOnly />;
  const { entity, payment, expense, agreement } = initial;
  const definitions = {
    entityArchive: {
      record: entity,
      title: "أرشفة السجل",
      message:
        "سيُزال السجل من القوائم الحالية ويبقى تاريخه محفوظًا. يجب معالجة الوحدات والجداول النشطة المرتبطة أولًا.",
      path: `/api/entities/${id}`,
      method: "DELETE",
      done: "تمت أرشفة السجل",
      label: "تأكيد الأرشفة",
    },
    payVoid: {
      record: payment,
      title: "حذف الحركة المالية",
      message:
        "سيعاد حساب جميع الأقساط المرتبطة تلقائيًا. يبقى أثر الحذف في سجل العمليات.",
      path: `/api/payments/${id}`,
      version: agreement?.version,
      method: "DELETE",
      done: "حُذفت الحركة وأعيد حساب الجدول",
      label: "تأكيد حذف الحركة",
      returnTo: returnAgreement || agreement?.id,
    },
    expenseVoid: {
      record: expense,
      title: "حذف المصروف المباشر",
      message: "سيُحذف المصروف من الحسابات مع حفظ أثره في سجل العمليات.",
      path: `/api/expenses/${id}`,
      method: "DELETE",
      done: "حُذف المصروف من الحسابات",
      label: "تأكيد حذف المصروف",
    },
    agreementClose: {
      record: agreement,
      title: "إغلاق الاتفاق المسدد",
      message:
        "تبقى الحركات محفوظة، ويلزم إعادة فتح الاتفاق قبل تصحيح أي حركة.",
      path: `/api/agreements/${id}/close`,
      method: "POST",
      done: "تم إغلاق الاتفاق مع حفظ حركاته",
      label: "تأكيد الإغلاق",
      returnTo: id,
    },
    agreementReopen: {
      record: agreement,
      title: "إعادة فتح الاتفاق",
      message:
        "يمكن تصحيح الحركات بعد إعادة الفتح. يجب أن يكون الأصل متاحًا وألا يتعارض الإيجار مع عقد آخر.",
      path: `/api/agreements/${id}/reopen`,
      method: "POST",
      done: "تمت إعادة فتح الاتفاق",
      label: "إعادة فتح الاتفاق",
      returnTo: id,
    },
    agreementCancel: {
      record: agreement,
      title: "إلغاء الجدول",
      message:
        "ستُزال استحقاقاته المستقبلية ويبقى أثر الإلغاء في السجل. هذا الإجراء متاح للجداول التي لا تحتوي على حركات مالية سارية.",
      path: `/api/agreements/${id}`,
      method: "DELETE",
      done: "تم إلغاء الجدول",
      label: "تأكيد إلغاء الجدول",
    },
  };
  const action = definitions[type];
  if (!action?.record) return <Missing />;
  if (
    agreement?.closed_at &&
    ["payVoid", "agreementCancel", "agreementClose"].includes(type)
  )
    return <ReadOnly>الاتفاق مغلق؛ أعد فتحه قبل التعديل.</ReadOnly>;
  const success = (result) => {
    close();
    if (result?.refreshed === false) {
      notify(`${action.done}؛ تعذر تحديث العرض. اضغط تحديث البيانات.`, true);
      return;
    }
    if (action.returnTo) open("agreementDetails", { id: action.returnTo });
    notify(action.done);
  };
  return (
    <Modal
      title={action.title}
      onClose={close}
      dirty={mutation.uncertain}
      busy={mutation.pending}
      uncertain={mutation.uncertain}
    >
      <div className="confirmation-summary">
        <strong>{entity?.name || agreement?.title || expense?.title}</strong>
        {(payment || expense) && (
          <p>
            <Money value={(payment || expense).amount_cents} /> ·{" "}
            {fmtDate((payment || expense).paid_at)}
          </p>
        )}
      </div>
      <Notice warning={action.method === "DELETE"}>{action.message}</Notice>
      {mutation.uncertain && (
        <Notice warning>
          لم يصل تأكيد الخادم. أعد المحاولة لتأكيد النتيجة دون تكرار العملية.
        </Notice>
      )}
      <ErrorNotice error={mutation.error} />
      <ConflictRefresh mutation={mutation} />
      {confirmLeave && (
        <Notice warning>
          لم تتأكد نتيجة الطلب بعد. يمكنك البقاء وإعادة المحاولة لتأكيدها.
          <div className="form-actions">
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>
              البقاء هنا
            </Button>
            <Button variant="danger" onClick={close}>
              إغلاق ومراجعة البيانات لاحقًا
            </Button>
          </div>
        </Notice>
      )}
      <div className="form-actions">
        <Button
          variant="secondary"
          disabled={mutation.pending}
          onClick={() => {
            if (mutation.uncertain) {
              setConfirmLeave(true);
              return;
            }
            if (action.returnTo)
              open("agreementDetails", { id: action.returnTo });
            else close();
          }}
        >
          رجوع
        </Button>
        <Button
          variant={action.method === "DELETE" ? "danger" : "primary"}
          disabled={mutation.pending}
          onClick={() =>
            mutation.submit(
              action.path,
              { expected_version: action.version ?? action.record.version },
              success,
              action.method,
            )
          }
        >
          {mutation.pending
            ? "جارٍ التنفيذ…"
            : mutation.uncertain
              ? "إعادة المحاولة"
              : action.label}
        </Button>
      </div>
    </Modal>
  );
}

const financialTypes = new Set([
  "quickadd",
  "otherAdd",
  "entityForm",
  "entityDetails",
  "agreementType",
  "agreementForm",
  "agreementDetails",
  "payConfirm",
  "payEdit",
  "payVoid",
  "expenseForm",
  "expenseDetails",
  "expenseVoid",
  "entityArchive",
  "agreementClose",
  "agreementReopen",
  "agreementCancel",
]);
export default function FinancialDialogs({ dialog }) {
  if (!dialog || !financialTypes.has(dialog.type)) return null;
  const key = [
    dialog.type,
    dialog.id || "",
    dialog.entity_id || "",
    dialog.kind || "",
    dialog.parent_id || "",
  ].join(":");
  switch (dialog.type) {
    case "quickadd":
      return <QuickAdd key={key} />;
    case "otherAdd":
      return <OtherChoice key={key} />;
    case "entityForm":
      return <EntityForm key={key} {...dialog} />;
    case "entityDetails":
      return <EntityDetails key={key} {...dialog} />;
    case "agreementType":
      return <AgreementType key={key} {...dialog} />;
    case "agreementForm":
      return !dialog.kind && !dialog.id ? (
        <AgreementType key={key} {...dialog} />
      ) : (
        <AgreementForm key={key} {...dialog} />
      );
    case "agreementDetails":
      return <AgreementDetails key={key} {...dialog} />;
    case "payConfirm":
      return <PaymentForm key={key} {...dialog} />;
    case "payEdit":
      return <PaymentForm key={key} {...dialog} editing />;
    case "expenseForm":
      return <ExpenseForm key={key} {...dialog} />;
    case "expenseDetails":
      return <ExpenseDetails key={key} {...dialog} />;
    default:
      return <ConfirmFinancialAction key={key} {...dialog} />;
  }
}
