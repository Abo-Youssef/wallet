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
import { LOGOUT_SIGNAL_KEY, navigateToAccessLogout } from "../lib/session.js";
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
  logoutNavigate = navigateToAccessLogout,
}) {
  const [data, setData] = useState(initialData),
    [loading, setLoading] = useState(!initialData),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(null),
    [requestedMonth, setRequestedMonth] = useState(""),
    [dialog, setDialog] = useState(null),
    [managerAssistantMode, updateManagerAssistantMode] = useState(false),
    [toast, setToast] = useState(null),
    [updatedAt, setUpdatedAt] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const latest = useRef({ data, loading, error, managerAssistantMode, dialog });
  latest.current = { data, loading, error, managerAssistantMode, dialog };
  const generation = useRef(0),
    toastTimer = useRef(null),
    sessionGeneration = useRef(0),
    leaving = useRef(false);
  const clearSession = useCallback((message, code=401) => {
    ++generation.current;
    ++sessionGeneration.current;
    clearTimeout(toastTimer.current);
    Object.assign(latest.current,{data:null,loading:false,error:message,managerAssistantMode:false,dialog:null});
    setData(null);setDialog(null);setToast(null);setUpdatedAt(null);
    setLoading(false);setRequestedMonth("");setError(message);setErrorCode(code);
    updateManagerAssistantMode(false);
  },[]);
  const logout = useCallback((broadcast=true) => {
    if(leaving.current || __PREVIEW__)return;
    leaving.current=true;
    clearSession("جارٍ إنهاء جلسة الدخول…");
    setSigningOut(true);
    // Keep unresolved write receipts: they contain hashes/IDs only and prevent
    // a lost response from becoming a duplicate receipt after signing in again.
    if(broadcast)try{localStorage.setItem(LOGOUT_SIGNAL_KEY,crypto.randomUUID());}catch{}
    logoutNavigate();
  },[clearSession,logoutNavigate]);
  const notify = useCallback((message, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ message, isError });
    toastTimer.current = setTimeout(() => setToast(null), 6500);
  }, []);
  const api = useCallback(
    async (path, method = "GET", body) => {
      if(leaving.current)throw Object.assign(new Error("أكمل تسجيل الدخول من جديد قبل المتابعة."),{code:401});
      const session=sessionGeneration.current;
      const current = latest.current;
      const role = current.data?.user?.role;
      const working = role === "assistant" || (role === "manager" && current.managerAssistantMode);
      const backupPreview = role === "manager" && path === "/api/backup/preview" && method === "POST";
      if (method !== "GET" && !working && !backupPreview)
        return Promise.reject(new Error("وضع المدير للاطلاع فقط. فعّل وضع المساعد من المزيد لتسجيل التغييرات."));
      try {
      const result=await transport(path, method, body, current.data?.user?.email || "", {
        managerAssistantMode: role === "manager" && current.managerAssistantMode,
        databaseGeneration: current.data?.database_generation ?? "",
      });
      if(session!==sessionGeneration.current)
        throw Object.assign(new Error("تغيّرت جلسة الدخول؛ أعد فتح العملية بعد تسجيل الدخول."),{code:401});
      return result;
      } catch(cause) {
        if(session===sessionGeneration.current && [401,403].includes(cause.code))
          clearSession(cause.message,cause.code);
        throw cause;
      }
    },
    [transport,clearSession],
  );
  const reload = useCallback(
    async (month = latest.current.data?.month || currentMonth()) => {
      if(leaving.current)return false;
      const id = ++generation.current;
      latest.current.loading = true;
      setLoading(true);
      setError("");
      setErrorCode(null);
      setRequestedMonth(month);
      try {
        const next =
          __PREVIEW__ && globalThis.walletPreview
            ? globalThis.walletPreview.data(month)
            : await api("/api/bootstrap?month=" + encodeURIComponent(month));
        if (id !== generation.current) return false;
        // A refresh must not give a form opened before restoration permission
        // to save against the newly restored generation.
        if (latest.current.data &&
          (next.database_generation ?? "") !== (latest.current.data.database_generation ?? "") &&
          latest.current.dialog?.type !== "restore") setDialog(null);
        const priorUser=latest.current.data?.user;
        if(priorUser && (next.user?.email!==priorUser.email || next.user?.role!==priorUser.role)){
          ++sessionGeneration.current;
          setDialog(null);
          setToast(null);
        }
        if (next.user?.email !== latest.current.data?.user?.email || next.user?.role !== "manager") {
          latest.current.managerAssistantMode = false;
          updateManagerAssistantMode(false);
        }
        latest.current.data = next;
        latest.current.error = "";
        setData(next);
        setUpdatedAt(new Date());
        return true;
      } catch (cause) {
        if (id === generation.current) {
          latest.current.error = cause.message;
          setError(cause.message);
          setErrorCode(cause.code || null);
          if ([401, 403].includes(cause.code)) {
            latest.current.data = null;
            setData(null);
            setDialog(null);
            latest.current.managerAssistantMode = false;
            updateManagerAssistantMode(false);
          }
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
      ++sessionGeneration.current;
      clearTimeout(toastTimer.current);
    };
  }, [reload, initialData]);
  useEffect(()=>{
    const onLogout=event=>{if(event.key===LOGOUT_SIGNAL_KEY && event.newValue)logout(false);};
    const onPageShow=event=>{
      if(event.persisted && !leaving.current){
        clearSession("جارٍ التحقق من جلسة الدخول…");
        void reload();
      }
    };
    const onVisible=()=>{
      if(document.visibilityState==="visible" && latest.current.data && !latest.current.loading && !leaving.current)
        void reload();
    };
    window.addEventListener("storage",onLogout);
    window.addEventListener("pageshow",onPageShow);
    document.addEventListener("visibilitychange",onVisible);
    return ()=>{
      window.removeEventListener("storage",onLogout);
      window.removeEventListener("pageshow",onPageShow);
      document.removeEventListener("visibilitychange",onVisible);
    };
  },[logout,reload,clearSession]);
  const open = useCallback(
    (type, props = {}) => setDialog({ type, ...props }),
    [],
  );
  const close = useCallback(() => setDialog(null), []);
  const setManagerAssistantMode = useCallback((enabled) => {
    const next = latest.current.data?.user?.role === "manager" && Boolean(enabled);
    latest.current.managerAssistantMode = next;
    updateManagerAssistantMode(next);
    setDialog(null);
  }, []);
  const mutate = useCallback(
    async (path, body, method = "POST") => {
      if (__PREVIEW__)
        throw new Error("هذه معاينة توضيحية. جرّب الحفظ في المعاينة المحلية.");
      if (latest.current.loading || latest.current.error)
        throw new Error("حدّث بيانات المحفظة أولًا قبل تسجيل أي تغيير.");
      const result = await api(path, method, body);
      const session=sessionGeneration.current;
      const refreshed = await reload();
      if(leaving.current || session!==sessionGeneration.current)
        throw Object.assign(new Error("أعد تسجيل الدخول ثم راجع السجل لتأكيد نتيجة الحفظ."),{code:401,uncertain:true});
      notify(
        refreshed
          ? "تم الحفظ وتحديث المحفظة"
          : "تم الحفظ؛ تعذر تحديث العرض. اضغط تحديث البيانات.",
        !refreshed,
      );
      return { saved: true, refreshed, result };
    },
    [api, reload, notify],
  );
  const value = {
    data,
    month: data?.month || currentMonth(),
    loading,
    error,
    errorCode,
    requestedMonth,
    isAssistant: data?.user?.role === "assistant",
    managerAssistantMode: data?.user?.role === "manager" && managerAssistantMode,
    setManagerAssistantMode,
    isWorkingMode: data?.user?.role === "assistant" || (data?.user?.role === "manager" && managerAssistantMode),
    canManageData: data?.user?.role === "assistant" || (data?.user?.role === "manager" && managerAssistantMode),
    dialog,
    open,
    close,
    notify,
    reload,
    mutate,
    api,
    updatedAt,
    signingOut,
    logout,
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
