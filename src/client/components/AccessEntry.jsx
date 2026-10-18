import React from "react";
import { LoaderCircle, LockKeyhole, RefreshCw } from "lucide-react";
import { Brand, Button } from "./ui.jsx";
import { ACCESS_LOGOUT_PATH } from "../lib/session.js";

// The real sign-in is Cloudflare Access, before the protected app is served.
// This screen covers bootstrap and recovery only; it never collects credentials
// or holds the app open for an animation once verified data has arrived.
export default function AccessEntry({
  loading = false,
  error = "",
  errorCode = null,
  onRetry,
  animated = true,
  signingOut = false,
}) {
  const expired = errorCode === 401;
  const forbidden = errorCode === 403;
  return (
    <main className="startup entry-screen" aria-busy={loading}>
      <div className="entry-brand-stage">
        <Brand animated={animated && loading} />
      </div>
      <section className="entry-content" aria-labelledby="access-entry-title">
        {signingOut ? <>
          <LockKeyhole size={24} aria-hidden="true" />
          <h1 id="access-entry-title">جارٍ تسجيل الخروج</h1>
          <p role="status">ستنتقل إلى بوابة الدخول لإنهاء الجلسة.</p>
          <a className="button button-primary" href={ACCESS_LOGOUT_PATH}>متابعة تسجيل الخروج</a>
        </> : error ? (
          <>
            <LockKeyhole size={24} aria-hidden="true" />
            <h1 id="access-entry-title">
              {expired
                ? "سجّل الدخول من جديد"
                : forbidden
                  ? "هذا الحساب غير مخوّل"
                  : "تعذر فتح المحفظة"}
            </h1>
            <p role="alert">{error}</p>
            <div className="form-actions">
              {expired && (
                <a className="button button-primary" href="/">
                  العودة إلى تسجيل الدخول
                </a>
              )}
              {forbidden && <a className="button button-secondary" href={ACCESS_LOGOUT_PATH}>تسجيل الخروج وتغيير الحساب</a>}
              <Button
                variant={expired ? "secondary" : "primary"}
                disabled={loading}
                onClick={onRetry}
              >
                <RefreshCw size={17} aria-hidden="true" />
                إعادة المحاولة
              </Button>
            </div>
          </>
        ) : (
          <>
            <h1 id="access-entry-title">محفظتك، بوضوح</h1>
            <p role="status" className="entry-status">
              <LoaderCircle size={18} className="spin" aria-hidden="true" />
              جارٍ فتح محفظتك…
            </p>
          </>
        )}
      </section>
    </main>
  );
}
