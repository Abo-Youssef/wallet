import React, { useMemo, useRef, useState } from "react";
import { Building2, House, Trees } from "lucide-react";
import { useWallet } from "../state/WalletProvider.jsx";
import { Money, Badge, Empty, Button } from "../components/ui.jsx";
import LocalizedInput from "../components/LocalizedInput.jsx";
import { fmtDate, entityById } from "../lib/format.js";
import { normalizeDigits } from "../../shared/numerals.mjs";
import { effectiveUnitStatus, occupiesUnit, unitStatusNames as statusNames, restHouseAvailability } from "../../shared/unit-status.mjs";
import { propertyTypes, propertyTypeNames, propertyTypeLabel, filterPropertyData } from "../../shared/property-types.mjs";
import {
  selectDataRecords,
  formatRiyadhDate,
} from "../../shared/client-model.mjs";

const categories = [
  ["property", "العقارات والوحدات"],
  ["car", "السيارات"],
  ["worker", "العاملون"],
  ["other", "أخرى"],
  ["closed", "الاتفاقات المغلقة"],
];
const kindNames = {
  property: "عقار",
  unit: "وحدة",
  car: "سيارة",
  worker: "عامل",
  purchase: "شراء",
  sale: "بيع",
  rent: "إيجار",
  other: "اتفاق",
};
function unitStatus(unit, data) {
  return effectiveUnitStatus(unit, data.agreements, data.today);
}

function EntityActions({ entity, bookingDay }) {
  const { data, canManageData, open } = useWallet();
  const day=bookingDay || data.today;
  const daily=entity.property_type==="rest_house";
  const availability=daily ? restHouseAvailability(entity,data.entities,data.agreements,day,data.today) : null;
  const status = entity.kind === "unit" ? unitStatus(entity, data) : "available";
  const rentable = ["available", "rented"].includes(status);
  return (
    <div className="record-actions">
      <Button
        variant="secondary"
        onClick={() => open("entityDetails", { id: entity.id })}
      >
        التفاصيل
      </Button>
      {daily && availability.booking && <Button variant="secondary" onClick={()=>open("agreementDetails",{id:availability.booking.id})}>عرض الحجز</Button>}
      {canManageData && !entity.archived && (
        <>
          {daily ? <Button variant="primary" disabled={availability.status!=="available" || day<data.today} onClick={()=>open("bookingForm",{entity_id:entity.id,day})}>حجز يوم</Button> : ["property", "unit"].includes(entity.kind) ? (
            <Button variant="primary" disabled={!rentable} onClick={() => entity.kind === "property"
              ? open("rentalStart", { entity_id: entity.id })
              : open("agreementForm", { kind: "rent", entity_id: entity.id, guidedRent: true })}>
              {status === "rented" ? "عقد لاحق / تجديد" : "تأجير"}
            </Button>
          ) : entity.kind !== "worker" && (
            <Button
              variant="ghost"
              onClick={() => open("agreementType", { entity_id: entity.id })}
            >
              شراء أو بيع
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function AgreementRow({ agreement }) {
  const { data, open, canManageData } = useWallet(),
    entity = entityById(data, agreement.entity_id);
  return (
    <div className="record-row">
      <div className="record-main">
        <strong>{normalizeDigits(agreement.title)}</strong>
        <div className="muted">
          {agreement.rental_mode==="daily" ? "حجز يومي" : kindNames[agreement.kind]}
          {entity ? " · " + normalizeDigits(entity.name) : ""}
          {entity?.archived ? " · أصل مؤرشف" : ""}
        </div>
        {agreement.closed_at ? (
          <small className="muted">
            أُغلق {formatRiyadhDate(agreement.closed_at)}
          </small>
        ) : (
          <small className="muted">
            {agreement.installment_count} أقساط · أول استحقاق{" "}
            {fmtDate(agreement.first_due_date)}
          </small>
        )}
      </div>
      <div className="record-amount">
        <Money value={agreement.total_cents} />
        <small className="muted">إجمالي الاتفاق</small>
      </div>
      <div className="record-actions">
        {agreement.closed_at && <Badge tone="neutral">مغلق</Badge>}
        {agreement.vacated_at && <Badge tone="neutral">تم الإخلاء</Badge>}
        {agreement.booking_cancelled_at && <Badge tone="warning">حجز ملغى · الحساب محفوظ</Badge>}
        <Button
          variant="secondary"
          onClick={() => open("agreementDetails", { id: agreement.id })}
        >
          التفاصيل
        </Button>
        {canManageData && !agreement.closed_at && agreement.rental_mode!=="daily" && (
          <Button
            variant="ghost"
            onClick={() =>
              open("agreementForm", {
                id: agreement.id,
                kind: agreement.kind,
                entity_id: agreement.entity_id,
              })
            }
          >
            تعديل
          </Button>
        )}
      </div>
    </div>
  );
}

function Agreements({ entityId, expanded = false }) {
  const { data } = useWallet(),
    agreements = data.agreements.filter(
      (a) => a.entity_id === entityId && a.status === "active",
    );
  if (!agreements.length) return null;
  return (
    <details className="linked-records record-disclosure" open={expanded ? true : undefined}>
      <summary>العقود والعمليات <span>{agreements.length}</span></summary>
      {agreements.map((a) => (
        <AgreementRow key={a.id} agreement={a} />
      ))}
    </details>
  );
}

function UnitRow({ unit, expanded = false }) {
  const { data } = useWallet(),
    status = unitStatus(unit, data),
    activeRent = data.agreements.filter((agreement) => (agreement.entity_id === unit.id || (agreement.rental_mode==="daily" && agreement.entity_id===unit.parent_id)) && occupiesUnit(agreement, data.today)).sort((a,b) => b.start_date.localeCompare(a.start_date))[0];
  return (
    <div className="unit-record">
      <div className="record-row">
        <div className="record-main">
          <strong>{normalizeDigits(unit.name)}</strong>
          <p className="muted">عداد الكهرباء: <bdi>{normalizeDigits(unit.electricity_meter || "غير مدخل")}</bdi></p>
          {activeRent?.counterparty && <p className="muted">المستأجر: {normalizeDigits(activeRent.counterparty)}</p>}
          {activeRent?.phone && <a href={"tel:" + normalizeDigits(activeRent.phone)} dir="ltr">{normalizeDigits(activeRent.phone)}</a>}
        </div>
        <Badge tone={status === "available" ? "success" : "neutral"}>
          {statusNames[status] || "متاحة"}
        </Badge>
        <EntityActions entity={unit} />
      </div>
      <Agreements entityId={unit.id} expanded={expanded} />
    </div>
  );
}

function PropertyCard({ property, units, search, bookingDay }) {
  const { data, canManageData, open } = useWallet(),
    total = data.entities.filter(
      (e) => e.kind === "unit" && e.parent_id === property.id,
    ).length;
  return (
    <section className="panel entity-card">
      <div className="section-head">
        <div>
          <span className="eyebrow">{propertyTypeLabel(property)}</span>
          <h2>{normalizeDigits(property.name)}</h2>
          <p className="muted">{normalizeDigits(property.location || "لم يُحدد الموقع")}</p>
          {property.electricity_meter && <p className="muted">عداد الكهرباء: <bdi>{normalizeDigits(property.electricity_meter)}</bdi></p>}
        </div>
        <div className="record-actions">
          {!property.property_type && canManageData && <Button variant="secondary" onClick={() => open("entityForm", {id:property.id})}>تحديد النوع</Button>}
          <EntityActions entity={property} bookingDay={bookingDay} />
        </div>
      </div>
      {property.property_type==="rest_house" && <RestHouseDay property={property} day={bookingDay || data.today} />}
      <div className="property-summary"><span>{total} وحدات مسجلة</span>{(property.property_type==="rest_house" ? [] : ["available", "rented", "maintenance", "personal_use", "unavailable"]).map(status => {
        const count = data.entities.filter(e => e.kind === "unit" && e.parent_id === property.id && unitStatus(e,data) === status).length;
        return count > 0 ? <Badge key={status} tone={status === "available" ? "success" : "neutral"}>{count} {statusNames[status]}</Badge> : null;
      })}</div>
      <details className="property-units record-disclosure" open={search ? true : undefined}>
        <summary>الوحدات والعقود <span>عرض التفاصيل</span></summary>
      <div className="section-head">
        <h3>الوحدات {search ? `(${units.length} من ${total})` : ""}</h3>
        {canManageData && (
          <Button
            variant="secondary"
            onClick={() =>
              open("entityForm", { kind: "unit", parent_id: property.id })
            }
          >
            إضافة وحدة
          </Button>
        )}
      </div>
      {units.length ? (
        units.map((unit) => <UnitRow key={unit.id} unit={unit} expanded={Boolean(search)} />)
      ) : (
        <Empty>
          {total && search
            ? "لا توجد وحدات مطابقة للبحث."
            : "أضف الوحدات لربط عقود الإيجار بها."}
        </Empty>
      )}
      <Agreements entityId={property.id} expanded={Boolean(search)} />
      </details>
    </section>
  );
}

function AssetCard({ entity, expanded = false }) {
  const car = entity.kind === "car";
  return (
    <section className="panel entity-card">
      <div className="section-head">
        <div>
          <span className="eyebrow">{kindNames[entity.kind]}</span>
          <h2>{normalizeDigits(entity.name)}</h2>
          <p className="muted">
            {normalizeDigits(car
              ? "اللوحة: " + (entity.plate || "غير مدخلة")
              : entity.work_location || "مكان العمل غير محدد")}
          </p>
        </div>
        <EntityActions entity={entity} />
      </div>
      <dl className="entity-facts">
        {car ? (
          <>
            <div>
              <dt>التأمين</dt>
              <dd>{fmtDate(entity.insurance_expiry)}</dd>
            </div>
            <div>
              <dt>الصيانة</dt>
              <dd>{fmtDate(entity.maintenance_date)}</dd>
            </div>
            <div>
              <dt>العداد / الصيانة عند</dt>
              <dd>
                <bdi>
                  {entity.odometer_km ?? "—"} /{" "}
                  {entity.maintenance_due_km ?? "—"}
                </bdi>{" "}
                كم
              </dd>
            </div>
            <div>
              <dt>القيمة المرجعية</dt>
              <dd>
                {entity.reference_value_cents == null ? (
                  "غير مدخلة"
                ) : (
                  <Money value={entity.reference_value_cents} />
                )}
              </dd>
            </div>
          </>
        ) : (
          <>
            <div>
              <dt>رقم التواصل</dt>
              <dd>
                <bdi>{normalizeDigits(entity.phone || "—")}</bdi>
              </dd>
            </div>
            <div>
              <dt>الإقامة</dt>
              <dd>
                <bdi>{normalizeDigits(entity.iqama_number || "—")}</bdi>
                <small>{fmtDate(entity.iqama_expiry)}</small>
              </dd>
            </div>
            <div>
              <dt>الجواز</dt>
              <dd>
                <bdi>{normalizeDigits(entity.passport_number || "—")}</bdi>
                <small>{fmtDate(entity.passport_expiry)}</small>
              </dd>
            </div>
          </>
        )}
      </dl>
      {car && <Agreements entityId={entity.id} expanded={expanded} />}
    </section>
  );
}

function ExpenseRow({ expense }) {
  const { open } = useWallet();
  return (
    <div className="record-row">
      <div className="record-main">
        <strong>{normalizeDigits(expense.title)}</strong>
        <p className="muted">
          {fmtDate(expense.paid_at)}
          {expense.note ? " · " + normalizeDigits(expense.note) : ""}
        </p>
      </div>
      <Money value={expense.amount_cents} />
      <Button
        variant="secondary"
        onClick={() => open("expenseDetails", { id: expense.id })}
      >
        التفاصيل
      </Button>
    </div>
  );
}

function RestHouseDay({property,day}) {
  const {data}=useWallet();
  const availability=restHouseAvailability(property,data.entities,data.agreements,day,data.today);
  return <div className="booking-day-status" role="status">
    <Badge tone={availability.status==="available" ? "success" : "warning"}>{availability.status==="rented" ? "محجوز" : availability.status==="available" ? "متاح" : statusNames[availability.status]}</Badge>
    <span>{fmtDate(day)} · الاستراحة كاملة</span>
    {availability.booking?.counterparty && <span>{normalizeDigits(availability.booking.counterparty)}</span>}
    {availability.booking?.phone && <a dir="ltr" href={"tel:"+normalizeDigits(availability.booking.phone)}>{normalizeDigits(availability.booking.phone)}</a>}
  </div>;
}

function DataTable({ kind, records, bookingDay }) {
  const { data, open } = useWallet();
  const columns =
    kind === "property"
      ? ["السجل", "التبعية / الموقع", "الحالة"]
      : kind === "car"
        ? ["السيارة", "رقم اللوحة", "التأمين / الصيانة"]
        : kind === "worker"
          ? ["العامل", "مكان العمل", "الإقامة / الجواز"]
          : kind === "closed"
            ? ["الاتفاق", "الأصل المرتبط", "تاريخ الإغلاق"]
            : ["العملية", "التصنيف", "القيمة"];
  const rows =
    kind === "closed"
      ? records.agreements.map((a) => ({
          id: a.id,
          values: [
            a.title,
            entityById(data, a.entity_id)?.name || "دون أصل مرتبط",
            formatRiyadhDate(a.closed_at),
          ],
          action: () => open("agreementDetails", { id: a.id }),
        }))
      : kind === "other"
        ? [
            ...records.agreements.map((a) => ({
              id: a.id,
              values: [
                a.title,
                a.closed_at ? "اتفاق مغلق" : "اتفاق مجدول",
                <Money value={a.total_cents} />,
              ],
              action: () => open("agreementDetails", { id: a.id }),
            })),
            ...records.expenses.map((e) => ({
              id: e.id,
              values: [
                e.title,
                "مصروف مباشر",
                <Money value={e.amount_cents} />,
              ],
              action: () => open("expenseDetails", { id: e.id }),
            })),
          ]
        : records.entities.map((e) => ({
            id: e.id,
            values:
              kind === "property"
                ? [
                    e.name,
                    e.kind === "property"
                      ? e.location || "عقار رئيسي"
                      : entityById(data, e.parent_id)?.name || "وحدة مستقلة",
                    e.kind === "property"
                      ? e.property_type==="rest_house" ? <RestHouseDay property={e} day={bookingDay || data.today} /> : propertyTypeLabel(e)
                      : statusNames[unitStatus(e, data)] || "—",
                  ]
                : kind === "car"
                  ? [
                      e.name,
                      e.plate || "—",
                      `${fmtDate(e.insurance_expiry)} / ${fmtDate(e.maintenance_date)}`,
                    ]
                  : [
                      e.name,
                      e.work_location || "—",
                      `${fmtDate(e.iqama_expiry)} / ${fmtDate(e.passport_expiry)}`,
                    ],
            entity: e,
          }));
  return (
    <section className="panel">
      <div
        className="tablewrap"
        tabIndex="0"
        role="region"
        aria-label="جدول البيانات؛ يمكن التمرير أفقيًا"
      >
        <table className="data-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
              <th scope="col">الإجراءات</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                {row.values.map((value, i) => (
                  <td key={i}>{typeof value === "string" ? normalizeDigits(value) : value}</td>
                ))}
                <td>
                  {row.entity ? (
                    <EntityActions entity={row.entity} bookingDay={bookingDay} />
                  ) : (
                    <Button variant="secondary" onClick={row.action}>
                      التفاصيل
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function DataPage({ initialKind = "property", scoped = false } = {}) {
  const { data, canManageData, open } = useWallet();
  const [kind, setKind] = useState(initialKind),
    [bookingDay,setBookingDay] = useState(data.today),
    [propertyType, setPropertyType] = useState("all"),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState("cards"),
    searchRef = useRef(null);
  const records = useMemo(
    () => selectDataRecords(kind === "property" ? filterPropertyData(data, propertyType) : data, kind, search),
    [data, kind, propertyType, search],
  );
  const label = categories.find(([key]) => key === kind)[1];
  const unclassifiedCount = data.entities.filter(entity => entity.kind === "property" && !entity.property_type).length;
  const propertyIcons = {building:Building2, house:House, rest_house:Trees};
  const addName = kind === "property" ? propertyTypeNames[propertyType] || "عقار" : kindNames[kind];
  const clear = () => {
    setSearch("");
    searchRef.current?.focus();
  };
  return (
    <div className="stack data-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">أصولك واتفاقاتك</span>
          <h1 tabIndex={-1}>{scoped ? kind === "property" ? "الأصول" : label : "الأصول والبيانات"}</h1>
          {kind === "property" && <p className="muted">حالة الوحدات حسب العقود الحالية، مع إظهار الصيانة والاستخدام الشخصي.</p>}
        </div>
      </header>
      {kind === "property" && <nav className="property-classification" aria-label="أقسام العقارات">
        <div className="property-type-options">
          {propertyTypes.map(([key, plural]) => {
            const Icon = propertyIcons[key];
            const count = data.entities.filter(entity => entity.kind === "property" && entity.property_type === key).length;
            return <button key={key} type="button" className="property-type-option" aria-pressed={propertyType === key} onClick={() => setPropertyType(key)}>
              <Icon size={24} aria-hidden="true" /><span>{plural}</span>{" "}<bdi>{count}</bdi>
            </button>;
          })}
        </div>
        <div className="tabs property-type-secondary">
          <button type="button" aria-pressed={propertyType === "all"} className={propertyType === "all" ? "active" : ""} onClick={() => setPropertyType("all")}>كل الأصول</button>
          {(unclassifiedCount > 0 || propertyType === "unclassified") && <button type="button" aria-pressed={propertyType === "unclassified"} className={propertyType === "unclassified" ? "active" : ""} onClick={() => setPropertyType("unclassified")}>غير مصنف <bdi>{unclassifiedCount}</bdi></button>}
        </div>
      </nav>}
      {kind==="property" && ["all","rest_house"].includes(propertyType) && data.entities.some(e=>e.property_type==="rest_house") && <section className="panel booking-day-picker">
        <label htmlFor="rest-house-day">يوم حجوزات الاستراحات</label>
        <LocalizedInput id="rest-house-day" type="date" value={bookingDay} max="9999-12-31" onInput={e=>setBookingDay(e.currentTarget.value || data.today)} onChange={e=>setBookingDay(e.target.value || data.today)} />
        <Button variant="secondary" onClick={()=>setBookingDay(data.today)}>اليوم</Button>
        <p className="muted">تظهر حالة كل استراحة لليوم المختار. يمكنك اختيار يوم سابق لمراجعة الحجوزات.</p>
      </section>}
      <section className="data-toolbar">
        <div className="section-head">
          {!scoped && <div className="tabs" aria-label="نوع البيانات">
            {categories.map(([key, name]) => (
              <button
                key={key}
                type="button"
                className={kind === key ? "active" : ""}
                aria-pressed={kind === key}
                onClick={() => {
                  setKind(key);
                  setSearch("");
                }}
              >
                {name}
              </button>
            ))}
          </div>}
          <Button
            variant="secondary"
            onClick={() => setMode(mode === "cards" ? "table" : "cards")}
          >
            {mode === "cards" ? "عرض جدولي" : "عرض البطاقات"}
          </Button>
        </div>
        <div className="search-row">
          <label className="search-field">
            <span className="sr-only">البحث في {label}</span>
            <input
              ref={searchRef}
              type="search"
              placeholder="ابحث بالاسم، الرقم، الموقع أو العقد"
              value={search}
              onChange={(e) => setSearch(normalizeDigits(e.target.value))}
            />
          </label>
          {search && (
            <Button variant="ghost" onClick={clear}>
              مسح البحث
            </Button>
          )}
          {canManageData &&
            kind !== "closed" &&
            (kind === "other" ? (
              <div className="record-actions">
                <Button
                  variant="primary"
                  onClick={() => open("agreementForm", { kind: "other" })}
                >
                  اتفاق مجدول
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => open("expenseForm", {})}
                >
                  مصروف مباشر
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                onClick={() => open("entityForm", { kind, ...(kind === "property" && propertyTypeNames[propertyType] ? {property_type:propertyType} : {}) })}
              >
                إضافة {addName}
              </Button>
            ))}
        </div>
        <p className="muted search-meta" role="status">
          {records.resultCount} سجل{search ? " مطابق" : ""} من{" "}
          {records.totalCount}
        </p>
      </section>
      {!records.resultCount ? (
        <Empty>
          {search
            ? "لا توجد سجلات تطابق البحث."
            : kind === "closed"
              ? "ستظهر هنا الاتفاقات بعد إغلاقها، مع الاحتفاظ بكل حركاتها."
              : kind === "property" ? propertyType === "unclassified" ? "كل العقارات مصنفة. الوحدات المستقلة متاحة ضمن «كل الأصول»." : `ابدأ بإضافة ${addName}. ستجد بجانبه زر «تأجير» لإضافة المستأجر والعقد.` : "ابدأ بإضافة أول سجل لهذا القسم."}
          {search && (
            <Button variant="secondary" onClick={clear}>
              عرض الكل
            </Button>
          )}
        </Empty>
      ) : mode === "table" ? (
        <DataTable kind={kind} records={records} bookingDay={bookingDay} />
      ) : kind === "property" ? (
        <div className="stack">
          {records.entities
            .filter((e) => e.kind === "property")
            .map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                bookingDay={bookingDay}
                units={records.entities.filter(
                  (e) => e.kind === "unit" && e.parent_id === property.id,
                )}
                search={search}
              />
            ))}
          {records.entities.some((e) => e.kind === "unit" && !e.parent_id) && (
            <section className="panel">
              <div className="section-head">
                <h2>وحدات مستقلة</h2>
                {canManageData && (
                  <Button
                    variant="secondary"
                    onClick={() => open("entityForm", { kind: "unit" })}
                  >
                    إضافة وحدة مستقلة
                  </Button>
                )}
              </div>
              {records.entities
                .filter((e) => e.kind === "unit" && !e.parent_id)
                .map((unit) => (
                  <UnitRow key={unit.id} unit={unit} expanded={Boolean(search)} />
                ))}
            </section>
          )}
        </div>
      ) : kind === "car" || kind === "worker" ? (
        <div className="asset-grid">
          {records.entities.map((entity) => (
            <AssetCard key={entity.id} entity={entity} expanded={Boolean(search)} />
          ))}
        </div>
      ) : kind === "closed" ? (
        <section className="panel">
          <div className="section-head">
            <div>
              <h2>الاتفاقات المغلقة</h2>
              <p className="muted">
                تاريخ محفوظ للمراجعة، حتى بعد أرشفة الأصل.
              </p>
            </div>
            <Badge>{records.agreements.length}</Badge>
          </div>
          {records.agreements.map((agreement) => (
            <AgreementRow key={agreement.id} agreement={agreement} />
          ))}
        </section>
      ) : (
        <div className="stack">
          <section className="panel">
            <h2>الاتفاقات المجدولة</h2>
            {records.agreements.length ? (
              records.agreements.map((agreement) => (
                <AgreementRow key={agreement.id} agreement={agreement} />
              ))
            ) : (
              <Empty>لا توجد اتفاقات مجدولة تطابق البحث.</Empty>
            )}
          </section>
          <section className="panel">
            <h2>المصروفات المباشرة</h2>
            {records.expenses.length ? (
              records.expenses.map((expense) => (
                <ExpenseRow key={expense.id} expense={expense} />
              ))
            ) : (
              <Empty>لا توجد مصروفات تطابق البحث.</Empty>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
