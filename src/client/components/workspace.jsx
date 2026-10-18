import React from "react";
import {
  ArrowLeft,
  Building2,
  Car,
  CalendarDays,
  Receipt,
  ChevronLeft,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { useWallet } from "../state/WalletProvider.jsx";
import { Button, Money, Badge } from "./ui.jsx";
import { entityById, fmtDate, monthName } from "../lib/format.js";
import { normalizeDigits } from "../../shared/numerals.mjs";
import LocalizedInput from "./LocalizedInput.jsx";
export function MonthTools() {
  const { month, reload, open, loading, error } = useWallet();
  return (
    <div className="month-tools">
      <label className="month-picker">
        <CalendarDays size={19} />
        <span>{monthName(month)}</span>
        <LocalizedInput
          aria-label="اختيار الشهر"
          type="month"
          lang="en-GB"
          dir="ltr"
          value={month}
          min="1000-01"
          max="9999-12"
          onChange={(event) => {
            if (/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(event.target.value))
              reload(event.target.value);
          }}
        />
      </label>
      <Button
        variant="ghost"
        disabled={loading || Boolean(error)}
        onClick={() => open("statement")}
      >
        <Receipt size={18} />
        كشف الشهر
      </Button>
    </div>
  );
}
export function PageHeading({ title, subtitle, children }) {
  return (
    <div className="page-heading">
      <div>
        <h1 tabIndex={-1}>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function DueRow({ due, selected = false, onSelect, compact = false }) {
  const { data, canManageData, open, loading, error } = useWallet(),
    entity = entityById(data, due.entity_id),
    Icon =
      entity?.kind === "car" ? Car : due.kind === "rent" ? Building2 : Receipt;
  return (
    <div
      className={`due-row ${due.status === "متأخر" ? "overdue" : ""} ${selected ? "selected" : ""} ${compact ? "compact" : ""}`}
    >
      <button
        className="due-main"
        onClick={() =>
          onSelect && window.matchMedia("(min-width:1100px)").matches
            ? onSelect()
            : open("agreementDetails", { id: due.agreement_id })
        }
        aria-label={`تفاصيل ${normalizeDigits(due.title)}`}
        aria-pressed={onSelect ? selected : undefined}
      >
        <span className="record-icon">
          <Icon size={23} />
        </span>
        <span className="due-title">
          <strong>{normalizeDigits(due.title)}</strong>
          <small>
            {normalizeDigits(entity?.name || "أخرى")} ·{" "}
            {due.direction === "in" ? "تحصيل" : "سداد"}
          </small>
        </span>
      </button>
      <div className="due-amount">
        <Money value={due.amount_cents} />
        <Badge>{due.status}</Badge>
      </div>
      <div className="due-date">
        <span>{fmtDate(due.due_date)}</span>
        <small>
          {due.due_date < data.today
            ? `متأخر ${Math.round((new Date(data.today) - new Date(due.due_date)) / 86400000)} يومًا`
            : due.due_date === data.today
              ? "مستحق اليوم"
              : `باقي ${Math.round((new Date(due.due_date) - new Date(data.today)) / 86400000)} يومًا`}
        </small>
      </div>
      {canManageData ? (
        <Button
          variant={due.status === "متأخر" ? "primary" : "secondary"}
          disabled={loading || Boolean(error)}
          onClick={() =>
            open("payConfirm", { id: `${due.agreement_id}::${due.slot}` })
          }
        >
          {due.direction === "in" ? "تسجيل تحصيل" : "تسجيل سداد"}
        </Button>
      ) : (
        <button
          className="icon-button due-arrow"
          aria-label={`فتح ${normalizeDigits(due.title)}`}
          onClick={() => open("agreementDetails", { id: due.agreement_id })}
        >
          <ChevronLeft size={20} />
        </button>
      )}
    </div>
  );
}
export function TaskRow({ task }) {
  const { open, canManageData } = useWallet();
  const Element = canManageData ? "button" : "div";
  return (
    <Element
      className="task-row"
      onClick={canManageData ? () => open("taskToggle", { id: task.id }) : undefined}
    >
      <span className={`task-check ${task.state === "done" ? "checked" : ""}`}>
        {task.state === "done" ? "✓" : ""}
      </span>
      <span>
        <strong>{normalizeDigits(task.title)}</strong>
        <small>
          {normalizeDigits(task.description || "مهمة متابعة")}
          {task.due_date ? " · " + fmtDate(task.due_date) : ""}
        </small>
      </span>
      {canManageData && <ChevronLeft size={18} />}
    </Element>
  );
}
