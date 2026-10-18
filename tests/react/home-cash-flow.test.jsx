import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { HomeCashFlow } from "../../src/client/components/HomeCashFlow.jsx";
import { currentSummary } from "../../src/shared/finance.mjs";

function fixture() {
  return {
    month: "2026-10", today: "2026-10-18",
    agreements: [
      { id: "rent", direction: "in", opening_cents: 500000, booking_cancelled_at: "2026-10-06T00:00:00Z" },
      { id: "car", direction: "out", closed_at: "2026-10-09T00:00:00Z" },
    ],
    payments: [
      { agreement_id: "rent", paid_at: "2026-10-15", amount_cents: 30000 },
      { agreement_id: "rent", paid_at: "2026-10-03", amount_cents: 120000 },
      { agreement_id: "car", paid_at: "2026-10-09", amount_cents: 20000 },
      { agreement_id: "rent", paid_at: "2026-10-08", amount_cents: 90000, active: 0 },
      { agreement_id: "rent", paid_at: "2026-10-25", amount_cents: 70000 },
    ],
    expenses: [
      { paid_at: "2026-10-04", amount_cents: 24000 },
      { paid_at: "2026-10-05", amount_cents: 50000, active: 0 },
    ],
  };
}

describe("home cumulative actual cash", () => {
  it("agrees with actual-cash summary including future-dated receipts, preserving cancelled-contract receipts and excluding inactive entries/opening balances", () => {
    const data = fixture();
    const { summary } = currentSummary(data.agreements, data.payments, data.expenses, data.month, data.today);
    expect(summary).toMatchObject({ cash_in: 220000, cash_out: 44000 });
    const { container } = render(<HomeCashFlow data={data} />);
    const chart = screen.getByRole("img", { name: "حركة النقد التراكمية في أكتوبر 2026" });
    expect(chart).toHaveAccessibleDescription(/داخل 2,200 ريال، خارج 440 ريال/);
    expect(chart).toHaveAccessibleDescription(/إلى 25 أكتوبر 2026/);
    const path = container.querySelector(".home-cash-line-in").getAttribute("d");
    const yValues = [...path.matchAll(/[ML] [\d.]+ ([\d.]+)/g)].map(match => Number(match[1]));
    expect(yValues).toHaveLength(26); // Opening baseline + days through last recorded cash.
    expect(yValues[1]).toBe(yValues[2]);
    expect(yValues[3]).toBeLessThan(yValues[2]);
    expect(yValues[15]).toBeLessThan(yValues[14]);
    expect(yValues.at(-1)).toBeLessThan(yValues[24]);
    expect(chart.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });

  it("renders the full selected past month and clears the graph when another month is empty", () => {
    const data = { ...fixture(), today: "2026-11-03" };
    const { container, rerender } = render(<HomeCashFlow data={data} month="2026-10" />);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/داخل 2,200 ريال، خارج 440 ريال/);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/إلى 31 أكتوبر 2026/);
    expect(container.querySelector(".home-cash-line-in").getAttribute("d").match(/L /g)).toHaveLength(31);
    rerender(<HomeCashFlow data={data} month="2026-11" />);
    expect(screen.getByText("لم تُسجّل حركات نقدية خلال هذا الشهر.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("includes recorded future-month activity without projecting the empty days after it", () => {
    const data = { ...fixture(), today: "2026-09-30" };
    const { rerender } = render(<HomeCashFlow data={data} />);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/داخل 2,200 ريال، خارج 440 ريال/);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/إلى 25 أكتوبر 2026/);
    rerender(<HomeCashFlow data={data} month="2026-11" />);
    expect(screen.getByText("لم تُسجّل حركات نقدية خلال هذا الشهر.")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("ends the current month at today when no later cash is recorded", () => {
    const data = fixture();
    data.payments = data.payments.filter(payment => payment.paid_at <= data.today);
    const { container } = render(<HomeCashFlow data={data} />);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/إلى 18 أكتوبر 2026/);
    expect(container.querySelector(".home-cash-line-in").getAttribute("d").match(/L /g)).toHaveLength(18);
  });

  it("keeps large axis labels compact while the accessible description retains precise amounts", () => {
    const data = { month: "2026-10", today: "2026-10-18", expenses: [{ paid_at: "2026-10-02", amount_cents: 240000075 }] };
    render(<HomeCashFlow data={data} />);
    expect(screen.getByRole("img")).toHaveAccessibleDescription(/خارج 2,400,000.75 ريال/);
    expect(screen.getByText("2.4M", { selector: "text" })).toBeInTheDocument();
    expect(screen.getByText("1.2M", { selector: "text" })).toBeInTheDocument();
  });

  it("surfaces validated integer overflow instead of showing partial cash", () => {
    const data = fixture();
    data.payments = [
      { agreement_id: "rent", paid_at: "2026-10-03", amount_cents: Number.MAX_SAFE_INTEGER },
      { agreement_id: "rent", paid_at: "2026-10-04", amount_cents: 1 },
    ];
    render(<HomeCashFlow data={data} />);
    expect(screen.getByRole("alert")).toHaveTextContent("تعذر عرض الرسم بدقة");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText("لم تُسجّل حركات نقدية خلال هذا الشهر.")).not.toBeInTheDocument();
  });
});
