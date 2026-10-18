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
import DataPage from "../../src/client/pages/DataPage.jsx";
import OperationsDialogs from "../../src/client/features/OperationsDialogs.jsx";

const context = vi.hoisted(() => ({ value: null }));
vi.mock("../../src/client/state/WalletProvider.jsx", async (importOriginal) => ({
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
    canManageData: true,
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
  delete globalThis.walletPreview;
});

describe("React data workspace", () => {
  it("filters the three property sections with their own units, retains legacy records, and prefills the add action", async () => {
    const user=userEvent.setup();
    context.value.data.entities.push(
      {id:'house',kind:'property',property_type:'house',name:'بيت العائلة'},
      {id:'house-unit',kind:'unit',parent_id:'house',name:'مساحة البيت'},
      {id:'rest',kind:'property',property_type:'rest_house',name:'استراحة الواحة'},
      {id:'building',kind:'property',property_type:'building',name:'عمارة الروضة'},
    );
    render(<DataPage />);
    await user.click(screen.getByRole('button',{name:'بيوت 1'}));
    expect(screen.getByRole('button',{name:'بيوت 1'})).toHaveAttribute('aria-pressed','true');
    expect(screen.getByText('بيت العائلة',{exact:true})).toBeInTheDocument();
    expect(screen.getByText('مساحة البيت',{exact:true})).toBeInTheDocument();
    expect(screen.queryByText('استراحة الواحة',{exact:true})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'إضافة بيت'}));
    expect(context.value.open).toHaveBeenCalledWith('entityForm',{kind:'property',property_type:'house'});
    await user.type(screen.getByRole('searchbox'),'مساحة البيت');
    expect(screen.getByText('بيت العائلة',{exact:true})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'عرض جدولي'}));
    expect(screen.getByText('مساحة البيت',{exact:true})).toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'مسح البحث'}));
    await user.click(screen.getByRole('button',{name:'غير مصنف 1'}));
    expect(screen.getAllByText('عمارة النخيل',{exact:true}).length).toBeGreaterThan(0);
    expect(screen.queryByText('بيت العائلة',{exact:true})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'استراحات 1'}));
    expect(screen.getByText('استراحة الواحة',{exact:true})).toBeInTheDocument();
  });
  it("keeps classifications readable in manager mode and offers no write actions", async () => {
    context.value.canManageData=false;
    const user=userEvent.setup();
    render(<DataPage />);
    expect(screen.queryByRole('button',{name:'تحديد النوع'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('button',{name:'استراحات 0'}));
    expect(screen.queryByRole('button',{name:'إضافة استراحة'})).not.toBeInTheDocument();
    expect(screen.getByRole('button',{name:'كل الأصول'})).toBeInTheDocument();
  });
  it("offers the manager a direct rental action from the property record", async () => {
    const user = userEvent.setup();
    render(<DataPage />);
    const propertyHeader = screen.getByRole("heading", { name: "عمارة النخيل" }).closest(".section-head");
    await user.click(within(propertyHeader).getByRole("button", { name: "تأجير", exact: true }));
    expect(context.value.open).toHaveBeenCalledWith("rentalStart", { entity_id: "property-1" });
    expect(screen.getByRole("button", { name: "إضافة عقار" })).toBeInTheDocument();
  });
  it("reveals linked contracts when a search matches a rental title", async () => {
    const user = userEvent.setup();
    render(<DataPage />);
    await user.type(screen.getByRole("searchbox"), "إيجار شقة");
    const agreement = screen.getByText("إيجار شقة 101", { exact: true });
    expect(agreement.closest("details")).toHaveAttribute("open");
    expect(agreement.closest(".property-units")).toHaveAttribute("open");
  });
  it("matches Arabic digits and preserves the matching unit under its parent in both views", async () => {
    const user = userEvent.setup();
    render(<DataPage />);
    await user.type(screen.getByRole("searchbox"), "101");
    expect(
      screen.getByRole("heading", { name: "عمارة النخيل" }),
    ).toBeInTheDocument();
    expect(screen.getByText("شقة 101", { exact: true })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "عرض جدولي" }));
    const table = screen.getByRole("table");
    expect(
      within(table).getByText("شقة 101", { exact: true }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "تعديل" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "إضافة عقار" }),
    ).toBeInTheDocument();
  });
  it("finds other agreements by normalized digits and closed agreements by archived asset names", async () => {
    const user = userEvent.setup();
    render(<DataPage />);
    await user.click(screen.getByRole("button", { name: "أخرى", exact: true }));
    await user.type(screen.getByRole("searchbox"), "110");
    expect(screen.getByText("اتفاق 110", { exact: true })).toBeInTheDocument();
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
    await user.click(screen.getByText("الوحدات والعقود"));
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
  it("allows a manager to read tasks while hiding task mutations in view-only mode", () => {
    context.value.canManageData = false;
    context.value.data.tasks = [{ id: "task-1", title: "مراجعة العقد", state: "open", version: 1 }];
    const view = render(<OperationsDialogs dialog={{ type: "tasks" }} />);
    expect(screen.getByText("مراجعة العقد")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تم التنفيذ" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "مهمة للمساعد" })).not.toBeInTheDocument();
    view.rerender(<OperationsDialogs dialog={{ type: "taskToggle", id: "task-1" }} />);
    expect(screen.getByRole("heading", { name: "عرض فقط" })).toBeInTheDocument();
    view.rerender(<OperationsDialogs dialog={{ type: "taskForm" }} />);
    expect(screen.queryByLabelText("عنوان المهمة")).not.toBeInTheDocument();
    expect(context.value.mutate).not.toHaveBeenCalled();
  });
  it("shows alerts without dismissal controls to a read-only manager", () => {
    context.value.canManageData = false;
    context.value.data.alerts = [{ key: "insurance:car-1", title: "تأمين السيارة", source: "سيارة", due_date: "2026-10-20" }];
    render(<OperationsDialogs dialog={{ type: "alerts" }} />);
    expect(screen.getByText("تأمين السيارة")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "تمت المتابعة" })).not.toBeInTheDocument();
  });
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
