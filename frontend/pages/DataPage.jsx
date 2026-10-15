import React, { useMemo, useRef, useState } from "react";
import { useWallet } from "../state/WalletProvider.jsx";
import { Money, Badge, Empty, Button } from "../components/ui.jsx";
import { fmtDate, entityById } from "../lib/format.js";
import {
  selectDataRecords,
  formatRiyadhDate,
} from "../../public/client-model.mjs";

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
const statusNames = {
  available: "متاحة",
  rented: "مؤجرة",
  maintenance: "صيانة",
  unavailable: "غير متاحة",
};

function unitStatus(unit, data) {
  return data.agreements.some(
    (a) =>
      a.entity_id === unit.id &&
      a.kind === "rent" &&
      a.status === "active" &&
      !a.closed_at &&
      a.start_date <= data.today &&
      a.end_date >= data.today,
  )
    ? "rented"
    : unit.status;
}

function EntityActions({ entity }) {
  const { isAssistant, open } = useWallet();
  return (
    <div className="record-actions">
      <Button
        variant="secondary"
        onClick={() => open("entityDetails", { id: entity.id })}
      >
        التفاصيل
      </Button>
      {isAssistant && !entity.archived && (
        <>
          <Button
            variant="ghost"
            onClick={() =>
              open("entityForm", { kind: entity.kind, id: entity.id })
            }
          >
            تعديل
          </Button>
          {entity.kind !== "worker" && (
            <Button
              variant="ghost"
              onClick={() => open("agreementForm", { entity_id: entity.id })}
            >
              {entity.kind === "unit" ? "إضافة عقد" : "شراء أو بيع"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function AgreementRow({ agreement }) {
  const { data, open, isAssistant } = useWallet(),
    entity = entityById(data, agreement.entity_id);
  return (
    <div className="record-row">
      <div className="record-main">
        <strong>{agreement.title}</strong>
        <div className="muted">
          {kindNames[agreement.kind]}
          {entity ? " · " + entity.name : ""}
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
        <Button
          variant="secondary"
          onClick={() => open("agreementDetails", { id: agreement.id })}
        >
          التفاصيل
        </Button>
        {isAssistant && !agreement.closed_at && (
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

function Agreements({ entityId }) {
  const { data } = useWallet(),
    agreements = data.agreements.filter(
      (a) => a.entity_id === entityId && a.status === "active",
    );
  if (!agreements.length) return null;
  return (
    <div className="linked-records">
      <h4>العقود والعمليات</h4>
      {agreements.map((a) => (
        <AgreementRow key={a.id} agreement={a} />
      ))}
    </div>
  );
}

function UnitRow({ unit }) {
  const { data } = useWallet(),
    status = unitStatus(unit, data);
  return (
    <div className="unit-record">
      <div className="record-row">
        <div className="record-main">
          <strong>{unit.name}</strong>
          {unit.notes && <p className="muted">{unit.notes}</p>}
        </div>
        <Badge tone={status === "available" ? "success" : "neutral"}>
          {statusNames[status] || "متاحة"}
        </Badge>
        <EntityActions entity={unit} />
      </div>
      <Agreements entityId={unit.id} />
    </div>
  );
}

function PropertyCard({ property, units, search }) {
  const { data, isAssistant, open } = useWallet(),
    total = data.entities.filter(
      (e) => e.kind === "unit" && e.parent_id === property.id,
    ).length;
  return (
    <section className="panel entity-card">
      <div className="section-head">
        <div>
          <span className="eyebrow">عقار</span>
          <h2>{property.name}</h2>
          <p className="muted">{property.location || "لم يُحدد الموقع"}</p>
        </div>
        <EntityActions entity={property} />
      </div>
      <dl className="entity-facts">
        <div>
          <dt>القيمة المرجعية</dt>
          <dd>
            {property.reference_value_cents == null ? (
              "غير مدخلة"
            ) : (
              <Money value={property.reference_value_cents} />
            )}
          </dd>
        </div>
        <div>
          <dt>عداد الكهرباء</dt>
          <dd>{property.electricity_meter || "غير مدخل"}</dd>
        </div>
        <div>
          <dt>الوحدات</dt>
          <dd>{total}</dd>
        </div>
      </dl>
      <div className="section-head">
        <h3>الوحدات {search ? `(${units.length} من ${total})` : ""}</h3>
        {isAssistant && (
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
        units.map((unit) => <UnitRow key={unit.id} unit={unit} />)
      ) : (
        <Empty>
          {total && search
            ? "لا توجد وحدات مطابقة للبحث."
            : "أضف الوحدات لربط عقود الإيجار بها."}
        </Empty>
      )}
      <Agreements entityId={property.id} />
    </section>
  );
}

function AssetCard({ entity }) {
  const car = entity.kind === "car";
  return (
    <section className="panel entity-card">
      <div className="section-head">
        <div>
          <span className="eyebrow">{kindNames[entity.kind]}</span>
          <h2>{entity.name}</h2>
          <p className="muted">
            {car
              ? "اللوحة: " + (entity.plate || "غير مدخلة")
              : entity.work_location || "مكان العمل غير محدد"}
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
                <bdi>{entity.phone || "—"}</bdi>
              </dd>
            </div>
            <div>
              <dt>الإقامة</dt>
              <dd>
                <bdi>{entity.iqama_number || "—"}</bdi>
                <small>{fmtDate(entity.iqama_expiry)}</small>
              </dd>
            </div>
            <div>
              <dt>الجواز</dt>
              <dd>
                <bdi>{entity.passport_number || "—"}</bdi>
                <small>{fmtDate(entity.passport_expiry)}</small>
              </dd>
            </div>
          </>
        )}
      </dl>
      {car && <Agreements entityId={entity.id} />}
    </section>
  );
}

function ExpenseRow({ expense }) {
  const { open } = useWallet();
  return (
    <div className="record-row">
      <div className="record-main">
        <strong>{expense.title}</strong>
        <p className="muted">
          {fmtDate(expense.paid_at)}
          {expense.note ? " · " + expense.note : ""}
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

function DataTable({ kind, records }) {
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
                      ? "عقار"
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
                  <td key={i}>{value}</td>
                ))}
                <td>
                  {row.entity ? (
                    <EntityActions entity={row.entity} />
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

export default function DataPage({ initialKind = "property" } = {}) {
  const { data, isAssistant, open } = useWallet();
  const [kind, setKind] = useState(initialKind),
    [search, setSearch] = useState(""),
    [mode, setMode] = useState("cards"),
    searchRef = useRef(null);
  const records = useMemo(
    () => selectDataRecords(data, kind, search),
    [data, kind, search],
  );
  const label = categories.find(([key]) => key === kind)[1];
  const clear = () => {
    setSearch("");
    searchRef.current?.focus();
  };
  return (
    <div className="stack data-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">أصولك واتفاقاتك</span>
          <h1 tabIndex={-1}>كل التفاصيل في مكانها</h1>
          <p className="muted">السجلات المرتبطة بالمحفظة، وتاريخها المالي.</p>
        </div>
      </header>
      <section className="data-toolbar">
        <div className="section-head">
          <div className="tabs" aria-label="نوع البيانات">
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
          </div>
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
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {search && (
            <Button variant="ghost" onClick={clear}>
              مسح البحث
            </Button>
          )}
          {isAssistant &&
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
                onClick={() => open("entityForm", { kind })}
              >
                إضافة {kindNames[kind]}
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
              : "ابدأ بإضافة أول سجل لهذا القسم."}
          {search && (
            <Button variant="secondary" onClick={clear}>
              عرض الكل
            </Button>
          )}
        </Empty>
      ) : mode === "table" ? (
        <DataTable kind={kind} records={records} />
      ) : kind === "property" ? (
        <div className="stack">
          {records.entities
            .filter((e) => e.kind === "property")
            .map((property) => (
              <PropertyCard
                key={property.id}
                property={property}
                units={records.entities.filter(
                  (e) => e.kind === "unit" && e.parent_id === property.id,
                )}
                search={search}
              />
            ))}
          {(records.entities.some((e) => e.kind === "unit" && !e.parent_id) ||
            isAssistant) && (
            <section className="panel">
              <div className="section-head">
                <h2>وحدات مستقلة</h2>
                {isAssistant && (
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
                  <UnitRow key={unit.id} unit={unit} />
                ))}
            </section>
          )}
        </div>
      ) : kind === "car" || kind === "worker" ? (
        <div className="asset-grid">
          {records.entities.map((entity) => (
            <AssetCard key={entity.id} entity={entity} />
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
