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
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import FinancialDialogs from "../../frontend/features/FinancialDialogs.jsx";
import { useWallet } from "../../frontend/state/WalletProvider.jsx";

vi.mock("../../frontend/state/WalletProvider.jsx", async (importOriginal) => ({
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
  it("allows managers to inspect agreement history but refuses financial forms", () => {
    wallet.isAssistant = false;
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
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "حذف" }),
    ).not.toBeInTheDocument();
    view.rerender(
      <FinancialDialogs dialog={{ type: "payEdit", id: "old-payment" }} />,
    );
    expect(screen.getByText("عرض فقط")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
    expect(wallet.mutate).not.toHaveBeenCalled();
  });

  it("submits 1.10 exactly without requiring overpayment rescheduling", async () => {
    const user = userEvent.setup();
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    expect(screen.getByLabelText("المبلغ الفعلي (ر.س)")).toHaveValue(1.1);
    expect(
      screen.queryByRole("group", { name: "طريقة إعادة الجدولة" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "تأكيد التنفيذ" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/agreements/agreement/payments",
      {
        amount: "1.10",
        paid_at: "2026-10-15",
        note: "",
        slot: 0,
        expected_version: 7,
        reschedule_method: null,
      },
      "POST",
    );
    expect(wallet.open).toHaveBeenCalledWith("agreementDetails", {
      id: "agreement",
    });
  });

  it("freezes an uncertain financial form and retries the exact original payload", async () => {
    const user = userEvent.setup();
    wallet.mutate.mockRejectedValueOnce(
      Object.assign(new Error("لم يصل تأكيد الخادم"), { uncertain: true }),
    );
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    await user.click(screen.getByRole("button", { name: "تأكيد التنفيذ" }));
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
    await user.click(screen.getByRole("button", { name: "حفظ التعديل" }));
    expect(wallet.mutate).toHaveBeenCalledWith(
      "/api/payments/payment",
      {
        amount: "2000",
        paid_at: "2026-10-01",
        note: "",
        slot: 0,
        expected_version: 7,
        reschedule_method: null,
      },
      "PATCH",
    );
  });

  it("requires a rescheduling choice only when amount exceeds exact installment capacity", async () => {
    const user = userEvent.setup();
    render(
      <FinancialDialogs dialog={{ type: "payConfirm", id: "agreement::0" }} />,
    );
    const amount = screen.getByLabelText("المبلغ الفعلي (ر.س)");
    await user.clear(amount);
    await user.type(amount, "1.11");
    await user.click(screen.getByRole("button", { name: "تأكيد التنفيذ" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "اختر طريقة إعادة جدولة المبلغ الزائد",
    );
    expect(wallet.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByLabelText("تقليل المدة"));
    await user.click(screen.getByRole("button", { name: "تأكيد التنفيذ" }));
    expect(wallet.mutate.mock.calls[0][1]).toMatchObject({
      amount: "1.11",
      reschedule_method: "shorten",
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
    await user.click(screen.getByRole("button", { name: "تأكيد التنفيذ" }));
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
    { type: "payConfirm", id: "agreement::0", label: "تأكيد التنفيذ" },
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
    await user.type(screen.getByLabelText("رقم عقد الإيجار"), "RENT-15");
    await user.type(screen.getByLabelText("اسم المستأجر"), "مستأجر الاختبار");
    await user.type(screen.getByLabelText("رقم التواصل"), "0501234567");
    fireEvent.change(screen.getByLabelText("بداية العقد"), {
      target: { value: "2026-10-15" },
    });
    fireEvent.change(screen.getByLabelText("نهاية العقد"), {
      target: { value: "2027-10-14" },
    });
    await user.type(screen.getByLabelText("إجمالي القيمة (ر.س)"), "36000.35");
    const opening = screen.getByLabelText("المحصّل قبل تأسيس المحفظة");
    await user.clear(opening);
    await user.type(opening, "1000.11");
    const count = screen.getByLabelText("عدد الأقساط");
    await user.clear(count);
    await user.type(count, "4");
    await user.selectOptions(screen.getByLabelText("دورية الأقساط"), "3");
    await user.type(screen.getByLabelText("ملاحظات (اختياري)"), "تفاصيل العقد");
    await user.click(screen.getByRole("button", { name: "حفظ" }));
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
