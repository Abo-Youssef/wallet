import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CashFlowChart,
  DueComparisonChart,
} from "../../frontend/components/WalletCharts.jsx";

function fixture() {
  return {
    month: "2026-10",
    agreements: [
      { id: "rent", direction: "in", opening_cents: 500000 },
      { id: "car", direction: "out", closed_at: "2026-10-25T15:00:00Z" },
    ],
    payments: [
      {
        id: "p1",
        agreement_id: "rent",
        paid_at: "2026-10-03",
        amount_cents: 120000,
        active: 1,
      },
      {
        id: "p2",
        agreement_id: "car",
        paid_at: "2026-10-09",
        amount_cents: 20000,
        active: 1,
      },
      {
        id: "p3",
        agreement_id: "rent",
        paid_at: "2026-10-23",
        amount_cents: 30000,
        active: 1,
      },
    ],
    expenses: [
      { id: "e1", paid_at: "2026-10-04", amount_cents: 24000, active: 1 },
    ],
  };
}

describe("interactive cash charts", () => {
  it("updates exact period figures with native selection and keyboard bar navigation", async () => {
    const user = userEvent.setup();
    render(<CashFlowChart data={fixture()} month="2026-10" />);
    const select = screen.getByRole("combobox", {
      name: "فترة الحركات المعروضة",
    });
    expect(select).toHaveValue("2026-10-w4");
    await user.selectOptions(select, "2026-10-w1");
    let figures = screen.getByRole("region", { name: "أرقام الفترة المختارة" });
    expect(within(figures).getByText("1,200")).toBeInTheDocument();
    expect(within(figures).getByText("240")).toBeInTheDocument();
    expect(within(figures).getByText("960")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "الفترة السابقة" }),
    ).toBeDisabled();
    const firstBar = screen.getByRole("button", { name: /الفترة 1–7 من/ });
    fireEvent.keyDown(firstBar, { key: "ArrowRight" });
    expect(select).toHaveValue("2026-10-w2");
    expect(
      screen.getByRole("button", { name: /الفترة 8–14 من/ }),
    ).toHaveAttribute("aria-pressed", "true");
    figures = screen.getByRole("region", { name: "أرقام الفترة المختارة" });
    expect(within(figures).getByText("200")).toBeInTheDocument();
    expect(within(figures).getByText("-200")).toBeInTheDocument();
    await user.click(screen.getByText("عرض الأرقام لكل الفترات"));
    expect(
      screen.getByRole("table", { name: /حركة النقد خلال/ }),
    ).toBeVisible();
  });
  it("does not carry a selected week or old figures into an empty different month", async () => {
    const user = userEvent.setup(),
      data = fixture();
    const { rerender } = render(<CashFlowChart data={data} month="2026-10" />);
    await user.selectOptions(screen.getByRole("combobox"), "2026-10-w1");
    rerender(<CashFlowChart data={data} month="2026-11" />);
    expect(
      screen.getByText("لم تُسجّل حركات نقدية خلال هذا الشهر."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "أرقام الفترة المختارة" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("1,200")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("retains fractional riyals on the chart scale", () => {
    const data = {
      month: "2026-10",
      agreements: [{ id: "a", direction: "in" }],
      payments: [
        { agreement_id: "a", paid_at: "2026-10-03", amount_cents: 200 },
      ],
      expenses: [],
    };
    render(<CashFlowChart data={data} />);
    expect(screen.getByText("0.5", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("1.5", { selector: "text" })).toBeInTheDocument();
  });
  it("shows an accuracy error rather than a false empty state when aggregation overflows", () => {
    const data = {
      month: "2026-10",
      agreements: [{ id: "a", direction: "in" }],
      payments: [
        {
          agreement_id: "a",
          paid_at: "2026-10-03",
          amount_cents: Number.MAX_SAFE_INTEGER,
        },
        { agreement_id: "a", paid_at: "2026-10-03", amount_cents: 1 },
      ],
      expenses: [],
    };
    render(<CashFlowChart data={data} />);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذر عرض الرسم بدقة");
    expect(
      screen.queryByText("لم تُسجّل حركات نقدية خلال هذا الشهر."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});

describe("monthly due comparison", () => {
  it("uses monthly fulfillment with a shared total scale independently of actual cash", () => {
    const summary = {
      due_in: 300000,
      fulfilled_in: 120000,
      remaining_in: 180000,
      due_out: 150000,
      fulfilled_out: 30000,
      remaining_out: 120000,
      cash_in: 999999,
      cash_out: 100,
    };
    const { container } = render(
      <DueComparisonChart summary={summary} month="2026-10" />,
    );
    expect(
      screen.getByRole("img", {
        name: "التحصيل: مستحق 3,000 ريال، منفذ 1,200 ريال، متبقٍ 1,800 ريال",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("40٪ منفّذ")).toBeInTheDocument();
    expect(screen.getByText("20٪ منفّذ")).toBeInTheDocument();
    const totals = container.querySelectorAll(".due-chart-size");
    expect(totals[0]).toHaveStyle({ width: "100%" });
    expect(totals[1]).toHaveStyle({ width: "50%" });
    expect(screen.queryByText("9,999.99")).not.toBeInTheDocument();
  });
  it("does not invent completion or bars for a month without dues", () => {
    render(
      <DueComparisonChart
        summary={{ cash_in: 120000, cash_out: 24000 }}
        month="2026-10"
      />,
    );
    expect(
      screen.getByText("لا توجد استحقاقات في هذا الشهر."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
