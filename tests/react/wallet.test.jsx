import React from "react";
import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  cleanup,
} from "@testing-library/react";
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  WalletProvider,
  useWallet,
} from "../../frontend/state/WalletProvider.jsx";
import { useFormMutation, Modal } from "../../frontend/components/ui.jsx";
const snapshot = (month) => ({
  month,
  user: { email: "assistant@example.test", role: "assistant" },
  summary: { net: month === "2026-10" ? 96000 : 0 },
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
function Harness() {
  const wallet = useWallet(),
    mutation = useFormMutation();
  return (
    <>
      <output data-testid="snapshot">
        {wallet.month}:{wallet.data?.summary.net}
      </output>
      <output data-testid="loading">{String(wallet.loading)}</output>
      <output data-testid="requested">{wallet.requestedMonth}</output>
      <output data-testid="error">{wallet.error || mutation.error}</output>
      <button onClick={() => wallet.reload("2026-11")}>November</button>
      <button onClick={() => wallet.reload("2026-12")}>December</button>
      <button
        onClick={() =>
          mutation.submit("/api/payments", {
            amount: "1.10",
            expected_version: 4,
          })
        }
      >
        Save
      </button>
      <button
        onClick={() =>
          mutation.submit("/api/payments", {
            amount: "9.99",
            expected_version: 8,
          })
        }
      >
        Retry changed
      </button>
      <output data-testid="uncertain">{String(mutation.uncertain)}</output>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("accepted snapshot and save contracts", () => {
  it("places feedback inside the active modal so the native dialog does not hide it", () => {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute("open", "");
    };
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute("open");
    };
    function ToastHarness() {
      const wallet = useWallet();
      return (
        <>
          <button onClick={() => wallet.open("detail")}>Open detail</button>
          {wallet.dialog && (
            <Modal title="تفاصيل" onClose={wallet.close}>
              <button onClick={() => wallet.notify("تم تسجيل الحركة")}>
                Notify
              </button>
            </Modal>
          )}
        </>
      );
    }
    render(
      <WalletProvider initialData={snapshot("2026-10")}>
        <ToastHarness />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByText("Open detail"));
    fireEvent.click(screen.getByText("Notify"));
    expect(screen.getByRole("dialog")).toContainElement(
      screen.getByRole("status"),
    );
    expect(screen.getByRole("status")).toHaveTextContent("تم تسجيل الحركة");
  });
  it("keeps previous month and amounts while loading, rejecting an older response", async () => {
    const november = deferred(),
      december = deferred(),
      transport = vi.fn((path) =>
        path.includes("2026-11") ? november.promise : december.promise,
      );
    render(
      <WalletProvider initialData={snapshot("2026-10")} transport={transport}>
        <Harness />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByText("November"));
    expect(screen.getByTestId("snapshot")).toHaveTextContent("2026-10:96000");
    expect(screen.getByTestId("requested")).toHaveTextContent("2026-11");
    fireEvent.click(screen.getByText("December"));
    await act(async () => december.resolve(snapshot("2026-12")));
    expect(screen.getByTestId("snapshot")).toHaveTextContent("2026-12:0");
    await act(async () => november.resolve(snapshot("2026-11")));
    expect(screen.getByTestId("snapshot")).toHaveTextContent("2026-12:0");
  });
  it("blocks financial writes while new data is pending and after refresh fails", async () => {
    const pending = deferred(),
      transport = vi.fn(() => pending.promise);
    render(
      <WalletProvider initialData={snapshot("2026-10")} transport={transport}>
        <Harness />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByText("November"));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(screen.getByTestId("error")).toHaveTextContent("حدّث بيانات"),
    );
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => pending.reject(new Error("offline")));
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("snapshot")).toHaveTextContent("2026-10:96000");
  });
  it("does not submit twice when clicked before the first render and reports saved/refresh failure", async () => {
    const save = deferred(),
      transport = vi.fn((path, method) =>
        method === "POST"
          ? save.promise
          : Promise.reject(new Error("refresh offline")),
      );
    render(
      <WalletProvider initialData={snapshot("2026-10")} transport={transport}>
        <Harness />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByText("Save"));
    fireEvent.click(screen.getByText("Save"));
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => save.resolve({ ok: true }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "تم الحفظ؛ تعذر تحديث العرض",
      ),
    );
    expect(
      transport.mock.calls.filter((call) => call[1] === "POST"),
    ).toHaveLength(1);
  });
  it("an uncertain retry retains the original payload and version", async () => {
    const transport = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("uncertain"), { uncertain: true }),
      )
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(snapshot("2026-10"));
    render(
      <WalletProvider initialData={snapshot("2026-10")} transport={transport}>
        <Harness />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByText("Save"));
    await waitFor(() =>
      expect(screen.getByTestId("uncertain")).toHaveTextContent("true"),
    );
    fireEvent.click(screen.getByText("Retry changed"));
    await waitFor(() => expect(transport).toHaveBeenCalledTimes(3));
    expect(transport.mock.calls[1][2]).toEqual({
      amount: "1.10",
      expected_version: 4,
    });
  });
  it("does not accept a global preview object in a production build", async () => {
    globalThis.mahfazatiPreview = { data: vi.fn(() => snapshot("1900-01")) };
    const transport = vi.fn().mockResolvedValue(snapshot("2026-11"));
    render(
      <WalletProvider initialData={snapshot("2026-10")} transport={transport}>
        <Harness />
      </WalletProvider>,
    );
    fireEvent.click(screen.getByText("November"));
    await waitFor(() =>
      expect(screen.getByTestId("snapshot")).toHaveTextContent("2026-11"),
    );
    expect(globalThis.mahfazatiPreview.data).not.toHaveBeenCalled();
    delete globalThis.mahfazatiPreview;
  });
});
