import React from "react";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  cleanup,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import DataPage from "../../frontend/pages/DataPage.jsx";
import OperationsDialogs from "../../frontend/features/OperationsDialogs.jsx";

const context = vi.hoisted(() => ({ value: null }));
vi.mock("../../frontend/state/WalletProvider.jsx", async (importOriginal) => ({
  ...(await importOriginal()),
  useWallet: () => context.value,
}));

function fixture() {
  return {
    month: "2026-10",
    today: "2026-10-16",
    user: { role: "manager", email: "manager@example.test" },
    entities: [
      {
        id: "property-1",
        kind: "property",
        name: "عمارة النخيل",
        location: "الرياض",
        version: 1,
      },
      {
        id: "unit-1",
        kind: "unit",
        name: "شقة ١٠١",
        parent_id: "property-1",
        status: "available",
        version: 1,
      },
      {
        id: "car-1",
        kind: "car",
        name: "السيارة",
        plate: "أ ب ج 123",
        version: 1,
      },
    ],
    archived_entities: [
      { id: "archive-1", kind: "car", name: "السيارة السابقة" },
    ],
    agreements: [
      {
        id: "rent-1",
        entity_id: "unit-1",
        kind: "rent",
        direction: "in",
        title: "إيجار شقة ١٠١",
        status: "active",
        start_date: "2026-01-01",
        end_date: "2026-12-31",
        first_due_date: "2026-01-01",
        total_cents: 3600000,
        installment_count: 12,
      },
      {
        id: "other-1",
        kind: "other",
        direction: "out",
        title: "اتفاق ١١٠",
        status: "active",
        total_cents: 110,
        installment_count: 1,
        first_due_date: "2026-10-16",
      },
      {
        id: "closed-1",
        entity_id: "archive-1",
        kind: "sale",
        direction: "in",
        title: "بيع سابق",
        status: "active",
        closed_at: "2026-10-05T21:30:00Z",
        total_cents: 50000,
      },
    ],
    payments: [
      {
        id: "payment-1",
        agreement_id: "closed-1",
        amount_cents: 50000,
        paid_at: "2026-10-05",
        created_at: "2026-10-05T12:00:00Z",
        active: 1,
      },
      {
        id: "old-payment",
        agreement_id: "rent-1",
        amount_cents: 120000,
        paid_at: "2026-09-30",
        active: 1,
      },
    ],
    expenses: [],
    dues: [],
    tasks: [],
    alerts: [],
    summary: {
      due_in: 300000,
      due_out: 260000,
      fulfilled_in: 120000,
      fulfilled_out: 0,
      remaining_in: 180000,
      remaining_out: 260000,
      cash_in: 50000,
      cash_out: 0,
      net: 50000,
    },
  };
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});
beforeEach(() => {
  context.value = {
    data: fixture(),
    month: "2026-10",
    isAssistant: false,
    loading: false,
    error: "",
    open: vi.fn(),
    close: vi.fn(),
    notify: vi.fn(),
    reload: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ saved: true, refreshed: true }),
    api: vi.fn(),
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete globalThis.mahfazatiPreview;
});

describe("React data workspace", () => {
  it("matches Arabic digits and preserves the matching unit under its parent in both views", async () => {
    const user = userEvent.setup();
    render(<DataPage />);
    await user.type(screen.getByRole("searchbox"), "101");
    expect(
      screen.getByRole("heading", { name: "عمارة النخيل" }),
    ).toBeInTheDocument();
    expect(screen.getByText("شقة ١٠١", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "عرض جدولي" }));
    const table = screen.getByRole("table");
    expect(
      within(table).getByText("شقة ١٠١", { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "تعديل" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "إضافة عقار" }),
    ).not.toBeInTheDocument();
  });
  it("finds other agreements by normalized digits and closed agreements by archived asset names", async () => {
    const user = userEvent.setup();
    render(<DataPage />);
    await user.click(screen.getByRole("button", { name: "أخرى", exact: true }));
    await user.type(screen.getByRole("searchbox"), "110");
    expect(screen.getByText("اتفاق ١١٠", { exact: true })).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "الاتفاقات المغلقة", exact: true }),
    );
    await user.type(screen.getByRole("searchbox"), "السيارة السابقة");
    expect(screen.getByText("بيع سابق", { exact: true })).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "التفاصيل", exact: true }),
    );
    expect(context.value.open).toHaveBeenLastCalledWith("agreementDetails", {
      id: "closed-1",
    });
  });
  it("gives the assistant an add-unit action with the correct property relationship", async () => {
    context.value.isAssistant = true;
    const user = userEvent.setup();
    render(<DataPage />);
    await user.click(
      screen.getByRole("button", { name: "إضافة وحدة", exact: true }),
    );
    expect(context.value.open).toHaveBeenLastCalledWith("entityForm", {
      kind: "unit",
      parent_id: "property-1",
    });
  });
});

describe("React operational dialogs", () => {
  it("renders dues separately from cash and includes closed historical movements with their archived asset names", () => {
    render(<OperationsDialogs dialog={{ type: "statement" }} />);
    const dueRow = screen.getByRole("row", { name: /إجمالي المستحق/ });
    expect(within(dueRow).getByText("3,000")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "النقد المنفذ خلال الشهر" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "الحركات المنفذة (1)" }),
    ).toBeInTheDocument();
    const transaction = screen.getByRole("row", { name: /بيع سابق/ });
    expect(within(transaction).getByText("500")).toBeInTheDocument();
    expect(
      within(transaction).getByText("السيارة السابقة"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("row", { name: /إيجار شقة/ }),
    ).not.toBeInTheDocument();
  });
  it("retains task input after an uncertain write and retries the exact payload through the taskForm alias", async () => {
    context.value.mutate.mockRejectedValueOnce(
      Object.assign(new Error("انقطع الاتصال"), { uncertain: true }),
    );
    const user = userEvent.setup();
    render(<OperationsDialogs dialog={{ type: "taskForm" }} />);
    await user.type(
      screen.getByLabelText("عنوان المهمة"),
      "متابعة عقد الإيجار",
    );
    await user.type(screen.getByLabelText("التفاصيل"), "تأكيد بيانات المستأجر");
    await user.click(screen.getByRole("button", { name: "حفظ المهمة" }));
    await waitFor(() =>
      expect(screen.getByLabelText("عنوان المهمة")).toBeDisabled(),
    );
    expect(context.value.close).not.toHaveBeenCalled();
    const first = context.value.mutate.mock.calls[0];
    await user.click(
      screen.getByRole("button", { name: "تأكيد نتيجة الإرسال" }),
    );
    await waitFor(() => expect(context.value.close).toHaveBeenCalledTimes(1));
    expect(context.value.mutate.mock.calls[1]).toEqual(first);
    expect(first).toEqual([
      "/api/tasks",
      {
        title: "متابعة عقد الإيجار",
        description: "تأكيد بيانات المستأجر",
        due_date: "2026-10-16",
      },
      "POST",
    ]);
  });
  it("uses PATCH and the current version for task completion without requiring financial write access", async () => {
    context.value.data.tasks = [
      { id: "task-1", title: "مهمة المدير", state: "open", version: 7 },
    ];
    const user = userEvent.setup();
    render(<OperationsDialogs dialog={{ type: "tasks" }} />);
    await user.click(screen.getByRole("button", { name: "تم التنفيذ" }));
    expect(context.value.mutate).toHaveBeenCalledWith(
      "/api/tasks/task-1",
      { state: "done", expected_version: 7 },
      "PATCH",
    );
  });
  it("keeps date filters on cursor pagination and blocks reversed date ranges", async () => {
    const first = {
        id: "entry-1",
        action: "إضافة مهمة",
        target_type: "task",
        actor: "assistant@example.test",
        created_at: "2026-10-16T10:00:00Z",
        after_json: '{"title":"الأولى"}',
      },
      second = { ...first, id: "entry-2", after_json: '{"title":"الثانية"}' };
    context.value.api
      .mockResolvedValueOnce({
        entries: [],
        next_cursor: null,
        has_more: false,
      })
      .mockResolvedValueOnce({
        entries: [first],
        next_cursor: "cursor-one",
        has_more: true,
      })
      .mockResolvedValueOnce({
        entries: [second],
        next_cursor: null,
        has_more: false,
      });
    const user = userEvent.setup();
    render(<OperationsDialogs dialog={{ type: "history" }} />);
    await waitFor(() => expect(context.value.api).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("من تاريخ"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(screen.getByLabelText("إلى تاريخ"), {
      target: { value: "2026-10-16" },
    });
    await user.click(screen.getByRole("button", { name: "تطبيق الفترة" }));
    await user.click(await screen.findByRole("button", { name: "عرض المزيد" }));
    await screen.findByText("الثانية", { selector: "p" });
    expect(context.value.api.mock.calls[2][0]).toBe(
      "/api/history?from=2026-10-01&to=2026-10-16&sort=newest&cursor=cursor-one",
    );
    expect(screen.getByText("الأولى", { selector: "p" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("من تاريخ"), {
      target: { value: "2026-10-20" },
    });
    await user.click(screen.getByRole("button", { name: "تطبيق الفترة" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية",
    );
    expect(context.value.api).toHaveBeenCalledTimes(3);
  });
});
