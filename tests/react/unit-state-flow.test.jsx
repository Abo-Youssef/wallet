import React from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { WalletProvider, useWallet } from "../../src/client/state/WalletProvider.jsx";
import DataPage from "../../src/client/pages/DataPage.jsx";
import FinancialDialogs from "../../src/client/features/FinancialDialogs.jsx";
import { currentSummary } from "../../src/shared/finance.mjs";

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function Harness() {
  const wallet = useWallet();
  return <>
    <DataPage />
    {wallet.dialog && <FinancialDialogs dialog={wallet.dialog} />}
  </>;
}

function setup() {
  const stored = {
    today: "2026-10-17", month: "2026-10",
    user: { role: "assistant", email: "assistant@example.test" },
    entities: [
      { id: "building", kind: "property", name: "عمارة المتابعة", version: 1 },
      { id: "unit", kind: "unit", parent_id: "building", name: "وحدة 1", status: "available", manual_status: "available", version: 1 },
    ],
    agreements: [], payments: [], expenses: [], tasks: [], alerts: [], archived_entities: [],
  };
  const snapshot = () => ({ ...structuredClone(stored), ...currentSummary(stored.agreements, stored.payments, stored.expenses, stored.month, stored.today) });
  const create = deferred(), vacate = deferred();
  const transport = vi.fn(async (path, method, body) => {
    if (path.startsWith("/api/bootstrap")) return snapshot();
    if (path === "/api/agreements" && method === "POST") {
      await create.promise;
      stored.agreements.push({
        ...body, id: "rent", status: "active", direction: "in", version: 1,
        total_cents: 100000, opening_cents: 0,
        installment_count: Number(body.count), frequency_months: Number(body.frequency),
      });
      stored.payments.push({id:'paid',agreement_id:'rent',active:1,amount_cents:20000,slot_index:0,paid_at:stored.today,created_at:stored.today});
      return { id: "rent" };
    }
    if (path === "/api/agreements/rent/vacate" && method === "POST") {
      await vacate.promise;
      Object.assign(stored.agreements[0],{vacated_on:body.vacated_on,vacated_at:stored.today+'T09:00:00.000Z',vacated_by:'assistant@example.test'});
      stored.agreements[0].version += 1;
      return { ok: true };
    }
    throw new Error(`Unexpected request: ${method} ${path}`);
  });
  render(<WalletProvider initialData={snapshot()} transport={transport}><Harness /></WalletProvider>);
  return { transport, create, vacate, stored };
}

const unitRow = () => screen.getByText("وحدة 1", { selector: "strong" }).closest(".unit-record");

async function enterRental(user) {
  await user.click(screen.getByText("الوحدات والعقود"));
  await user.click(within(unitRow()).getByRole("button", { name: "تأجير", exact: true }));
  fireEvent.change(screen.getByLabelText("اسم المستأجر"), { target: { value: "مستأجر الاختبار" } });
  fireEvent.change(screen.getByLabelText("نهاية العقد"), { target: { value: "2026-11-16" } });
  fireEvent.change(screen.getByLabelText("إجمالي قيمة العقد (ر.س)"), { target: { value: "1000" } });
}

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("unit occupancy follows confirmed writes and automatic refreshed snapshots", () => {
  it("releases possession only after confirming and saving vacancy while retaining receipts and the collectible debt", async () => {
    const user = userEvent.setup();
    const { transport, create, vacate, stored } = setup();
    await enterRental(user);
    expect(within(unitRow()).getByText("متاحة", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "حفظ عقد الإيجار" }));
    expect(transport.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
    expect(within(unitRow()).getByText("متاحة", { exact: true })).toBeInTheDocument();
    expect(transport.mock.calls.filter(([path]) => path.startsWith("/api/bootstrap"))).toHaveLength(0);
    await act(async () => create.resolve());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(unitRow()).getByText("مؤجرة", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("1 مؤجرة")).toBeInTheDocument();

    await user.click(within(unitRow()).getByText(/العقود والعمليات/));
    const agreementRow = screen.getByText("إيجار وحدة 1", { selector: "strong" }).closest(".record-row");
    await user.click(within(agreementRow).getByRole("button", { name: "التفاصيل" }));
    expect(screen.queryByRole('button',{name:'إلغاء الجدول'})).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تأكيد الإخلاء / إنهاء الإيجار" }));
    expect(within(unitRow()).getByText("مؤجرة", { exact: true })).toBeInTheDocument();
    expect(screen.getByText('800')).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "حفظ الإخلاء" }));
    expect(transport.mock.calls.filter(([path]) => path.endsWith('/vacate'))).toHaveLength(0);
    await user.click(screen.getByRole('checkbox',{name:'أؤكد إخلاء الوحدة مع حفظ التحصيل والمديونية'}));
    await user.click(screen.getByRole("button", { name: "حفظ الإخلاء" }));
    expect(within(unitRow()).getByText("مؤجرة", { exact: true })).toBeInTheDocument();
    await act(async () => vacate.resolve());
    await screen.findByText(/تم تأكيد الإخلاء بتاريخ/);
    expect(within(unitRow()).getByText("متاحة", { exact: true })).toBeInTheDocument();
    expect(screen.getByText("1 متاحة")).toBeInTheDocument();
    expect(stored.payments[0].amount_cents).toBe(20000);
    expect(stored.agreements[0].total_cents).toBe(100000);
    expect(screen.getByRole('button',{name:'تسجيل تحصيل'})).toBeInTheDocument();
    expect(transport.mock.calls.find(([path])=>path.endsWith('/vacate'))[2]).toMatchObject({confirm_vacancy:true,vacated_on:'2026-10-17'});
    expect(transport.mock.calls.filter(([path]) => path.startsWith("/api/bootstrap"))).toHaveLength(2);
  });

  it('keeps an occupied unit and its debt unchanged when saving vacancy fails',async()=>{
    const user=userEvent.setup();const {create,vacate,stored}=setup();
    await enterRental(user);await user.click(screen.getByRole('button',{name:'حفظ عقد الإيجار'}));
    await act(async()=>create.resolve());await waitFor(()=>expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await user.click(within(unitRow()).getByText(/العقود والعمليات/));
    const row=screen.getByText('إيجار وحدة 1',{selector:'strong'}).closest('.record-row');
    await user.click(within(row).getByRole('button',{name:'التفاصيل'}));
    await user.click(screen.getByRole('button',{name:'تأكيد الإخلاء / إنهاء الإيجار'}));
    await user.click(screen.getByRole('checkbox',{name:'أؤكد إخلاء الوحدة مع حفظ التحصيل والمديونية'}));
    await user.click(screen.getByRole('button',{name:'حفظ الإخلاء'}));
    await act(async()=>vacate.reject(Object.assign(new Error('تغير العقد؛ حدث البيانات'),{code:409})));
    expect(screen.getByRole('alert')).toHaveTextContent('تغير العقد');
    expect(within(unitRow()).getByText('مؤجرة',{exact:true})).toBeInTheDocument();
    expect(stored.agreements[0].vacated_at).toBeUndefined();expect(stored.payments[0].amount_cents).toBe(20000);
  });

  it("keeps the unit available when the save is rejected, with no optimistic rental state", async () => {
    const user = userEvent.setup();
    const { transport, create } = setup();
    await enterRental(user);
    await user.click(screen.getByRole("button", { name: "حفظ عقد الإيجار" }));
    await act(async () => create.reject(Object.assign(new Error("تعارض في فترة العقد"), { code: 409 })));
    expect(screen.getByRole("alert")).toHaveTextContent("تعارض في فترة العقد");
    expect(within(unitRow()).getByText("متاحة", { exact: true })).toBeInTheDocument();
    expect(within(unitRow()).queryByText("مؤجرة", { exact: true })).not.toBeInTheDocument();
    expect(transport.mock.calls.filter(([path]) => path.startsWith("/api/bootstrap"))).toHaveLength(0);
  });
});
