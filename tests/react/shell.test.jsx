import React from "react";
import { beforeAll, afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import App from "../../src/client/App.jsx";
import { WalletProvider } from "../../src/client/state/WalletProvider.jsx";

function snapshot() {
  return {
    user: { role: "manager", email: "actual.account@example.test", name: "عبدالرحمن محمد عبدالله صاحب المحفظة ١٢٣" },
    today: "2026-10-17", month: "2026-10",
    entities: [], archived_entities: [], agreements: [], payments: [], expenses: [], dues: [], tasks: [],
    alerts: [{ key: "insurance:car:2026-10-20", title: "تأمين سيارة ١٠٢", source: "تأمين", due_date: "2026-10-20", late: false }],
    summary: { due_in: 300000, fulfilled_in: 120000, remaining_in: 180000,
      due_out: 100000, fulfilled_out: 0, remaining_out: 100000,
      cash_in: 500000, cash_out: 24000, net: 476000, future_in: 0, future_out: 0 },
  };
}
function setup(data = snapshot()) {
  return render(<WalletProvider initialData={data}><App /></WalletProvider>);
}
beforeAll(() => {
  window.scrollTo = vi.fn();
  HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  HTMLDialogElement.prototype.close = function () { this.open = false; };
});
afterEach(cleanup);

describe("one responsive wallet shell", () => {
  it("uses the real account identity, preserves a full accessible long name and an LTR wordmark", () => {
    setup();
    const header = screen.getByRole("banner");
    const profile = within(header).getByText("عبدالرحمن محمد عبدالله صاحب المحفظة 123", { selector: "summary strong" });
    expect(profile.closest("summary")).toHaveAttribute("title", profile.textContent);
    expect(within(header).getByRole("img", { name: "my Wallet" })).toHaveAttribute("dir", "ltr");
    expect(header.textContent).not.toMatch(/[٠-٩۰-۹]/);
    expect(within(header).getByText("actual.account@example.test")).toBeInTheDocument();
  });
  it("falls back to the account email rather than inventing a person's name", () => {
    const data = snapshot(); delete data.user.name;
    setup(data);
    expect(within(screen.getByRole("banner")).getByText(data.user.email, { selector: "summary strong" })).toBeInTheDocument();
  });
  it("opens the existing alerts workflow from the common header", () => {
    setup();
    fireEvent.click(within(screen.getByRole("banner")).getByRole("button", { name: "التنبيهات (1)" }));
    const dialog = screen.getByRole("dialog", { name: "التنبيهات والمتابعات" });
    expect(within(dialog).getByText("تأمين سيارة 102")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/[٠-٩۰-۹]/);
  });
  it("calculates progress from this month's fulfilled dues, not unrelated cash receipts", () => {
    setup();
    expect(screen.getByRole("progressbar", { name: "نسبة التحصيل" })).toHaveAttribute("aria-valuenow", "40");
    const card = screen.getByRole("button", { name: "تفاصيل التحصيل للشهر" });
    expect(card).toHaveTextContent("3,000");
    expect(card).toHaveTextContent("1,200");
    expect(card).toHaveTextContent("1,800");
    fireEvent.click(card);
    expect(screen.getByRole("heading", { level: 1, name: "التحصيل" })).toBeInTheDocument();
    expect(screen.getByRole("banner").querySelector(".brand-animated")).toBeNull();
  });
  it("keeps five mobile tabs with central app icon and grouped access", () => {
    const data = snapshot(); data.summary.due_in = 0; data.summary.fulfilled_in = 0;
    setup(data);
    expect(screen.getByRole("progressbar", { name: "نسبة التحصيل" })).toHaveAttribute("aria-valuenow", "0");
    const nav = screen.getByRole("navigation", { name: "التنقل على الجوال" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(5);
    expect(buttons.map(button => button.textContent)).toEqual(["الأصول", "السيارات", "Wالرئيسية", "البنود", "المزيد"]);
    expect(buttons[2].querySelector(".nav-app-icon")).toHaveTextContent("W");
    fireEvent.click(buttons[0]);
    expect(screen.getByRole("heading", {level:1,name:"الأصول"})).toBeInTheDocument();
    fireEvent.click(buttons[1]);
    expect(screen.getByRole("heading", {level:1,name:"السيارات"})).toBeInTheDocument();
    fireEvent.click(buttons[3]);
    fireEvent.click(within(screen.getByRole("main")).getByRole("button",{name:"الفواتير"}));
    expect(screen.getByRole("heading", {level:1,name:"الفواتير"})).toBeInTheDocument();
    expect(buttons[3]).toHaveAttribute("aria-current", "page");
    fireEvent.click(buttons[4]);
    expect(screen.getByRole("heading",{level:1,name:"المزيد"})).toBeInTheDocument();
  });
  it("starts manager read-only and requires explicit assistant mode while retaining real identity", () => {
    setup();
    expect(screen.queryByRole("button", {name:"إضافة جديدة"})).not.toBeInTheDocument();
    const nav = screen.getByRole("navigation",{name:"التنقل على الجوال"});
    fireEvent.click(within(nav).getByRole("button",{name:"المزيد"}));
    fireEvent.click(screen.getByRole("button",{name:/الدخول إلى وضع المساعد/}));
    expect(screen.getByRole("heading",{level:1,name:/مهام اليوم/})).toBeInTheDocument();
    expect(screen.getByRole("button",{name:"إضافة جديدة"})).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("المدير · وضع المساعد")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button",{name:"العودة إلى وضع الاطلاع"}));
    expect(screen.getByRole("heading",{level:1,name:"نظرة عامة"})).toBeInTheDocument();
    expect(screen.queryByRole("button",{name:"إضافة جديدة"})).not.toBeInTheDocument();
  });
});
