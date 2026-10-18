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
  cleanup,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import FinancialDialogs from "../../src/client/features/FinancialDialogs.jsx";
import { useWallet } from "../../src/client/state/WalletProvider.jsx";
import { project } from "../../src/shared/finance.mjs";
import { fmtDate } from "../../src/client/lib/format.js";

vi.mock("../../src/client/state/WalletProvider.jsx", async (importOriginal) => ({
  ...(await importOriginal()),
  useWallet: vi.fn(),
}));

let wallet;
function fixture() {
  return {
    today: "2026-10-15",
    month: "2026-10",
    user: { role: "assistant", email: "assistant@example.test" },
    entities: [{ id: "car", kind: "car", name: "سيارة الاختبار", version: 3 }],
    archived_entities: [],
    expenses: [],
    agreements: [
      {
        id: "agreement",
        kind: "other",
        title: "اختبار الهللات",
        status: "active",
        direction: "out",
        entity_id: null,
        total_cents: 110,
        opening_cents: 0,
        installment_count: 1,
        frequency_months: 1,
        first_due_date: "2026-10-15",
        note: "",
        version: 7,
      },
    ],
    dues: [
      {
        agreement_id: "agreement",
        slot: 0,
        amount_cents: 110,
        due_date: "2026-10-15",
        direction: "out",
        status: "اليوم",
      },
    ],
    payments: [],
    payment_contexts: {},
  };
}
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
beforeEach(() => {
  wallet = {
    data: fixture(),
    isAssistant: true,
    canManageData: true,
    open: vi.fn(),
    close: vi.fn(),
    notify: vi.fn(),
    reload: vi.fn(),
    mutate: vi.fn().mockResolvedValue({ saved: true, refreshed: true }),
  };
  vi.mocked(useWallet).mockImplementation(() => wallet);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("React financial dialogs preserve financial behavior", () => {
  it("requires a type for a new property and saves the section's preselected type",async()=>{
    const user=userEvent.setup();
    render(<FinancialDialogs dialog={{type:'entityForm',kind:'property',property_type:'rest_house'}} />);
    expect(screen.getByLabelText('نوع العقار')).toBeRequired();
    expect(screen.getByLabelText('نوع العقار')).toHaveValue('rest_house');
    await user.type(screen.getByLabelText('اسم عقار'),'استراحة اختبار');
    await user.type(screen.getByLabelText('رقم عداد الكهرباء'),'000123');
    await user.click(screen.getByRole('button',{name:'حفظ',exact:true}));
    expect(wallet.mutate.mock.calls[0][1]).toMatchObject({kind:'property',property_type:'rest_house',electricity_meter:'000123'});
  });
  it("can classify an existing property while retaining its name and optimistic version",async()=>{
    wallet.data.entities.push({id:'legacy-property',kind:'property',name:'بيت قديم',version:4});
    const user=userEvent.setup();
    render(<FinancialDialogs dialog={{type:'entityForm',id:'legacy-property'}} />);
    expect(screen.getByLabelText('نوع العقار')).toHaveValue('');
    await user.selectOptions(screen.getByLabelText('نوع العقار'),'house');
    await user.click(screen.getByRole('button',{name:'حفظ',exact:true}));
    expect(wallet.mutate.mock.calls[0][0]).toBe('/api/entities/legacy-property');
    expect(wallet.mutate.mock.calls[0][1]).toMatchObject({name:'بيت قديم',property_type:'house',expected_version:4});
  });
  it("requires explicit schedule-end confirmation for a partial receipt and preserves rental dates", async () => {
    const user = userEvent.setup();
    Object.assign(wallet.data.agreements[0], { kind: "rent", direction: "in", total_cents: 300000, installment_count: 3, start_date: "2026-10-01", end_date: "2026-12-31" });
    Object.assign(wallet.data.dues[0], { amount_cents: 100000, direction: "in" });
    render(<FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />);
    await user.clear(screen.getByLabelText("المبلغ الفعلي (ر.س)"));
    await user.type(screen.getByLabelText("المبلغ الفعلي (ر.س)"), "٥٠٠");
    expect(screen.getByLabelText("تاريخ نهاية الدفعات")).toBeRequired();
    await user.click(screen.getByRole("button", { name: "تم التحصيل" }));
    expect(screen.queryByRole("button", { name: "حفظ وتأكيد" })).not.toBeInTheDocument();
    expect(wallet.mutate).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("تاريخ نهاية الدفعات"), "2026-12-15");
    await user.click(screen.getByRole("button", { name: "تم التحصيل" }));
    expect(screen.getByText("2,500")).toBeInTheDocument();
    expect(screen.getByText(/فترة عقد الإيجار تبقى كما هي/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.mutate.mock.calls[0][1]).toMatchObject({ amount: "500", schedule_end_date: "2026-12-15", reschedule_method: null });
    expect(wallet.mutate.mock.calls[0][1]).not.toHaveProperty("end_date");
    expect(wallet.mutate.mock.calls[0][1]).not.toHaveProperty("start_date");
  });
  it("recomputes the explicit end-date choice when switching excess payment distribution", async () => {
    const user = userEvent.setup();
    Object.assign(wallet.data.agreements[0], { total_cents: 400000, installment_count: 4 });
    wallet.data.dues[0].amount_cents = 100000;
    render(<FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />);
    await user.clear(screen.getByLabelText("المبلغ الفعلي (ر.س)"));
    await user.type(screen.getByLabelText("المبلغ الفعلي (ر.س)"), "2000");
    await user.click(screen.getByLabelText("تقليل المدة"));
    await user.selectOptions(screen.getByLabelText("تاريخ نهاية الدفعات"), "2026-12-15");
    await user.click(screen.getByLabelText("تقليل قيمة الأقساط"));
    expect(screen.getByLabelText("تاريخ نهاية الدفعات")).toHaveValue("");
    await user.selectOptions(screen.getByLabelText("تاريخ نهاية الدفعات"), "2027-01-15");
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    await user.click(screen.getByRole("button", { name: "تعديل البيانات" }));
    expect(screen.getByLabelText("المبلغ الفعلي (ر.س)")).toHaveValue("2000");
    expect(wallet.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.mutate.mock.calls[0][1]).toMatchObject({ reschedule_method: "spread", schedule_end_date: "2027-01-15" });
  });
  it("keeps rental occupancy automatic while editing manual unit restrictions", async () => {
    wallet.data.entities.push({ id: "unit", name: "وحدة", kind: "unit", status: "rented", manual_status: "available", version: 1 });
    render(<FinancialDialogs dialog={{ type: "entityForm", id: "unit" }} />);
    expect(screen.getByLabelText("حالة الوحدة")).toHaveValue("available");
    expect(screen.queryByRole("option", { name: "مؤجرة" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "استخدام شخصي" })).toBeInTheDocument();
  });
  it("does not expose mutation forms when the account lacks a management capability", () => {
    wallet.canManageData = false;
    wallet.isAssistant = false;
    wallet.data.user.role = "viewer";
    render(<FinancialDialogs dialog={{ type: "entityForm", kind: "property" }} />);
    expect(screen.getByText("عرض فقط")).toBeInTheDocument();
    expect(screen.queryByLabelText("اسم عقار")).not.toBeInTheDocument();
    expect(wallet.mutate).not.toHaveBeenCalled();
  });
  it("allows a manager in assistant mode to inspect and edit financial records", () => {
    wallet.isAssistant = false;
    wallet.managerAssistantMode = true;
    wallet.data.user.role = "manager";
    wallet.data.payments = [
      {
        id: "old-payment",
        agreement_id: "agreement",
        active: 1,
        amount_cents: 110,
        paid_at: "2026-01-01",
        created_at: "2026-01-01T10:00:00Z",
        slot_index: 0,
        note: "حركة من شهر سابق",
      },
    ];
    const view = render(
      <FinancialDialogs
        dialog={{ type: "agreementDetails", id: "agreement" }}
      />,
    );
    expect(screen.getByText("حركة من شهر سابق")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "تعديل" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "حذف" }),
    ).toBeInTheDocument();
    view.rerender(
      <FinancialDialogs dialog={{ type: "payEdit", id: "old-payment" }} />,
    );
    expect(screen.queryByText("عرض فقط")).not.toBeInTheDocument();
    expect(screen.getByLabelText("المبلغ الفعلي (ر.س)")).toHaveValue("1.10");
    expect(wallet.mutate).not.toHaveBeenCalled();
  });

  it("submits 1.10 exactly without requiring overpayment rescheduling", async () => {
    const user = userEvent.setup();
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    expect(screen.getByLabelText("المبلغ الفعلي (ر.س)")).toHaveValue("1.10");
    expect(
      screen.queryByRole("group", { name: "طريقة إعادة الجدولة" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    expect(wallet.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "مراجعة الحركة قبل الحفظ" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/agreements/agreement/payments",
      {
        amount: "1.10",
        paid_at: "2026-10-15",
        note: "",
        slot: 0,
        expected_version: 7,
        reschedule_method: null,
        schedule_end_date: null,
      },
      "POST",
    );
    expect(wallet.close).toHaveBeenCalled();
    expect(wallet.open).not.toHaveBeenCalled();
  });

  it("freezes an uncertain financial form and retries the exact original payload", async () => {
    const user = userEvent.setup();
    wallet.mutate.mockRejectedValueOnce(
      Object.assign(new Error("لم يصل تأكيد الخادم"), { uncertain: true }),
    );
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    await screen.findByRole("button", {
      name: "إعادة المحاولة بالبيانات نفسها",
    });
    expect(screen.getByLabelText("المبلغ الفعلي (ر.س)")).toBeDisabled();
    expect(screen.getByLabelText("تاريخ التنفيذ الفعلي")).toBeDisabled();
    expect(wallet.close).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "إعادة المحاولة بالبيانات نفسها" }),
    );
    expect(wallet.mutate).toHaveBeenCalledTimes(2);
    expect(wallet.mutate.mock.calls[1]).toEqual(wallet.mutate.mock.calls[0]);
  });

  it("omits original schedule fields when editing an agreement with recorded payments", async () => {
    const user = userEvent.setup();
    wallet.data.payments = [
      {
        id: "payment",
        agreement_id: "agreement",
        active: 1,
        amount_cents: 100,
        paid_at: "2026-10-01",
        created_at: "2026-10-01T10:00:00Z",
      },
    ];
    render(
      <FinancialDialogs dialog={{ type: "agreementForm", id: "agreement" }} />,
    );
    for (const label of [
      "إجمالي القيمة (ر.س)",
      "المدفوع قبل تأسيس المحفظة",
      "عدد الأقساط",
      "دورية الأقساط",
      "موعد أول قسط",
    ])
      expect(screen.getByLabelText(label)).toBeDisabled();
    await user.clear(screen.getByLabelText("اسم العملية أو العقد"));
    await user.type(screen.getByLabelText("اسم العملية أو العقد"), "وصف محدث");
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/agreements/agreement",
      {
        title: "وصف محدث",
        counterparty: "",
        note: "",
        expected_version: 7,
      },
      "PATCH",
    );
  });

  it("uses the original payment capacity and viewed agreement version for correction", async () => {
    const user = userEvent.setup();
    Object.assign(wallet.data.agreements[0], { total_cents: 300000, first_due_date: "2026-10-01" });
    wallet.data.payments = [
      {
        id: "payment",
        agreement_id: "agreement",
        active: 1,
        slot_index: 0,
        amount_cents: 120000,
        paid_at: "2026-10-01",
        created_at: "2026-10-01T10:00:00Z",
        note: "",
      },
    ];
    wallet.data.payment_contexts = {
      payment: { expected_cents: 300000, due_date: "2026-10-01" },
    };
    render(<FinancialDialogs dialog={{ type: "payEdit", id: "payment" }} />);
    const amount = screen.getByLabelText("المبلغ الفعلي (ر.س)");
    await user.clear(amount);
    await user.type(amount, "2000");
    expect(
      screen.queryByRole("group", { name: "طريقة إعادة الجدولة" }),
    ).not.toBeInTheDocument();
    // A later bootstrap must not replace the version the user originally saw.
    wallet.data = {
      ...wallet.data,
      agreements: [{ ...wallet.data.agreements[0], version: 8 }],
    };
    await user.selectOptions(screen.getByLabelText("النهاية بعد هذه الحركة"), "2026-10-01");
    await user.click(screen.getByRole("button", { name: "مراجعة التعديل" }));
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/payments/payment",
      {
        amount: "2000",
        paid_at: "2026-10-01",
        note: "",
        slot: 0,
        expected_version: 7,
        reschedule_method: null,
        schedule_end_date: "2026-10-01",
      },
      "PATCH",
    );
  });

  it("reviews the final settlement date when editing an earlier partial receipt without changing its API confirmation date", async () => {
    const user = userEvent.setup();
    Object.assign(wallet.data.agreements[0], { total_cents: 300000, installment_count: 3 });
    wallet.data.payments = [
      { id: "partial", agreement_id: "agreement", active: 1, slot_index: 0, amount_cents: 40000, paid_at: "2026-10-15", created_at: "2026-10-15T10:00:00Z", reschedule_method: null, schedule_end_date: "2026-12-15", note: "" },
      { id: "settlement", agreement_id: "agreement", active: 1, slot_index: 0, amount_cents: 260000, paid_at: "2026-10-20", created_at: "2026-10-20T10:00:00Z", reschedule_method: "shorten", schedule_end_date: "2026-10-20", note: "تسوية لاحقة" },
    ];
    wallet.data.payment_contexts = project(wallet.data.agreements[0], wallet.data.payments).payment_contexts;
    wallet.data.dues = [];
    render(<FinancialDialogs dialog={{ type: "payEdit", id: "partial" }} />);
    await user.type(screen.getByLabelText("ملاحظات"), "وصف مصحح للدفعة القديمة");
    await user.selectOptions(screen.getByLabelText("النهاية بعد هذه الحركة"), "2026-12-15");
    await user.click(screen.getByRole("button", { name: "مراجعة التعديل" }));
    const review = within(screen.getByRole("region", { name: "مراجعة الحركة قبل الحفظ" }));
    expect(review.getByText("المتبقي بعد الحفظ").nextElementSibling).toHaveTextContent("0");
    expect(review.getByText("نهاية الجدول بعد الحفظ").nextElementSibling).toHaveTextContent(fmtDate("2026-10-20"));
    expect(review.getByText("نهاية الجدول بعد الحفظ").nextElementSibling).not.toHaveTextContent(fmtDate("2026-12-15"));
    expect(wallet.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.mutate).toHaveBeenCalledWith("/api/payments/partial", expect.objectContaining({ amount: "400.00", note: "وصف مصحح للدفعة القديمة", schedule_end_date: "2026-12-15", reschedule_method: null }), "PATCH");
  });

  it("requires a rescheduling choice only when amount exceeds exact installment capacity", async () => {
    const user = userEvent.setup();
    Object.assign(wallet.data.agreements[0], { total_cents: 220, installment_count: 2 });
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    const amount = screen.getByLabelText("المبلغ الفعلي (ر.س)");
    await user.clear(amount);
    await user.type(amount, "1.11");
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "اختر طريقة إعادة جدولة المبلغ الزائد",
    );
    expect(wallet.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("تقليل المدة"));
    await user.selectOptions(screen.getByLabelText("تاريخ نهاية الدفعات"), "2026-11-15");
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.mutate.mock.calls[0][1]).toMatchObject({
      amount: "1.11",
      reschedule_method: "shorten",
      schedule_end_date: "2026-11-15",
    });
  });

  it("keeps closed agreement history visible and omits correction controls", () => {
    wallet.data.agreements[0].closed_at = "2026-10-15T21:30:00.000Z";
    wallet.data.agreements[0].closed_by = "assistant@example.test";
    wallet.data.payments = [
      {
        id: "payment",
        agreement_id: "agreement",
        active: 1,
        slot_index: 0,
        amount_cents: 110,
        paid_at: "2026-10-15",
        created_at: "2026-10-15T11:00:00Z",
        note: "حركة محفوظة",
      },
    ];
    wallet.data.dues = [];
    render(
      <FinancialDialogs
        dialog={{ type: "agreementDetails", id: "agreement" }}
      />,
    );
    expect(screen.getByText("حركة محفوظة")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "إعادة فتح الاتفاق" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "تعديل" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "حذف" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("مغلق")).toBeInTheDocument();
  });

  it("voids a payment with version only and returns to its agreement", async () => {
    const user = userEvent.setup();
    wallet.data.payments = [
      {
        id: "payment",
        agreement_id: "agreement",
        active: 1,
        amount_cents: 110,
        paid_at: "2026-10-15",
        created_at: "2026-10-15T11:00:00Z",
      },
    ];
    render(<FinancialDialogs dialog={{ type: "payVoid", id: "payment" }} />);
    await user.click(screen.getByRole("button", { name: "تأكيد حذف الحركة" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/payments/payment",
      { expected_version: 7 },
      "DELETE",
    );
    await waitFor(() =>
      expect(wallet.open).toHaveBeenCalledWith("agreementDetails", {
        id: "agreement",
      }),
    );
  });

  it("opens agreement type selection when called with an entity and no chosen kind", () => {
    render(
      <FinancialDialogs dialog={{ type: "agreementForm", entity_id: "car" }} />,
    );
    expect(screen.getByRole("button", { name: /شراء/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /بيع/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /إيجار/ }),
    ).not.toBeInTheDocument();
  });

  it("submits a car odometer typed with multiple groups using Enter while still focused", async () => {
    const user = userEvent.setup();
    render(<FinancialDialogs dialog={{ type: "entityForm", id: "car", kind: "car" }} />);
    const odometer = screen.getByLabelText("الكيلومترات الحالية");
    await user.type(odometer, "١٬٢٣٤٬٥٦٧");
    expect(odometer).toHaveValue("1,234,567");
    expect(odometer).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/entities/car",
      expect.objectContaining({ odometer_km: "1234567", expected_version: 3 }),
      "PATCH",
    );
  });

  it("keeps the edited unit parent immutable and sends decimal reference value unchanged", async () => {
    const user = userEvent.setup();
    wallet.data.entities.push({
      id: "unit",
      kind: "unit",
      name: "وحدة اختبار",
      parent_id: "property",
      status: "available",
      reference_value_cents: 110,
      electricity_meter: "123",
      notes: "",
      version: 4,
    });
    render(
      <FinancialDialogs
        dialog={{ type: "entityForm", id: "unit", kind: "unit" }}
      />,
    );
    expect(
      screen.queryByLabelText("تتبع لعقار (اختياري)"),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "حفظ" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/entities/unit",
      {
        name: "وحدة اختبار",
        status: "available",
        electricity_meter: "123",
        reference_value_cents: "1.10",
        notes: "",
        expected_version: 4,
      },
      "PATCH",
    );
  });

  it("reports confirmed save followed by refresh failure without reopening a stale agreement", async () => {
    const user = userEvent.setup();
    wallet.mutate.mockResolvedValueOnce({ saved: true, refreshed: false });
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    await user.click(screen.getByRole("button", { name: "تم السداد" }));
    await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
    expect(wallet.close).toHaveBeenCalledOnce();
    expect(wallet.open).not.toHaveBeenCalled();
    expect(wallet.notify).toHaveBeenCalledWith(
      "تم الحفظ. تعذر تحديث العرض؛ اضغط تحديث البيانات.",
      true,
    );
  });

  it("retains typed form values when the user cancels the dirty-close confirmation", async () => {
    const user = userEvent.setup();
    render(<FinancialDialogs dialog={{ type: "expenseForm" }} />);
    await user.type(screen.getByLabelText("وصف المصروف"), "مصروف لم أحفظه بعد");
    await user.click(
      screen.getByRole("button", { name: "إغلاق", exact: true }),
    );
    await user.click(screen.getByRole("button", { name: "متابعة الإدخال" }));
    expect(screen.getByLabelText("وصف المصروف")).toHaveValue(
      "مصروف لم أحفظه بعد",
    );
    expect(wallet.close).not.toHaveBeenCalled();
    expect(wallet.mutate).not.toHaveBeenCalled();
  });

  it.each([
    { type: "payConfirm", id: "agreement::0", label: "تم السداد" },
    { type: "agreementClose", id: "agreement", label: "تأكيد الإغلاق" },
  ])(
    "offers an explicit refresh after a version conflict in $type",
    async ({ type, id, label }) => {
      const user = userEvent.setup();
      wallet.mutate.mockRejectedValueOnce(
        Object.assign(new Error("تغير السجل أثناء الحفظ؛ حدّث البيانات"), {
          code: 409,
        }),
      );
      render(<FinancialDialogs dialog={{ type, id }} />);
      await user.click(screen.getByRole("button", { name: label }));
      if (type === "payConfirm") await user.click(screen.getByRole("button", { name: "حفظ وتأكيد" }));
      expect(screen.getByRole("alert")).toHaveTextContent("تغير السجل");
      expect(wallet.close).not.toHaveBeenCalled();
      expect(wallet.reload).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: "تحديث البيانات وإغلاق النموذج" }),
      );
      expect(wallet.close).toHaveBeenCalledOnce();
      expect(wallet.reload).toHaveBeenCalledOnce();
      expect(wallet.mutate).toHaveBeenCalledOnce();
    },
  );

  it("preserves rent contract metadata, opening balance and installment schedule on creation", async () => {
    const user = userEvent.setup();
    wallet.data.entities.push({
      id: "unit",
      kind: "unit",
      name: "شقة 1",
      status: "available",
      version: 1,
    });
    render(
      <FinancialDialogs
        dialog={{ type: "agreementForm", kind: "rent", entity_id: "unit" }}
      />,
    );
    await user.click(screen.getByText("تفاصيل إضافية والتحصيل السابق"));
    await user.type(screen.getByLabelText("رقم عقد الإيجار"), "RENT-15");
    await user.type(screen.getByLabelText("اسم المستأجر"), "مستأجر الاختبار");
    await user.type(screen.getByLabelText("رقم التواصل"), "0501234567");
    fireEvent.change(screen.getByLabelText("بداية العقد"), {
      target: { value: "2026-10-15" },
    });
    fireEvent.change(screen.getByLabelText("نهاية العقد"), {
      target: { value: "2027-10-14" },
    });
    await user.type(screen.getByLabelText("إجمالي قيمة العقد (ر.س)"), "36000.35");
    const opening = screen.getByLabelText("المحصّل قبل تأسيس المحفظة");
    await user.clear(opening);
    await user.type(opening, "1000.11");
    const count = screen.getByLabelText("عدد الدفعات");
    await user.clear(count);
    await user.type(count, "4");
    await user.selectOptions(screen.getByLabelText("دورية الدفعات"), "3");
    await user.type(screen.getByLabelText("ملاحظات (اختياري)"), "تفاصيل العقد");
    await user.click(screen.getByRole("button", { name: "حفظ عقد الإيجار" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/agreements",
      {
        kind: "rent",
        entity_id: "unit",
        title: "إيجار شقة 1",
        contract_number: "RENT-15",
        counterparty: "مستأجر الاختبار",
        phone: "0501234567",
        start_date: "2026-10-15",
        end_date: "2027-10-14",
        total: "36000.35",
        opening: "1000.11",
        count: "4",
        frequency: "3",
        first_due_date: "2026-10-15",
        note: "تفاصيل العقد",
      },
      "POST",
    );
  });
});
