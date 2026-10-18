import React, { useEffect, useRef, useState } from "react";
import { Home, Building2, Car, Users, Receipt, ArrowDownToLine, ArrowUpFromLine,
  Layers, Bell, CheckSquare, History, Download, RefreshCw, MoreHorizontal,
  Plus, ChevronLeft, UserRound, Archive, Eye, PenLine, LogOut } from "lucide-react";
import { useWallet } from "./state/WalletProvider.jsx";
import { Brand, Button } from "./components/ui.jsx";
import { PageHeading } from "./components/workspace.jsx";
import { ManagerHome, AssistantHome } from "./pages/Home.jsx";
import CashPage from "./pages/CashPage.jsx";
import DataPage from "./pages/DataPage.jsx";
import InvoicesPage from "./pages/InvoicesPage.jsx";
import FinancialDialogs from "./features/FinancialDialogs.jsx";
import OperationsDialogs from "./features/OperationsDialogs.jsx";
import AccessEntry from "./components/AccessEntry.jsx";
import { normalizeDigits } from "../shared/numerals.mjs";

const desktopNavigation = [
  ["home", "الرئيسية", Home], ["property", "العقارات", Building2],
  ["car", "السيارات", Car], ["worker", "العمال", Users],
  ["invoices", "الفواتير", Receipt], ["collect", "التحصيل", ArrowDownToLine],
  ["pay", "السداد", ArrowUpFromLine], ["other", "أخرى", Layers],
  ["closed", "الاتفاقات المغلقة", Archive],
];
const mobileNavigation = [
  ["property", "الأصول", Building2], ["car", "السيارات", Car],
  ["home", "الرئيسية", Home], ["sections", "البنود", Layers], ["more", "المزيد", MoreHorizontal],
];
const dataKinds = ["property", "car", "worker", "other", "closed"];

export default function App() {
  const { data, isAssistant, isWorkingMode, managerAssistantMode, setManagerAssistantMode,
    canManageData, loading, error, errorCode, requestedMonth, month, reload, open, dialog, updatedAt, logout, signingOut } = useWallet();
  const [page, setPage] = useState("home"), [dataKind, setDataKind] = useState("property");
  const main = useRef(null), firstPage = useRef(true), hasEntered = useRef(false);
  const accountName = normalizeDigits(data?.user?.name || data?.user?.email || "");
  const active = page === "data" ? dataKind : page;
  const mobileActive = ["home", "property", "car", "more"].includes(active) ? active : "sections";
  useEffect(() => { if (data) hasEntered.current = true; }, [data]);
  const navigate = (next, kind) => {
    if (next === "data" || dataKinds.includes(next)) {
      setDataKind(next === "data" ? kind || "property" : next); setPage("data");
    } else setPage(next);
  };
  useEffect(() => {
    if (firstPage.current) { firstPage.current = false; return; }
    main.current?.querySelector("h1")?.focus();
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [page, dataKind]);
  const tool = (type, label, Icon) => <button key={type} className="rail-tool" onClick={() => open(type)}>
    <Icon size={21} aria-hidden="true" /><span>{label}</span>
    {type === "alerts" && data?.alerts.length > 0 && <span className="count">{data.alerts.length}</span>}
  </button>;
  const changeMode = () => { setManagerAssistantMode(!managerAssistantMode); navigate("home"); };
  if (!data) return <AccessEntry loading={loading} error={error} errorCode={errorCode}
    onRetry={() => reload()} animated={!hasEntered.current} signingOut={signingOut} />;
  const title = desktopNavigation.find(item => item[0] === active)?.[1] || (page === "more" ? "المزيد" : "البنود");
  return <div className={page === "home" ? "app-shell home-theme" : "app-shell"}>
    <a className="skip-link" href="#main-content">تجاوز إلى المحتوى</a>
    {__PREVIEW__ && <div className="preview-banner">معاينة توضيحية دون حفظ <a href="?role=manager">المدير</a><a href="?role=assistant">المساعد</a></div>}
    <header className="app-header">
      <details className="header-profile">
        <summary aria-label={"الحساب: " + accountName} title={accountName}>
          <span className="avatar" aria-hidden="true"><UserRound size={19} /></span>
          <span className="header-account-label"><strong dir="auto">{accountName}</strong>
            <small>{isAssistant ? "المساعد" : managerAssistantMode ? "المدير · وضع المساعد" : "المدير · اطلاع"}</small></span>
        </summary>
        <div className="account-popover"><strong dir="auto">{accountName}</strong>
          {data.user.name && <span dir="ltr">{normalizeDigits(data.user.email)}</span>}
          <small>{isAssistant ? "حساب المساعد" : "حساب المدير"}</small>
          {!__PREVIEW__ && <Button variant="secondary" onClick={()=>logout()}><LogOut size={18} aria-hidden="true" />تسجيل الخروج</Button>}</div>
      </details>
      <Brand />
      <div className="header-actions"><button className="icon-button notification-button"
        aria-label={"التنبيهات (" + data.alerts.length + ")"} onClick={() => open("alerts")}>
        <Bell size={22} />{data.alerts.length > 0 && <span className="notification-count">{data.alerts.length > 99 ? "99+" : data.alerts.length}</span>}
      </button></div>
    </header>
    <aside className="sidebar rail" aria-label="القائمة الجانبية">
      <div className="rail-heading workspace-label">{isAssistant ? "مساحة المساعد" : "مساحة المدير"}</div>
      <nav className="primary-nav" aria-label="الأقسام الرئيسية">{desktopNavigation.map(([key, label, Icon]) =>
        <button key={key} onClick={() => navigate(key)} aria-current={active === key ? "page" : undefined}>
          <Icon size={21} aria-hidden="true" /><span>{label}</span>
        </button>)}</nav>
      <div className="rail-bottom">
        {tool("tasks", "المهام", CheckSquare)}
        <button className="rail-tool" onClick={() => navigate("more")} aria-current={page === "more" ? "page" : undefined}><MoreHorizontal size={21} /><span>المزيد</span></button>
        <div className="rail-profile"><span className="avatar">{isAssistant ? "م" : "د"}</span><div>
          <strong dir="auto" title={accountName}>{accountName}</strong><small>{isWorkingMode ? "إدارة ومتابعة" : "اطلاع فقط"}</small></div></div>
      </div>
    </aside>
    <main id="main-content" className={"main-content page-" + page} ref={main} aria-busy={loading}>
      <div className="workspace-bar"><span>{isAssistant ? "مساحة المساعد" : "مساحة المدير"}<ChevronLeft size={14} />{title}</span>
        <button className="sync-button" onClick={() => reload()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />
          {loading ? "جارٍ التحديث" : updatedAt ? "محدّث " + updatedAt.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Riyadh" }) : "تحديث البيانات"}</button></div>
      {!isAssistant && managerAssistantMode && <div className="manager-mode-banner" role="status">
        <span>وضع المساعد مفعّل. تُسجّل جميع عملياتك باسمك كمدير.</span><Button variant="secondary" onClick={changeMode}>العودة إلى وضع الاطلاع</Button>
      </div>}
      {loading && <div className="loading-line" role="status">جارٍ تحميل {requestedMonth}، الأرقام المعروضة تخص {month}.</div>}
      {error && <div className="error-banner" role="alert">{error}<Button onClick={() => reload()}>إعادة التحديث</Button></div>}
      {page === "home" ? (isWorkingMode ? <AssistantHome navigate={navigate} /> : <ManagerHome navigate={navigate} />)
        : page === "collect" || page === "pay" ? <CashPage key={page} direction={page === "collect" ? "in" : "out"} />
        : page === "data" ? <DataPage key={dataKind} initialKind={dataKind} scoped />
        : page === "invoices" ? <InvoicesPage />
        : page === "sections" ? <section className="section-hub">
          <PageHeading title="البنود" subtitle="العمال والفواتير والتحصيل والسداد وبقية الاتفاقات." />
          <div className="hub-links">{desktopNavigation.filter(([key]) => !["home", "property", "car"].includes(key)).map(([key, label, Icon]) =>
            <button key={key} onClick={() => navigate(key)}><Icon size={25} aria-hidden="true" /><span><strong>{label}</strong></span><ChevronLeft size={18} /></button>)}</div>
        </section>
        : <section className="section-hub">
          <PageHeading title="المزيد" subtitle="وضع العمل وأدوات المتابعة." />
          {!isAssistant && <button className="manager-mode-toggle" onClick={changeMode}>
            {managerAssistantMode ? <Eye size={24} /> : <PenLine size={24} />}<span>
              <strong>{managerAssistantMode ? "العودة إلى وضع الاطلاع" : "الدخول إلى وضع المساعد"}</strong>
              <small>{managerAssistantMode ? "إيقاف التعديل والعودة إلى نظرة المدير." : "تفعيل الإدخال والتحصيل والتعديل، مع تسجيل العمليات باسمك."}</small>
            </span></button>}
          <div className="hub-links">
            {tool("tasks", "المهام", CheckSquare)}{tool("alerts", "التنبيهات", Bell)}
            {!isAssistant && tool("history", "سجل العمليات", History)}{!isAssistant && tool("backup", "نسخة احتياطية", Download)}
            {!isAssistant && tool("restore", "استعادة نسخة احتياطية", ArrowUpFromLine)}
            <button onClick={() => reload()} disabled={loading}><RefreshCw size={21} /><span>تحديث البيانات</span></button>
            {!__PREVIEW__ && <button onClick={()=>logout()}><LogOut size={21} aria-hidden="true" /><span>تسجيل الخروج</span></button>}
          </div>
        </section>}
      <footer className="workspace-footer"><span dir="ltr" lang="en">my Wallet</span><span>الأرقام بالريال السعودي · التواريخ بتوقيت الرياض</span></footer>
    </main>
    <nav className="bottom-nav" aria-label="التنقل على الجوال">
      {mobileNavigation.map(([key, label, Icon]) => <button key={key} className={key === "home" ? "nav-home" : undefined}
        onClick={() => navigate(key)} aria-current={mobileActive === key ? "page" : undefined}>
        {key === "home" ? <span className="nav-app-icon" aria-hidden="true" dir="ltr">W</span> : <Icon size={23} aria-hidden="true" />}<span>{label}</span>
      </button>)}
    </nav>
    {canManageData && ["data", "collect", "pay", "invoices"].includes(page) && <button className="mobile-add" aria-label="إضافة جديدة" onClick={() => open("quickadd")}><Plus /></button>}
    {dialog && <React.Fragment key={JSON.stringify(dialog)}><FinancialDialogs dialog={dialog} /><OperationsDialogs dialog={dialog} /></React.Fragment>}
  </div>;
}
