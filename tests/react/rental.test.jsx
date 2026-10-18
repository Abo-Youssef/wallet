import React from "react";
import { beforeAll, afterEach, describe, it, expect, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FinancialDialogs from "../../src/client/features/FinancialDialogs.jsx";
import { WalletProvider, useWallet } from "../../src/client/state/WalletProvider.jsx";

const base = () => ({
  today: "2026-10-17", month: "2026-10", user: { role: "manager", email: "manager@example.test" },
  entities: [{ id: "property", kind: "property", name: "عمارة الروضة", version: 1 }],
  agreements: [], payments: [], archived_entities: [], expenses: [], dues: [], tasks: [], alerts: [],
});
function Harness() {
  const wallet = useWallet();
  return <><button onClick={() => wallet.setManagerAssistantMode(true)}>وضع المساعد</button><button onClick={() => wallet.open("rentalStart", { entity_id: "property" })}>بدء التأجير</button><output data-testid="units">{wallet.data.entities.filter((entity) => entity.kind === "unit").length}</output>{wallet.dialog && <FinancialDialogs key={JSON.stringify(wallet.dialog)} dialog={wallet.dialog} />}</>;
}
function setup(initial = base(), failRefresh = false) {
  let stored = structuredClone(initial);
  const transport = vi.fn(async (path, method, body) => {
    if (method === "POST" && path === "/api/entities") {
      stored.entities.push({ id: "saved-unit", ...body, version: 1 });
      return { id: "saved-unit" };
    }
    if (method === "POST" && path === "/api/agreements") return { id: "saved-rent" };
    if (path.startsWith("/api/bootstrap")) {
      if (failRefresh) throw new Error("refresh unavailable");
      return structuredClone(stored);
    }
    throw new Error("Unexpected request: " + path);
  });
  render(<WalletProvider initialData={initial} transport={transport}><Harness /></WalletProvider>);
  fireEvent.click(screen.getByText("وضع المساعد"));
  return { transport, stored };
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("property-first rental workflow", () => {
  it("lets a manager save a named unit once then a tenant contract with an exact installment preview", async () => {
    const user = userEvent.setup();
    const { transport } = setup();
    await user.click(screen.getByText("بدء التأجير"));
    await user.click(screen.getByRole("button", { name: "إضافة وحدة للتأجير" }));
    await user.type(screen.getByLabelText("اسم الوحدة"), "شقة 1");
    await user.click(screen.getByRole("button", { name: "حفظ الوحدة ومتابعة التأجير" }));
    expect(await screen.findByLabelText("اسم المستأجر")).toBeRequired();
    expect(screen.getByTestId("units")).toHaveTextContent("1");
    await user.type(screen.getByLabelText("اسم المستأجر"), "أحمد محمد");
    await user.type(screen.getByLabelText("رقم التواصل"), "0501234567");
    await user.type(screen.getByLabelText("نهاية العقد"), "2027-10-16");
    await user.type(screen.getByLabelText("إجمالي قيمة العقد (ر.س)"), "12000");
    await user.clear(screen.getByLabelText("عدد الدفعات"));
    await user.type(screen.getByLabelText("عدد الدفعات"), "12");
    expect(screen.getAllByText("1,000")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "حفظ عقد الإيجار" }));
    await waitFor(() => expect(transport.mock.calls.filter(([path, method]) => path === "/api/agreements" && method === "POST")).toHaveLength(1));
    expect(transport.mock.calls.find(([path]) => path === "/api/agreements")[2]).toMatchObject({ entity_id: "saved-unit", kind: "rent", counterparty: "أحمد محمد", total: "12000", count: "12", opening: "0", frequency: "1", first_due_date: "2026-10-17" });
    expect(transport.mock.calls.filter(([path, method]) => path === "/api/entities" && method === "POST")).toHaveLength(1);
  });

  it("preselects a single existing unit without saving a duplicate and can cancel without a contract", async () => {
    const initial = base();
    initial.entities.push({ id: "existing", kind: "unit", parent_id: "property", name: "شقة 2", status: "available" });
    const { transport } = setup(initial);
    const user = userEvent.setup();
    await user.click(screen.getByText("بدء التأجير"));
    expect(screen.getByRole("heading", { name: "تأجير · شقة 2" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "إلغاء", exact: true }));
    expect(transport).not.toHaveBeenCalled();
    expect(screen.getByTestId("units")).toHaveTextContent("1");
  });

  it("keeps a newly saved unit when the tenant step is cancelled", async () => {
    const user = userEvent.setup();
    const { transport } = setup();
    await user.click(screen.getByText("بدء التأجير"));
    await user.click(screen.getByRole("button", { name: "إضافة وحدة للتأجير" }));
    await user.type(screen.getByLabelText("اسم الوحدة"), "محل 1");
    await user.click(screen.getByRole("button", { name: "حفظ الوحدة ومتابعة التأجير" }));
    await screen.findByLabelText("اسم المستأجر");
    await user.click(screen.getByRole("button", { name: "إلغاء", exact: true }));
    expect(screen.getByTestId("units")).toHaveTextContent("1");
    expect(transport.mock.calls.filter(([path]) => path === "/api/agreements")).toHaveLength(0);
  });

  it("does not advance into a rental against stale data after the unit saved but refresh failed", async () => {
    const user = userEvent.setup();
    const { transport, stored } = setup(base(), true);
    await user.click(screen.getByText("بدء التأجير"));
    await user.click(screen.getByRole("button", { name: "إضافة وحدة للتأجير" }));
    await user.type(screen.getByLabelText("اسم الوحدة"), "فيلا 1");
    await user.click(screen.getByRole("button", { name: "حفظ الوحدة ومتابعة التأجير" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("اسم المستأجر")).not.toBeInTheDocument();
    expect(stored.entities.filter((entity) => entity.kind === "unit")).toHaveLength(1);
    expect(transport.mock.calls.filter(([, method]) => method === "POST")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("تم الحفظ. تعذر تحديث العرض");
  });

  it("shows existing rental dates before entering another contract", async () => {
    const initial = base();
    initial.entities.push({ id: "existing", kind: "unit", parent_id: "property", name: "شقة 2" });
    initial.agreements.push({ id: "rent-old", entity_id: "existing", kind: "rent", status: "active", counterparty: "مستأجر حالي", start_date: "2026-01-01", end_date: "2026-12-31" });
    setup(initial);
    await userEvent.setup().click(screen.getByText("بدء التأجير"));
    expect(screen.getByText(/مستأجر حالي/)).toBeInTheDocument();
    expect(screen.getByText(/اختر فترة جديدة لا تتداخل معها/)).toBeInTheDocument();
  });

  it.each(["maintenance", "personal_use", "unavailable"])("does not offer rental entry for a unit in %s", async (status) => {
    const initial = base();
    initial.entities.push({ id: "blocked-unit", kind: "unit", parent_id: "property", name: "شقة 2", status });
    const { transport } = setup(initial);
    await userEvent.setup().click(screen.getByText("بدء التأجير"));
    expect(screen.getByRole("button", { name: "تأجير شقة 2", exact: true })).toBeDisabled();
    expect(screen.queryByLabelText("اسم المستأجر")).not.toBeInTheDocument();
    expect(transport).not.toHaveBeenCalled();
  });

  it("follows the contract start date until the user explicitly chooses a first payment date", async () => {
    const initial = base();
    initial.entities.push({ id: "existing", kind: "unit", parent_id: "property", name: "شقة 2" });
    setup(initial);
    await userEvent.setup().click(screen.getByText("بدء التأجير"));
    fireEvent.change(screen.getByLabelText("بداية العقد"), { target: { value: "2026-11-01" } });
    expect(screen.getByLabelText("موعد أول دفعة")).toHaveValue("2026-11-01");
    fireEvent.change(screen.getByLabelText("موعد أول دفعة"), { target: { value: "2026-11-05" } });
    fireEvent.change(screen.getByLabelText("بداية العقد"), { target: { value: "2026-11-02" } });
    expect(screen.getByLabelText("موعد أول دفعة")).toHaveValue("2026-11-05");
  });
});
