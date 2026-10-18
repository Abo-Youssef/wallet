import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import AccessEntry from "../../src/client/components/AccessEntry.jsx";
import { request } from "../../src/client/api.js";
import { WalletProvider, useWallet } from "../../src/client/state/WalletProvider.jsx";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("protected entry and recovery", () => {
  it("restoration retry retains its identity across a bootstrap generation refresh", async () => {
    const fetch=vi.fn().mockRejectedValueOnce(new TypeError("network"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ok:true,idempotent:true}),{status:200}));
    vi.stubGlobal("fetch",fetch);
    const body={backup:{sample:true},checkpoint:{generation:"before",digest:"restore-retry-fixture"},confirmation:"استعادة"};
    await expect(request("/api/backup/restore","POST",body,"owner@example.test",{managerAssistantMode:true,databaseGeneration:"before"})).rejects.toMatchObject({uncertain:true});
    await request("/api/backup/restore","POST",body,"owner@example.test",{managerAssistantMode:true,databaseGeneration:"after"});
    expect(fetch.mock.calls[1][1].body).toBe(fetch.mock.calls[0][1].body);
  });
  it("marks an explicit manager assistant-mode write without replacing the authenticated identity", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    await request("/api/tasks", "POST", { title: "متابعة" }, "owner@example.test", { managerAssistantMode: true });
    const options = fetch.mock.calls[0][1];
    expect(options.headers["X-Wallet-Mode"]).toBe("assistant");
    expect(options.headers.Authorization).toBeUndefined();
    expect(JSON.parse(options.body)).not.toHaveProperty("actor");
  });
  it("renders loading without credential inputs or a mandatory wait", () => {
    const view = render(<AccessEntry loading onRetry={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("جارٍ فتح محفظتك");
    expect(view.container.querySelector("input")).toBeNull();
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "true");
  });

  it("offers top-level protected sign-in navigation for an expired session", () => {
    const retry = vi.fn();
    render(<AccessEntry error="انتهت الجلسة" errorCode={401} onRetry={retry} />);
    expect(screen.getByRole("heading")).toHaveTextContent("سجّل الدخول من جديد");
    expect(screen.getByRole("link", { name: "العودة إلى تسجيل الدخول" })).toHaveAttribute("href", "/");
    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("distinguishes an unauthorized account from a temporary service failure", () => {
    const view = render(<AccessEntry error="هذا الحساب غير مخول" errorCode={403} />);
    expect(screen.getByRole("heading")).toHaveTextContent("هذا الحساب غير مخوّل");
    expect(screen.getByRole("link",{name:"تسجيل الخروج وتغيير الحساب"})).toHaveAttribute("href","/cdn-cgi/access/logout");
    view.rerender(<AccessEntry error="الخدمة غير متاحة" errorCode={503} />);
    expect(screen.getByRole("heading")).toHaveTextContent("تعذر فتح المحفظة");
    expect(screen.getByRole("alert")).toHaveTextContent("الخدمة غير متاحة");
  });

  it.each([401, 403])("retains HTTP %s when Access returns HTML instead of JSON", async (code) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Access</html>", { status: code })));
    await expect(request("/api/bootstrap")).rejects.toMatchObject({ code });
  });

  it("preserves the JSON status and meaningful server error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "هذا الحساب غير مخول بدخول المحفظة" }), { status: 403 })));
    await expect(request("/api/bootstrap")).rejects.toMatchObject({ code: 403, message: "هذا الحساب غير مخول بدخول المحفظة" });
  });

  it.each([401, 403])("clears an old account snapshot on bootstrap %s and recovers after retry", async (code) => {
    const snapshot = { month: "2026-10", user: { email: "real@example.test", role: "manager", name: "اسم من الحساب" } };
    const transport = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error("جلسة غير صالحة"), { code }))
      .mockResolvedValueOnce(snapshot);
    function Harness() {
      const wallet = useWallet();
      return <>
        <output data-testid="identity">{wallet.data?.user.name || "لا حساب"}</output>
        <output data-testid="error-code">{wallet.errorCode}</output>
        <output data-testid="dialog">{wallet.dialog?.type || "مغلق"}</output>
        <button onClick={() => wallet.open("detail")}>Open</button>
        <button onClick={() => wallet.reload()}>Reload</button>
      </>;
    }
    render(<WalletProvider initialData={snapshot} transport={transport}><Harness /></WalletProvider>);
    fireEvent.click(screen.getByText("Open"));
    fireEvent.click(screen.getByText("Reload"));
    await waitFor(() => expect(screen.getByTestId("error-code")).toHaveTextContent(String(code)));
    expect(screen.getByTestId("identity")).toHaveTextContent("لا حساب");
    expect(screen.getByTestId("dialog")).toHaveTextContent("مغلق");
    fireEvent.click(screen.getByText("Reload"));
    await waitFor(() => expect(screen.getByTestId("identity")).toHaveTextContent("اسم من الحساب"));
    expect(screen.getByTestId("error-code")).toBeEmptyDOMElement();
  });
});
