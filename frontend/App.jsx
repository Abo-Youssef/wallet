import React, { useEffect, useRef, useState } from "react";
import {
  Home,
  ArrowDownToLine,
  ArrowUpFromLine,
  Layers,
  Bell,
  CheckSquare,
  History,
  Download,
  RefreshCw,
  MoreHorizontal,
  Plus,
  ChevronLeft,
} from "lucide-react";
import { useWallet } from "./state/WalletProvider.jsx";
import { Brand, Button } from "./components/ui.jsx";
import { ManagerHome, AssistantHome } from "./pages/Home.jsx";
import CashPage from "./pages/CashPage.jsx";
import DataPage from "./pages/DataPage.jsx";
import FinancialDialogs from "./features/FinancialDialogs.jsx";
import OperationsDialogs from "./features/OperationsDialogs.jsx";
const navigation = [
  ["home", "الرئيسية", Home],
  ["collect", "التحصيل", ArrowDownToLine],
  ["pay", "السداد", ArrowUpFromLine],
  ["data", "البيانات", Layers],
];
export default function App() {
  const {
    data,
    isAssistant,
    loading,
    error,
    requestedMonth,
    month,
    reload,
    open,
    dialog,
    updatedAt,
  } = useWallet();
  const [page, setPage] = useState("home"),
    [more, setMore] = useState(false),
    [dataKind, setDataKind] = useState("property");
  const main = useRef(null),
    firstPage = useRef(true);
  const navigate = (next, kind) => {
    if (next === "data") setDataKind(kind || "property");
    setPage(next);
    setMore(false);
  };
  useEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    main.current?.querySelector("h1")?.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page]);
  const tool = (type, label, Icon) => (
    <button
      key={type}
      className="rail-tool"
      onClick={() => {
        open(type);
        setMore(false);
      }}
    >
      <Icon size={21} />
      <span>{label}</span>
      {type === "alerts" && data?.alerts.length > 0 && (
        <span className="count">{data.alerts.length}</span>
      )}
    </button>
  );
  if (!data)
    return (
      <div className="startup">
        <Brand />
        {error ? (
          <>
            <h1>تعذر فتح المحفظة</h1>
            <p role="alert">{error}</p>
            <Button variant="primary" onClick={() => reload()}>
              إعادة المحاولة
            </Button>
          </>
        ) : (
          <>
            <div className="skeleton skeleton-heading" />
            <p role="status">نرتب تفاصيل محفظتك…</p>
            <div className="skeleton skeleton-panel" />
          </>
        )}
      </div>
    );
  return (
    <>
      <a className="skip-link" href="#main-content">
        تجاوز إلى المحتوى
      </a>
      {__PREVIEW__ && (
        <div className="preview-banner">
          معاينة توضيحية دون حفظ <a href="?role=manager">المدير</a>
          <a href="?role=assistant">المساعد</a>
        </div>
      )}
      <header className="mobile-header">
        <Brand />
        <div className="mobile-header-tools">
          <button
            className="icon-button notification-button"
            aria-label={`التنبيهات (${data.alerts.length})`}
            onClick={() => open("alerts")}
          >
            <Bell size={22} />
            {data.alerts.length > 0 && <i />}
          </button>
          <button
            className="icon-button"
            aria-label="المزيد من الأدوات"
            aria-expanded={more}
            onClick={() => setMore(!more)}
          >
            <MoreHorizontal />
          </button>
        </div>
      </header>
      <aside className="sidebar">
        <Brand />
        <span className="workspace-label">
          مساحة {isAssistant ? "المساعد" : "المدير"}
        </span>
        <nav aria-label="الأقسام الرئيسية" className="primary-nav">
          {navigation.map(([key, label, Icon]) => (
            <button
              key={key}
              onClick={() => navigate(key)}
              aria-current={page === key ? "page" : undefined}
              className={page === key ? "active" : ""}
            >
              <Icon size={23} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="rail-bottom">
          {tool("tasks", "المهام", CheckSquare)}
          {tool("alerts", "التنبيهات", Bell)}
          {tool("history", "سجل العمليات", History)}
          {!isAssistant && tool("backup", "نسخة احتياطية", Download)}
          <div className="rail-profile">
            <span className="avatar">{isAssistant ? "م" : "د"}</span>
            <div>
              <strong>{isAssistant ? "المساعد" : "المدير"}</strong>
              <small>{isAssistant ? "إدارة ومتابعة" : "مراجعة وإشراف"}</small>
            </div>
          </div>
        </div>
      </aside>
      {more && (
        <div className="mobile-tools">
          <strong>أدوات المحفظة</strong>
          {tool("tasks", "المهام", CheckSquare)}
          {tool("history", "سجل العمليات", History)}
          {!isAssistant && tool("backup", "نسخة احتياطية", Download)}
          <Button
            onClick={() => {
              reload();
              setMore(false);
            }}
          >
            <RefreshCw size={18} />
            تحديث البيانات
          </Button>
        </div>
      )}
      <main
        id="main-content"
        className={`main-content page-${page}`}
        ref={main}
        aria-busy={loading}
      >
        <div className="workspace-bar">
          <span>
            {isAssistant ? "مساحة المساعد" : "مساحة المدير"}
            <ChevronLeft size={14} />
            {navigation.find((item) => item[0] === page)?.[1]}
          </span>
          <button
            className="sync-button"
            onClick={() => reload()}
            disabled={loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : ""} />
            {loading
              ? "جارٍ التحديث"
              : updatedAt
                ? "محدّث " +
                  updatedAt.toLocaleTimeString("ar-SA", {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone: "Asia/Riyadh",
                  })
                : "تحديث البيانات"}
          </button>
        </div>
        {loading && (
          <div className="loading-line" role="status">
            جارٍ تحميل {requestedMonth}، الأرقام المعروضة تخص {month}.
          </div>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
            <Button onClick={() => reload()}>إعادة التحديث</Button>
          </div>
        )}
        {page === "home" ? (
          isAssistant ? (
            <AssistantHome navigate={navigate} />
          ) : (
            <ManagerHome navigate={navigate} />
          )
        ) : page === "collect" ? (
          <CashPage direction="in" />
        ) : page === "pay" ? (
          <CashPage direction="out" />
        ) : (
          <DataPage key={dataKind} initialKind={dataKind} />
        )}
        <footer className="workspace-footer">
          <span>محفظتي</span>
          <span>الأرقام بالريال السعودي · التواريخ بتوقيت الرياض</span>
        </footer>
      </main>
      <nav className="bottom-nav" aria-label="التنقل على الجوال">
        {navigation.map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => navigate(key)}
            aria-current={page === key ? "page" : undefined}
          >
            <Icon size={23} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      {isAssistant && page !== "home" && (
        <button
          className="mobile-add"
          aria-label="إضافة جديدة"
          onClick={() => open("quickadd")}
        >
          <Plus />
        </button>
      )}
      {dialog && (
        <React.Fragment key={JSON.stringify(dialog)}>
          <FinancialDialogs dialog={dialog} />
          <OperationsDialogs dialog={dialog} />
        </React.Fragment>
      )}
    </>
  );
}
