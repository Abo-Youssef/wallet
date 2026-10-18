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
import { inputCents, normalizeDigits, normalizeDecimal } from "../../shared/numerals.mjs";
import { readFormValues } from "../lib/form-values.js";
import { project } from "../../shared/finance.mjs";
import { effectiveUnitStatus, unitStatusNames, restHouseAvailability } from "../../shared/unit-status.mjs";
import { propertyTypes, propertyTypeNames } from "../../shared/property-types.mjs";
import {
  agreementPayments,
  formatRiyadhDate,
} from "../../shared/client-model.mjs";

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
  rental_mode: "نوع الإيجار",
  booking_cancelled_at: "تاريخ إلغاء الحجز",
  booking_cancelled_by: "ألغاه",
  booking_cancel_note: "سبب إلغاء الحجز",
  name: "الاسم",
  title: "العنوان",
  kind: "النوع",
  property_type: "نوع العقار",
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
  schedule_end_date: "نهاية جدول الدفعات",
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
  daily: "حجز يومي",
  period: "إيجار دوري",
  ...propertyTypeNames,
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
  personal_use: "استخدام شخصي",
  shorten: "تقليل المدة",
  spread: "تقليل قيمة الأقساط",
};

function errorText(error) {
  return normalizeDigits(typeof error === "string" ? error : error?.message || "");
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
  onChange,
  required = false,
}) {
  return (
    <Field label={label} hint={hint}>
      <select name={name} defaultValue={value ?? ""} disabled={disabled} onChange={onChange} required={required}>
        {options.map(([key, text]) => (
          <option key={key} value={key}>
            {normalizeDigits(text)}
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
    if (key === "closed_at" || key === "booking_cancelled_at") return formatRiyadhDate(value);
    if (key === "entity_id" || key === "parent_id")
      return normalizeDigits(entityById(data, value)?.name || "سجل مرتبط / مؤرشف");
    if (key === "agreement_id")
      return normalizeDigits(agreementById(data, value)?.title || "اتفاق مرتبط");
    if (key === "active") return Number(value) === 1 ? "سارية" : "ملغاة";
    if (key === "archived") return value ? "نعم" : "لا";
    if (key === "status" && record.closed_at) return "مغلق";
    if (key === "status" && record.booking_cancelled_at) return "حجز ملغى · الحساب محفوظ";
    if (["kind", "property_type", "direction", "status", "reschedule_method", "rental_mode"].includes(key))
      return valueNames[value] || normalizeDigits(value);
    if (
      /^(start_date|end_date|first_due_date|paid_at|insurance_expiry|maintenance_date|iqama_expiry|passport_expiry)$/.test(
        key,
      )
    )
      return fmtDate(value);
    return normalizeDigits(value);
  };
  return (
    <dl className="detail-grid">
      {Object.entries(record)
        .filter(
          ([key, value]) =>
            detailLabels[key] &&
            !(record.rental_mode==="daily" && ["end_date","first_due_date","frequency_months","installment_count","opening_cents"].includes(key)) &&
            value !== null &&
            value !== undefined &&
            value !== "",
        )
        .map(([key, value]) => (
          <div key={key}>
            <dt>{record.rental_mode==="daily" && key==="start_date" ? "يوم الحجز" : detailLabels[key]}</dt>
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
  children = "وضع المدير للاطلاع فقط. فعّل وضع المساعد من المزيد لتسجيل التغييرات.",
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
  reviewing = false,
  reviewContent = null,
  onBack,
  submitDisabled = false,
}) {
  const { close } = useWallet();
  const [dirty, setDirty] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const submitted = useRef(null);
  const submit = (event) => {
    event.preventDefault();
    // A failed response may still mean the write committed. Keep both the
    // visible fields and exact retry values fixed until its outcome is known.
    const payload = mutation.uncertain || reviewing
      ? submitted.current
      : readFormValues(event.currentTarget);
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
          disabled={mutation.pending || mutation.uncertain || reviewing}
          hidden={reviewing && !mutation.uncertain}
          className="form-fields"
        >
          {children}
        </fieldset>
        {reviewing && reviewContent}
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
          {reviewing && !mutation.uncertain && <Button variant="secondary" disabled={mutation.pending} onClick={onBack}>تعديل البيانات</Button>}
          <Button
            variant="secondary"
            onClick={() =>
              dirty || mutation.uncertain ? setConfirmCancel(true) : close()
            }
            disabled={mutation.pending}
          >
            إلغاء
          </Button>
          <Button type="submit" variant="primary" disabled={mutation.pending || (submitDisabled && !mutation.uncertain)}>
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
  const { open, close, canManageData, isAssistant } = useWallet();
  if (!canManageData) return <ReadOnly />;
  const choices = [
    ["property", "عقار", "مبنى أو أرض ضمن المحفظة"],
    ["unit", "وحدة", "وحدة مستقلة أو تابعة لعقار"],
    ["car", "سيارة", "البيانات والمواعيد والمتابعة"],
    ["worker", "عامل", "التواصل والوثائق والمواعيد"],
    ["other", "أخرى", "أقساط أو مصروف تم تنفيذه"],
    ["task", isAssistant ? "مهمة شخصية" : "مهمة للمساعد", "تذكير بمتابعة تحتاج إنجازها"],
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
  const { open, close, canManageData } = useWallet();
  if (!canManageData) return <ReadOnly />;
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

function RentalStart({ entity_id }) {
  const { data, canManageData, open, close } = useWallet();
  const property = entityById(data, entity_id);
  if (!canManageData) return <ReadOnly />;
  if (!property || property.kind !== "property" || property.archived) return <Missing />;
  const units = data.entities.filter((entity) => entity.kind === "unit" && entity.parent_id === property.id && !entity.archived);
  if (units.length === 1 && ["available", "rented"].includes(effectiveUnitStatus(units[0], data.agreements, data.today))) return <AgreementForm kind="rent" entity_id={units[0].id} guidedRent />;
  const createUnit = () => open("entityForm", { kind: "unit", parent_id: property.id, rentAfterSave: true });
  return (
    <Modal title={`تأجير ${normalizeDigits(property.name)}`} onClose={close}>
      <p className="rental-intro">اختر ما تريد تأجيره، ثم أضف المستأجر وقيمة العقد ومواعيده.</p>
      {units.length > 0 ? (
        <div className="rental-unit-list">
          {units.map((unit) => {
            const status = effectiveUnitStatus(unit, data.agreements, data.today);
            return (
            <div className="record-row" key={unit.id}>
              <div className="record-main"><strong>{normalizeDigits(unit.name)}</strong><small className="muted">{unitStatusNames[status]} · {normalizeDigits(property.name)}</small></div>
              <Button variant="primary" disabled={!["available", "rented"].includes(status)} onClick={() => open("agreementForm", { kind: "rent", entity_id: unit.id, guidedRent: true })}>{status === "rented" ? "عقد لاحق / تجديد" : "تأجير"} {normalizeDigits(unit.name)}</Button>
            </div>
          ); })}
          <Button variant="ghost" onClick={() => createUnit()}>إضافة وحدة أخرى وتأجيرها</Button>
        </div>
      ) : (
        <div className="stack">
          <p className="muted">الوحدة هي المساحة التي ستؤجرها، مثل شقة أو محل أو فيلا. أضف اسمها مرة واحدة، ثم اربط بها المستأجر والعقد.</p>
          <Button variant="primary" onClick={() => createUnit()}>إضافة وحدة للتأجير</Button>
        </div>
      )}
    </Modal>
  );
}
function EntityForm({ id, kind: requestedKind, property_type, parent_id, rentAfterSave = false, initialName = "" }) {
  const { data, canManageData, open, notify } = useWallet();
  const [entity] = useState(() => (id ? entityById(data, id) : null));
  const kind = entity?.kind || requestedKind;
  const mutation = useFormMutation();
  const saved = useSavedResult();
  const afterSave = (result) => {
    if (rentAfterSave && result?.refreshed !== false && result?.result?.id) {
      notify("حُفظت الوحدة. أضف المستأجر والعقد لإكمال التأجير.");
      open("agreementForm", { kind: "rent", entity_id: result.result.id, guidedRent: true, unitJustCreated: true });
    } else saved(result);
  };
  if (!canManageData) return <ReadOnly />;
  if ((id && !entity) || !entityNames[kind]) return <Missing />;
  if (entity?.archived)
    return <ReadOnly>هذا الأصل مؤرشف، وتبقى بياناته محفوظة للمراجعة.</ReadOnly>;
  const submit = (body) => {
    if (id) body.expected_version = entity.version;
    else body.kind = kind;
    return mutation.submit(
      id ? `/api/entities/${id}` : "/api/entities",
      body,
      afterSave,
      id ? "PATCH" : "POST",
    );
  };
  const reference =
    entity?.reference_value_cents != null
      ? toInput(entity.reference_value_cents)
      : "";
  if (rentAfterSave && !id) return (
    <FormFrame title="إضافة وحدة للتأجير" mutation={mutation} onSubmit={submit} submitLabel="حفظ الوحدة ومتابعة التأجير">
      <Notice>تُحفظ الوحدة أولًا، ثم تدخل بيانات المستأجر والعقد. إذا ألغيت الخطوة التالية، تبقى الوحدة محفوظة دون عقد إيجار.</Notice>
      <input type="hidden" name="parent_id" value={parent_id || ""} />
      <input type="hidden" name="status" value="available" />
      <TextField label="اسم الوحدة" name="name" value={initialName} required hint="اسم المساحة التي ستؤجرها، مثل شقة 1 أو محل 3 أو فيلا 1" />
    </FormFrame>
  );
  return (
    <FormFrame
      title={`${id ? "تعديل" : "إضافة"} ${entityNames[kind]}`}
      onSubmit={submit}
      mutation={mutation}
      submitLabel={rentAfterSave ? "حفظ الوحدة ومتابعة التأجير" : "حفظ"}
      wide
    >
      {rentAfterSave && <Notice>تُحفظ الوحدة أولًا، ثم تدخل بيانات المستأجر والعقد. إذا ألغيت الخطوة التالية، تبقى الوحدة محفوظة دون عقد إيجار.</Notice>}
      <TextField
        label={`اسم ${entityNames[kind]}`}
        name="name"
        value={entity?.name || initialName}
        required
        hint={
          kind === "property"
            ? "مثل عمارة الياسمين أو بيت الروضة أو استراحة النخيل"
            : kind === "unit"
              ? "مثل شقة 1 أو محل 3"
              : kind === "car"
                ? "مثل كامري 2025"
                : undefined
        }
      />
      {kind === "property" && (
        <>
          <SelectField label="نوع العقار" name="property_type" value={entity?.property_type ?? property_type ?? ""}
            required={!id} options={[["", id ? "غير مصنف" : "اختر نوع العقار"], ...propertyTypes.map(([key, , name]) => [key, name])]}
            hint={id ? "تغيير التصنيف يحفظ الوحدات والعقود والمبالغ المرتبطة كما هي." : undefined} />
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
              value={(entity?.manual_status ?? entity?.status) === "rented" ? "available" : entity?.manual_status ?? entity?.status ?? "available"}
              hint="تبقى الوحدة مؤجرة حتى تأكيد الإخلاء وحفظه من العقد، ولو انتهت مدته أو اكتمل التحصيل."
              options={[
                ["available", "متاحة"],
                ["maintenance", "صيانة"],
                ["personal_use", "استخدام شخصي"],
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
  const { data, close, open, canManageData } = useWallet();
  const entity = entityById(data, id);
  if (!entity) return <Missing />;
  const rentalStatus = entity.kind === "unit" ? effectiveUnitStatus(entity, data.agreements, data.today) : "available";
  const agreements = data.agreements.filter(
    (a) => a.entity_id === id && a.status === "active",
  );
  const units =
    entity.kind === "property"
      ? data.entities.filter((e) => e.parent_id === id)
      : [];
  return (
    <Modal title={normalizeDigits(entity.name)} onClose={close} wide>
      {entity.archived && (
        <Notice>أصل مؤرشف؛ بياناته المرجعية واتفاقاته محفوظة للمراجعة.</Notice>
      )}
      <RecordGrid record={entity.kind === "unit" ? { ...entity, status: effectiveUnitStatus(entity, data.agreements, data.today) } : entity} />
      {!!units.length && (
        <section className="stack">
          <h3>الوحدات التابعة</h3>
          {units.map((unit) => (
            <div className="record-row" key={unit.id}>
              <div>
                <strong>{normalizeDigits(unit.name)}</strong>
                <p className="muted">
                  {unitStatusNames[effectiveUnitStatus(unit, data.agreements, data.today)]}
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
                  <strong>{normalizeDigits(a.title)}</strong>
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
      {canManageData && !entity.archived && (
        <div className="form-actions">
          {["property", "unit"].includes(entity.kind) && <Button variant="primary" disabled={!["available", "rented"].includes(rentalStatus)} onClick={() => entity.kind === "property" ? open("rentalStart", { entity_id: id }) : open("agreementForm", { kind: "rent", entity_id: id, guidedRent: true })}>{rentalStatus === "rented" ? "عقد لاحق / تجديد" : "تأجير"}</Button>}
          {entity.kind !== "worker" && (
            <Button onClick={() => open("agreementType", { entity_id: id })}>
              شراء أو بيع
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
  const { data, open, close, canManageData } = useWallet();
  const entity = entityById(data, entity_id);
  if (!canManageData) return <ReadOnly />;
  if (!entity || entity.archived || entity.kind === "worker")
    return <Missing />;
  const options = ["purchase", "sale"];
  return (
    <Modal title="إضافة عقد أو عملية" onClose={close}>
      <p className="muted">حدد نوع العملية المرتبطة بـ {normalizeDigits(entity.name)}</p>
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
function RentalAgreementForm({ agreement, entity, hasPayments, mutation, submit, guidedRent, unitJustCreated, today }) {
  const { data } = useWallet();
  const [localError, setLocalError] = useState("");
  const existingRents = data.agreements.filter((item) => item.entity_id === entity.id && item.kind === "rent" && item.status === "active" && !item.closed_at && !item.vacated_at && item.id !== agreement?.id);
  const [total, setTotal] = useState(agreement ? toInput(agreement.total_cents) : ""),
    [opening, setOpening] = useState(agreement ? toInput(agreement.opening_cents) : "0"),
    [count, setCount] = useState(agreement?.installment_count || 1),
    [frequency, setFrequency] = useState(agreement?.frequency_months || 1),
    [startDate, setStartDate] = useState(agreement?.start_date || today),
    [endDate, setEndDate] = useState(agreement?.end_date || ""),
    [firstDue, setFirstDue] = useState(agreement?.first_due_date || today);
  const firstDueEdited = useRef(Boolean(agreement));
  let schedule = null, previewError = "";
  if (total) {
    try {
      schedule = project({ total_cents: inputCents(total), opening_cents: inputCents(opening), installment_count: Number(normalizeDecimal(count, { integer: true })), frequency_months: Number(frequency), first_due_date: firstDue });
      if (firstDue < startDate || (endDate && schedule.rows.at(-1).due_date > endDate)) previewError = "اجعل مواعيد الأقساط داخل فترة العقد، أو عدّل نهاية العقد.";
    } catch (error) { previewError = error.message; }
  }
  return (
    <FormFrame title={`${agreement ? "تعديل عقد إيجار" : "تأجير"} · ${normalizeDigits(entity.name)}`} mutation={mutation} onSubmit={(body) => {
      if ((guidedRent || !agreement) && !body.counterparty?.trim()) { setLocalError("أدخل اسم المستأجر لإكمال العقد."); return; }
      setLocalError("");
      body.title = body.title?.trim() || `إيجار ${normalizeDigits(entity.name)}`;
      submit(body);
    }} localError={localError} wide submitLabel={agreement ? "حفظ التعديلات" : "حفظ عقد الإيجار"}>
      <p className="rental-context">{normalizeDigits(entity.name)}<span>العقد مرتبط بهذه الوحدة</span></p>
      {unitJustCreated && <Notice>الوحدة محفوظة. إلغاء هذه الخطوة يتركها دون عقد إيجار.</Notice>}
      {existingRents.length > 0 && <Notice>للوحدة عقود مسجلة: {existingRents.map((item) => <span className="existing-rent" key={item.id}>{normalizeDigits(item.counterparty || item.title)} · {fmtDate(item.start_date)} إلى {fmtDate(item.end_date)}</span>)}اختر فترة جديدة لا تتداخل معها.</Notice>}
      <section className="form-section">
        <h3><span>1</span> بيانات المستأجر</h3>
        <div className="form-grid">
          <TextField label="اسم المستأجر" name="counterparty" value={agreement?.counterparty} required={guidedRent || !agreement} />
          <TextField label="رقم التواصل" name="phone" value={agreement?.phone} type="tel" />
        </div>
      </section>
      <section className="form-section">
        <h3><span>2</span> مدة العقد</h3>
        <div className="form-grid">
          <TextField label="بداية العقد" name="start_date" value={startDate} type="date" required disabled={hasPayments} onChange={(event) => { setStartDate(event.target.value); if (!firstDueEdited.current) setFirstDue(event.target.value); }} />
          <TextField label="نهاية العقد" name="end_date" value={endDate} type="date" required disabled={hasPayments} onChange={(event) => setEndDate(event.target.value)} />
        </div>
      </section>
      <section className="form-section">
        <h3><span>3</span> قيمة العقد والتحصيل</h3>
        {hasPayments && <Notice warning>بدأ تنفيذ هذا الجدول. يمكنك تعديل بيانات المستأجر ووصف العقد، وتبقى مبالغ الجدولة ومواعيدها محفوظة.</Notice>}
        <TextField label="إجمالي قيمة العقد (ر.س)" name="total" value={total} type="number" required disabled={hasPayments} hint="قيمة العقد كاملة، وليست قيمة الإيجار الشهري" onChange={(event) => setTotal(event.target.value)} />
        <div className="form-grid">
          <TextField label="عدد الدفعات" name="count" value={count} type="number" required disabled={hasPayments} hint="1 إذا كان العقد يُحصّل دفعة واحدة" onChange={(event) => setCount(event.target.value)} />
          <SelectField label="دورية الدفعات" name="frequency" value={frequency} disabled={hasPayments} options={[[1,"شهريًا"],[3,"كل 3 أشهر"],[6,"كل 6 أشهر"],[12,"سنويًا"]]} onChange={(event) => setFrequency(event.target.value)} />
          <Field label="موعد أول دفعة"><input name="first_due_date" type="date" value={firstDue} min="1000-01-01" max="9999-12-31" required disabled={hasPayments} onChange={(event) => { firstDueEdited.current = true; setFirstDue(event.target.value); }} /></Field>
        </div>
        {!hasPayments && <div className="rental-preview" aria-live="polite">
          <strong>معاينة جدول التحصيل</strong>
          {!schedule ? <p className="muted">أدخل قيمة العقد لعرض مبالغ الدفعات ومواعيدها.</p> : <>
            <div className="rental-preview-rows">{schedule.rows.slice(0,3).map((row) => <div key={row.slot}><span>الدفعة {row.slot + 1}</span><span>{fmtDate(row.due_date)}</span><Money value={row.initial_cents} /></div>)}{schedule.rows.length > 3 && <div><span>الأخيرة ({schedule.rows.length})</span><span>{fmtDate(schedule.rows.at(-1).due_date)}</span><Money value={schedule.rows.at(-1).initial_cents} /></div>}</div>
            <small className="muted">يُوزّع المتبقي بعد التحصيل السابق على الدفعات. حفظ العقد ينشئ استحقاقات؛ يُسجل التحصيل الفعلي عند استلام المال.</small>
          </>}
          {previewError && <p className="danger-text" role="alert">{previewError}</p>}
        </div>}
      </section>
      <details className="form-disclosure">
        <summary>تفاصيل إضافية والتحصيل السابق <span>اختياري</span></summary>
        <div className="form-fields">
          <TextField label="رقم عقد الإيجار" name="contract_number" value={agreement?.contract_number} hint="رقم مرجعي؛ رفع ملفات العقود غير متاح حاليًا" />
          <TextField label="اسم العملية أو العقد" name="title" value={agreement?.title || `إيجار ${normalizeDigits(entity.name)}`} />
          <TextField label="المحصّل قبل تأسيس المحفظة" name="opening" value={opening} type="number" disabled={hasPayments} hint="يقلل المتبقي، ولا يُسجل ضمن حركة النقد للشهر" onChange={(event) => setOpening(event.target.value)} />
          <TextField label="ملاحظات (اختياري)" name="note" value={agreement?.note} type="textarea" />
        </div>
      </details>
    </FormFrame>
  );
}
function AgreementForm({ id, kind: requestedKind, entity_id, guidedRent = false, unitJustCreated = false }) {
  const { data, canManageData } = useWallet();
  const [agreement] = useState(() => (id ? agreementById(data, id) : null));
  const [hasPayments] = useState(() =>
    Boolean(agreement?.vacated_at || (id && agreementPayments(data, id).length)),
  );
  const mutation = useFormMutation();
  const saved = useSavedResult(id);
  const kind = agreement?.kind || requestedKind;
  const entity = entityById(data, agreement?.entity_id || entity_id);
  if (!canManageData) return <ReadOnly />;
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
  if (!id && kind === "rent" && ["maintenance", "personal_use", "unavailable"].includes(entity?.manual_status ?? entity?.status))
    return <ReadOnly>الوحدة غير متاحة للتأجير حاليًا. غيّر حالتها من بيانات الوحدة أولًا.</ReadOnly>;
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
  if (kind === "rent") return <RentalAgreementForm agreement={agreement} entity={entity} hasPayments={hasPayments} mutation={mutation} submit={submit} guidedRent={guidedRent} unitJustCreated={unitJustCreated} today={data.today} />;
  return (
    <FormFrame
      title={`${id ? "تعديل" : "إضافة"} ${agreementNames[kind]}`}
      onSubmit={submit}
      mutation={mutation}
      wide
    >
      <Notice>
        {kind === "other"
            ? "عملية مالية مجدولة ضمن «أخرى»، وتُسجل في السداد."
            : "شراء يُولد سدادًا، وبيع يُولد تحصيلًا. قيمة الأصل نفسها لا تُحسب كحركة نقدية."}
      </Notice>
      {entity && (
        <p className="muted">
          الأصل المرتبط: <strong>{normalizeDigits(entity.name)}</strong>
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
      <TextField label="الطرف المرتبط (اختياري)" name="counterparty" value={agreement?.counterparty} />
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
            kind === "sale"
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

function RentalEntry(props) {
  const {data}=useWallet();
  return entityById(data,props.entity_id)?.property_type==="rest_house" ? <BookingForm {...props} /> : <RentalStart {...props} />;
}

function BookingForm({entity_id, day:initialDay}) {
  const {data,canManageData} = useWallet();
  const [day,setDay] = useState(initialDay || data.today);
  const mutation=useFormMutation(), saved=useSavedResult(undefined,"تم حفظ الحجز وتحديث توفر الاستراحة");
  const property=entityById(data,entity_id);
  if(!canManageData) return <ReadOnly />;
  if(property?.property_type!=="rest_house" || property.archived) return <Missing />;
  const available=restHouseAvailability(property,data.entities,data.agreements,day,data.today);
  const blocked=!day || day<data.today || available.status!=="available";
  return <FormFrame title={"حجز يومي · "+normalizeDigits(property.name)} mutation={mutation} submitLabel="حفظ الحجز" submitDisabled={blocked}
    onSubmit={body=>mutation.submit("/api/bookings",{...body,entity_id},saved)}>
    <Field label="يوم الحجز"><input name="day" type="date" min={data.today} max="9999-12-31" value={day} onInput={e=>setDay(e.currentTarget.value)} onChange={e=>setDay(e.target.value)} required /></Field>
    <p role="status">{day<data.today ? "لا يمكن إضافة حجز ليوم مضى" : available.status==="rented" ? "محجوز في هذا اليوم" : available.status==="available" ? "متاح في هذا اليوم" : unitStatusNames[available.status]}</p>
    <TextField label="اسم المستأجر" name="counterparty" required />
    <TextField label="رقم التواصل" name="phone" type="tel" />
    <TextField label="قيمة اليوم (ر.س)" name="total" type="number" required />
    <TextField label="رقم العقد (اختياري)" name="contract_number" />
    <TextField label="ملاحظات" name="note" type="textarea" />
    <Notice>الحجز للاستراحة كاملة في اليوم المختار. تُسجّل قيمة الحجز مستحقًا، ويمكن تسجيل التحصيل من تفاصيله أو مهام اليوم.</Notice>
  </FormFrame>;
}

function BookingCancel({id}) {
  const {data,canManageData}=useWallet(), mutation=useFormMutation();
  const saved=useSavedResult(id,"تم إلغاء الحجز وتحرير اليوم مع حفظ التحصيل والمديونية");
  const agreement=agreementById(data,id);
  if(!canManageData) return <ReadOnly />;
  if(agreement?.rental_mode!=="daily" || agreement.closed_at || agreement.booking_cancelled_at) return <Missing />;
  const totals=project(agreement,agreementPayments(data,id));
  return <FormFrame title="إلغاء الحجز اليومي" mutation={mutation} submitLabel="تأكيد الإلغاء وحفظ"
    onSubmit={body=>mutation.submit(`/api/bookings/${id}/cancel`,{note:body.note,confirm_cancellation:body.confirm_cancellation==="on",expected_version:agreement.version},saved)}>
    <Notice warning><strong>{normalizeDigits(agreement.title)}</strong><p>سيصبح اليوم متاحًا بعد الحفظ. تبقى قيمة الحجز والتحصيل والمديونية محفوظة؛ لا يُرد مبلغ ولا تُسقط مديونية تلقائيًا.</p></Notice>
    <dl className="detail-grid"><div><dt>المحصّل المحفوظ</dt><dd><Money value={totals.paid_total_cents} /></dd></div><div><dt>المديونية المتبقية</dt><dd><Money value={totals.remaining_cents} /></dd></div></dl>
    <TextField label="سبب الإلغاء" name="note" type="textarea" required />
    <label><input type="checkbox" name="confirm_cancellation" required /> أؤكد إلغاء الحجز مع حفظ التحصيل والمديونية</label>
  </FormFrame>;
}

function AgreementDetails({ id }) {
  const { data, close, open, canManageData } = useWallet();
  const agreement = agreementById(data, id);
  if (!agreement) return <Missing />;
  const payments = agreementPayments(data, id),
    dues = data.dues.filter((d) => d.agreement_id === id);
  const remaining = dues.reduce((sum, d) => sum + d.amount_cents, 0);
  const canClose =
    !agreement.closed_at &&
    remaining === 0 &&
    (agreement.kind !== "rent" || (agreement.rental_mode === "daily" ? Boolean(agreement.booking_cancelled_at) || agreement.end_date < data.today : Boolean(agreement.vacated_at)));
  const canVacate = agreement.kind === "rent" && agreement.rental_mode !== "daily" && !agreement.closed_at && !agreement.vacated_at && agreement.start_date <= data.today;
  const archived = Boolean(
    agreement.entity_id && entityById(data, agreement.entity_id)?.archived,
  );
  return (
    <Modal title={normalizeDigits(agreement.title)} onClose={close} wide>
      {agreement.booking_cancelled_at && <Notice warning>الحجز ملغى. التحصيل والمديونية محفوظان في هذا السجل.</Notice>}
      {agreement.vacated_at && <Notice>تم تأكيد الإخلاء بتاريخ {fmtDate(agreement.vacated_on)}. المحصّل والمديونية محفوظان، ويمكن متابعة تحصيل المتبقي من هذا العقد.{agreement.vacate_note && <p>{normalizeDigits(agreement.vacate_note)}</p>}</Notice>}
      {canVacate && agreement.end_date < data.today && <Notice warning>انتهت مدة العقد، والوحدة ما زالت مؤجرة إلى حين تأكيد الإخلاء وحفظه.</Notice>}
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
                  {normalizeDigits(payment.note || "دون ملاحظات")}
                  {payment.created_by ? ` · ${payment.created_by}` : ""}
                </p>
              </div>
              <Money value={payment.amount_cents} />
              {canManageData && !agreement.closed_at && (
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
              {canManageData && !agreement.closed_at && (
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
      {canManageData && (
        <>
          <div className="form-actions">
            {canVacate && <Button variant="primary" onClick={() => open("rentalVacate", { id })}>تأكيد الإخلاء / إنهاء الإيجار</Button>}
            {!agreement.closed_at && agreement.rental_mode !== "daily" && (
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
            {!agreement.closed_at && agreement.rental_mode==="daily" && !agreement.booking_cancelled_at && <Button variant="danger" onClick={()=>open("bookingCancel",{id})}>إلغاء الحجز</Button>}
            {!agreement.closed_at && agreement.rental_mode!=="daily" && !payments.length && (agreement.kind !== "rent" || (!agreement.vacated_at && agreement.start_date > data.today)) && (
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
                {agreement.rental_mode==="daily" ? "الإغلاق المالي متاح بعد انتهاء يوم الحجز أو إلغائه وتسوية كامل الرصيد." : "الإغلاق المالي يتطلب حفظ إخلاء الوحدة وتسوية كامل الرصيد."}
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

function RentalVacate({ id }) {
  const { data, canManageData } = useWallet();
  const mutation = useFormMutation();
  const saved = useSavedResult(id, "تم حفظ الإخلاء وتحديث حالة الوحدة مع الاحتفاظ بالتحصيل والمديونية");
  const agreement = agreementById(data, id);
  if (!canManageData) return <ReadOnly />;
  if (!agreement || agreement.kind !== "rent") return <Missing />;
  if (agreement.closed_at || agreement.vacated_at || agreement.start_date > data.today) return <ReadOnly>هذا العقد غير متاح للإخلاء.</ReadOnly>;
  const totals = project(agreement, agreementPayments(data, id));
  return <FormFrame title="تأكيد إخلاء الوحدة" mutation={mutation} submitLabel="حفظ الإخلاء" onSubmit={(body) => mutation.submit(
    `/api/agreements/${id}/vacate`, { ...body, confirm_vacancy: body.confirm_vacancy === "on", expected_version: agreement.version }, saved,
  )}>
    <Notice><strong>{normalizeDigits(agreement.title)}</strong><p>احفظ بعد إخلاء الوحدة فعليًا. الإنهاء المبكر يحفظ قيمة العقد والدفعات ومواعيد المديونية كاملة؛ لا يُحتسب خصم تلقائي.</p></Notice>
    <dl className="detail-grid"><div><dt>المحصّل المحفوظ</dt><dd><Money value={totals.paid_total_cents} /></dd></div><div><dt>المديونية المتبقية</dt><dd><Money value={totals.remaining_cents} /></dd></div></dl>
    <Field label="تاريخ الإخلاء"><input name="vacated_on" type="date" defaultValue={data.today} min={agreement.start_date} max={data.today} required /></Field>
    <TextField label="ملاحظة الإخلاء (اختياري)" name="vacate_note" type="textarea" />
    <label><input type="checkbox" name="confirm_vacancy" required /> أؤكد إخلاء الوحدة مع حفظ التحصيل والمديونية</label>
  </FormFrame>;
}

function PaymentForm({ id, editing = false, returnAgreement }) {
  const { data, canManageData } = useWallet();
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
      payments: due ? data.payments.filter((item) => item.agreement_id === due.agreement_id) : [],
    };
  });
  const { payment, due, agreement, payments } = initial;
  const [amount, setAmount] = useState(() =>
    toInput(payment?.amount_cents ?? due?.amount_cents ?? 0),
  );
  const [localError, setLocalError] = useState("");
  const [paidAt, setPaidAt] = useState(payment?.paid_at || data.today);
  const [rescheduleMethod, setRescheduleMethod] = useState(payment?.reschedule_method || "");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [review, setReview] = useState(null);
  const mutation = useFormMutation();
  const saved = useSavedResult(
    editing ? returnAgreement || agreement?.id : undefined,
    "تم حفظ الحركة وتحديث جدول الاستحقاقات",
  );
  if (!canManageData) return <ReadOnly />;
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
  let isChangedAmount = false;
  let preview = null;
  let projectionError = "";
  try {
    const cents = inputCents(amount);
    isOverpayment = cents > due.amount_cents;
    isChangedAmount = cents !== due.amount_cents;
    if (cents > 0 && (!isOverpayment || rescheduleMethod)) {
      const candidate = {
        ...(payment || {}),
        id: payment?.id || "preview-payment",
        amount_cents: cents,
        slot_index: Number(due.slot),
        paid_at: paidAt,
        active: 1,
        created_at: payment?.created_at || payments.reduce((latest, item) => String(item.created_at || "") > latest ? String(item.created_at) : latest, "") + "~",
        reschedule_method: isOverpayment ? rescheduleMethod : null,
        schedule_end_date: null,
      };
      preview = project(agreement, [...payments.filter((item) => item.id !== payment?.id), candidate]);
    }
  } catch (error) { projectionError = error.message; }
  const projectedEnd = preview?.payment_contexts?.[payment?.id || "preview-payment"]?.schedule_end_date || preview?.schedule_end_date || preview?.rows.filter((row) => row.remaining_cents > 0).at(-1)?.due_date || (preview ? paidAt : "");
  const submit = (body) => {
    setLocalError("");
    if (review) return mutation.submit(
      editing ? `/api/payments/${id}` : `/api/agreements/${agreement.id}/payments`,
      review.body, saved, editing ? "PATCH" : "POST",
    );
    try {
      if (inputCents(body.amount) > due.amount_cents && !body.reschedule_method)
        throw new Error("اختر طريقة إعادة جدولة المبلغ الزائد");
      if (projectionError) throw new Error(projectionError);
      if (!preview) throw new Error("أدخل مبلغًا صحيحًا لمراجعة الحركة.");
      if (isChangedAmount && body.schedule_end_date !== projectedEnd)
        throw new Error("اختر تاريخ نهاية الدفعات لتأكيد أثر المبلغ المعدل.");
    } catch (error) {
      setLocalError(error.message);
      return;
    }
    body.slot = Number(due.slot);
    body.expected_version = agreement.version;
    body.reschedule_method = isOverpayment ? body.reschedule_method : null;
    body.schedule_end_date = isChangedAmount ? body.schedule_end_date : null;
    // Historical corrections confirm the schedule at that payment's position,
    // while the review summarizes the final schedule including later receipts.
    setReview({ body: structuredClone(body), remaining: preview.remaining_cents, end: preview.schedule_end_date ?? projectedEnd });
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
      submitLabel={review ? "حفظ وتأكيد" : editing ? "مراجعة التعديل" : agreement.direction === "in" ? "تم التحصيل" : "تم السداد"}
      localError={localError}
      reviewing={Boolean(review)}
      onBack={() => setReview(null)}
      reviewContent={review && <section className="payment-review" aria-label="مراجعة الحركة قبل الحفظ">
        <Notice><strong>{normalizeDigits(agreement.title)}</strong><p>راجع الحركة ثم اضغط حفظ وتأكيد. لن تُسجل قبل التأكيد.</p></Notice>
        <dl className="detail-grid">
          <div><dt>المبلغ الفعلي</dt><dd><Money value={inputCents(review.body.amount)} /></dd></div>
          <div><dt>تاريخ التنفيذ</dt><dd>{fmtDate(review.body.paid_at)}</dd></div>
          <div><dt>المتبقي بعد الحفظ</dt><dd><Money value={review.remaining} /></dd></div>
          <div><dt>نهاية الجدول بعد الحفظ</dt><dd>{fmtDate(review.end)}</dd></div>
        </dl>
        {agreement.kind === "rent" && <p className="muted">فترة عقد الإيجار تبقى كما هي: {fmtDate(agreement.start_date)} إلى {fmtDate(agreement.end_date)}.</p>}
      </section>}
    >
      <Notice>
        <strong>{normalizeDigits(agreement.title)}</strong>
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
          onChange={(event) => { setAmount(event.target.value); setScheduleEnd(""); setLocalError(""); }}
        />
        <TextField
          label="تاريخ التنفيذ الفعلي"
          name="paid_at"
          value={paidAt}
          type="date"
          required
          onChange={(event) => { setPaidAt(event.target.value); setScheduleEnd(""); }}
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
              checked={rescheduleMethod === "shorten"}
              disabled={!isOverpayment}
              onChange={() => { setRescheduleMethod("shorten"); setScheduleEnd(""); }}
            />{" "}
            تقليل المدة
          </label>
          <label>
            <input
              type="radio"
              name="reschedule_method"
              value="spread"
              checked={rescheduleMethod === "spread"}
              disabled={!isOverpayment}
              onChange={() => { setRescheduleMethod("spread"); setScheduleEnd(""); }}
            />{" "}
            تقليل قيمة الأقساط
          </label>
        </fieldset>
      </div>
      {isChangedAmount && <>
        {!isOverpayment && <Notice warning>هذه دفعة جزئية. يبقى الفرق مستحقًا في موعده الأصلي، ولا تتغير نهاية جدول الدفعات.</Notice>}
        <Field label={editing ? "النهاية بعد هذه الحركة" : "تاريخ نهاية الدفعات"} hint={editing ? "أكد نهاية الجدول في وقت هذه الحركة. تعرض المراجعة النتيجة النهائية مع الحركات اللاحقة، ولا تتغير فترة عقد الإيجار." : isOverpayment ? "اختر التاريخ المحسوب لتأكيد أثر طريقة الجدولة. فترة عقد الإيجار لا تتغير." : "أكد تاريخ النهاية الحالي؛ المبلغ الناقص يبقى مستحقًا."}>
          <select name="schedule_end_date" value={scheduleEnd} onChange={(event) => setScheduleEnd(event.target.value)} required disabled={!projectedEnd}>
            <option value="">اختر تاريخ النهاية للتأكيد</option>
            {projectedEnd && <option value={projectedEnd}>{fmtDate(projectedEnd)}</option>}
          </select>
        </Field>
      </>}
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
  const { data, canManageData } = useWallet();
  const mutation = useFormMutation();
  const saved = useSavedResult();
  if (!canManageData) return <ReadOnly />;
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
  const { data, open, close, canManageData } = useWallet();
  const expense = data.expenses.find((e) => e.id === id);
  if (!expense) return <Missing />;
  return (
    <Modal title={normalizeDigits(expense.title)} onClose={close}>
      <RecordGrid record={expense} />
      {canManageData && (
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
  const { data, canManageData, close, open, notify } = useWallet();
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
  if (!canManageData) return <ReadOnly />;
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
        "يمكن تصحيح الحركات بعد إعادة الفتح. إعادة فتح الحساب المالي لا تلغي الإخلاء المحفوظ ولا تعيد إشغال الوحدة.",
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
        <strong>{normalizeDigits(entity?.name || agreement?.title || expense?.title)}</strong>
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
  "bookingForm",
  "bookingCancel",
  "quickadd",
  "otherAdd",
  "entityForm",
  "rentalStart",
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
  "rentalVacate",
]);
export default function FinancialDialogs({ dialog }) {
  if (!dialog || !financialTypes.has(dialog.type)) return null;
  const key = [
    dialog.type,
    dialog.id || "",
    dialog.entity_id || "",
    dialog.kind || "",
    dialog.property_type || "",
    dialog.parent_id || "",
  ].join(":");
  switch (dialog.type) {
    case "bookingForm":
      return <BookingForm key={key} {...dialog} />;
    case "bookingCancel":
      return <BookingCancel key={key} {...dialog} />;
    case "quickadd":
      return <QuickAdd key={key} />;
    case "otherAdd":
      return <OtherChoice key={key} />;
    case "entityForm":
      return <EntityForm key={key} {...dialog} />;
    case "rentalStart":
      return <RentalEntry key={key} {...dialog} />;
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
    case "rentalVacate":
      return <RentalVacate key={key} {...dialog} />;
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
