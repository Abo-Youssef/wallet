import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { request } from "../api.js";
import { currentMonth } from "../lib/format.js";
const WalletContext = createContext(null);
export const useWallet = () => useContext(WalletContext);
export function WalletToast() {
  const wallet = useWallet();
  if (!wallet?.toast) return null;
  return (
    <div
      className={`toast ${wallet.toast.isError ? "toast-error" : ""}`}
      role={wallet.toast.isError ? "alert" : "status"}
    >
      <span>{wallet.toast.message}</span>
      <button aria-label="إغلاق الرسالة" onClick={wallet.dismissToast}>
        ×
      </button>
    </div>
  );
}
export function WalletProvider({
  children,
  initialData = null,
  transport = request,
}) {
  const [data, setData] = useState(initialData),
    [loading, setLoading] = useState(!initialData),
    [error, setError] = useState(""),
    [requestedMonth, setRequestedMonth] = useState(""),
    [dialog, setDialog] = useState(null),
    [toast, setToast] = useState(null),
    [updatedAt, setUpdatedAt] = useState(null);
  const latest = useRef({ data, loading, error });
  latest.current = { data, loading, error };
  const generation = useRef(0),
    toastTimer = useRef(null);
  const notify = useCallback((message, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  const api = useCallback(
    (path, method = "GET", body) =>
      transport(path, method, body, latest.current.data?.user?.email || ""),
    [transport],
  );
  const reload = useCallback(
    async (month = latest.current.data?.month || currentMonth()) => {
      const id = ++generation.current;
      latest.current.loading = true;
      setLoading(true);
      setError("");
      setRequestedMonth(month);
      try {
        const next =
          __PREVIEW__ && globalThis.mahfazatiPreview
            ? globalThis.mahfazatiPreview.data(month)
            : await api("/api/bootstrap?month=" + encodeURIComponent(month));
        if (id !== generation.current) return false;
        latest.current.data = next;
        latest.current.error = "";
        setData(next);
        setUpdatedAt(new Date());
        return true;
      } catch (cause) {
        if (id === generation.current) {
          latest.current.error = cause.message;
          setError(cause.message);
        }
        return false;
      } finally {
        if (id === generation.current) {
          latest.current.loading = false;
          setLoading(false);
          setRequestedMonth("");
        }
      }
    },
    [api],
  );
  useEffect(() => {
    if (!initialData) reload();
    return () => {
      ++generation.current;
      clearTimeout(toastTimer.current);
    };
  }, [reload, initialData]);
  const open = useCallback(
    (type, props = {}) => setDialog({ type, ...props }),
    [],
  );
  const close = useCallback(() => setDialog(null), []);
  const mutate = useCallback(
    async (path, body, method = "POST") => {
      if (__PREVIEW__)
        throw new Error("هذه معاينة توضيحية. جرّب الحفظ في المعاينة المحلية.");
      if (latest.current.loading || latest.current.error)
        throw new Error("حدّث بيانات المحفظة أولًا قبل تسجيل أي تغيير.");
      await api(path, method, body);
      const refreshed = await reload();
      notify(
        refreshed
          ? "تم الحفظ وتحديث المحفظة"
          : "تم الحفظ؛ تعذر تحديث العرض. اضغط تحديث البيانات.",
        !refreshed,
      );
      return { saved: true, refreshed };
    },
    [api, reload, notify],
  );
  const value = {
    data,
    month: data?.month || currentMonth(),
    loading,
    error,
    requestedMonth,
    isAssistant: data?.user?.role === "assistant",
    dialog,
    open,
    close,
    notify,
    reload,
    mutate,
    api,
    updatedAt,
    toast,
    dismissToast: () => setToast(null),
  };
  return (
    <WalletContext.Provider value={value}>
      {children}
      {!dialog && <WalletToast />}
    </WalletContext.Provider>
  );
}
