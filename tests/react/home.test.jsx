import React from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import App from "../../src/client/App.jsx";
import { WalletProvider } from "../../src/client/state/WalletProvider.jsx";
import { currentSummary } from "../../src/shared/finance.mjs";

function fixture(role = "assistant") {
  const today = "2026-10-18", month = "2026-10";
  const agreements = [{ id: "rent", title: "إيجار الوحدة 12", direction: "in", kind: "rent", entity_id: "unit",
    status: "active", start_date: "2026-09-01", end_date: "2026-09-30", first_due_date: today,
    total_cents: 250000, opening_cents: 0, installment_count: 1, frequency_months: 1, version: 2 },
    { id: "late", title: "قسط متأخر", direction: "out", kind: "purchase", status: "active", first_due_date: "2026-10-15", total_cents: 100000, opening_cents: 0, installment_count: 1, frequency_months: 1, version: 1 }];
  return { user: { role, email: "account@example.test" }, today, month, agreements, payments: [], expenses: [], archived_entities: [],
    entities: [{ id: "unit", kind: "unit", name: "وحدة ١٢", parent_id: "property" }, { id: "property", kind: "property", name: "عمارة الاختبار" },
      { id: "blocked", kind: "unit", name: "وحدة 13", manual_status: "unavailable" }, { id: "available", kind: "unit", name: "وحدة 14" }],
    tasks: [{ id: "today-task", title: "مراجعة اليوم", due_date: today, state: "open", version: 1 },
      { id: "next-task", title: "موعد بعد أسبوع", due_date: "2026-10-25", state: "open", version: 1 },
      { id: "done-task", title: "مهمة منجزة", due_date: today, state: "done", version: 1 }],
    alerts: [{ key: "rent:rent:2026-12-30", title: "تجديد سنوي مبكر", due_date: "2026-12-30", source: "إيجار" }],
    ...currentSummary(agreements, [], [], month, today) };
}
beforeAll(() => {
  window.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
function setup(data = fixture(), transport = vi.fn()) {
  return { ...render(<WalletProvider initialData={data} transport={transport}><App /></WalletProvider>), transport };
}

describe("approved home dashboards preserve operations", () => {
  it("shows manager financial overview without follow-up, and does not release expired occupied units", () => {
    setup(fixture("manager"));
    expect(screen.getByRole("heading", { name: "نظرة عامة" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "تحتاج متابعة" })).not.toBeInTheDocument();
    const ring = screen.getByRole("img", { name: /3 وحدة:/ });
    expect(ring).toHaveAccessibleName(/1 مؤجرة، 1 متاحة، 0 صيانة، 0 استخدام شخصي، 1 غير متاحة/);
    expect(screen.queryByRole("button", { name: "تحصيل", exact: true })).not.toBeInTheDocument();
  });
  it("keeps today, overdue, next seven days and early annual reminders reachable", () => {
    setup();
    expect(within(screen.getByRole("region", { name: "مهام اليوم" })).getByText("إيجار الوحدة 12")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "تحتاج متابعة" })).getByText("قسط متأخر")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "المهام القادمة" })).getByText("موعد بعد أسبوع")).toBeInTheDocument();
    expect(screen.queryByText("مهمة منجزة")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/مواعيد لاحقة وتنبيهات مبكرة/));
    expect(screen.getByText("تجديد سنوي مبكر")).toBeVisible();
    fireEvent.change(screen.getByRole("searchbox", { name: "البحث في المهام" }), { target: { value: "وحدة ١٢" } });
    expect(screen.getByText("إيجار الوحدة 12")).toBeInTheDocument();
    expect(screen.queryByText("قسط متأخر")).not.toBeInTheDocument();
  });
  it("opens the existing collection review, and only writes after explicit save confirmation", async () => {
    const data = fixture();
    const transport = vi.fn((path, method) => Promise.resolve(method === "POST" ? { ok: true } : data));
    setup(data, transport);
    fireEvent.click(within(screen.getByRole("region", { name: "مهام اليوم" })).getByRole("button", { name: "تحصيل", exact: true }));
    const dialog = screen.getByRole("dialog", { name: "تأكيد التحصيل" });
    expect(within(dialog).getByLabelText("المبلغ الفعلي (ر.س)")).toHaveValue("2500.00");
    expect(transport).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "تم التحصيل" }));
    expect(within(dialog).getByRole("region", { name: "مراجعة الحركة قبل الحفظ" })).toBeInTheDocument();
    expect(transport).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "حفظ وتأكيد" }));
    await waitFor(() => expect(transport).toHaveBeenCalled());
    expect(transport.mock.calls[0][0]).toBe("/api/agreements/rent/payments");
    expect(transport.mock.calls[0][2]).toMatchObject({ amount: "2500.00", slot: 0, expected_version: 2 });
  });
  it("disables collection while refreshing and after a refresh failure", async () => {
    let reject;
    const transport = vi.fn(() => new Promise((_, no) => { reject = no; }));
    setup(fixture(), transport);
    fireEvent.click(screen.getByRole("button", { name: /تحديث البيانات/ }));
    expect(within(screen.getByRole("region", { name: "مهام اليوم" })).getByRole("button", { name: "تحصيل", exact: true })).toBeDisabled();
    reject(new Error("تعذر الاتصال التجريبي"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("تعذر الاتصال التجريبي"));
    expect(within(screen.getByRole("region", { name: "مهام اليوم" })).getByRole("button", { name: "تحصيل", exact: true })).toBeDisabled();
    expect(transport).toHaveBeenCalledTimes(1);
  });
});
