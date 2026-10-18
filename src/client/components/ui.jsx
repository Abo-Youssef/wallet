import React, { useEffect, useId, useRef, useState } from "react";
import { X, ArrowLeft, LoaderCircle, Check, Wallet } from "lucide-react";
import { money } from "../lib/format.js";
import LocalizedInput from "./LocalizedInput.jsx";
import { useWallet, WalletToast } from "../state/WalletProvider.jsx";
export function Money({ value, className = "" }) {
  const formatted = money(value);
  return (
    <span
      className={`money ${formatted.length > 9 ? "money-long" : ""} ${className}`}
    >
      <bdi>{formatted}</bdi>
      <small>ر.س</small>
    </span>
  );
}
export function Badge({ children, tone }) {
  const inferred = String(children).includes("متأخر")
    ? "danger"
    : String(children).includes("مكتمل") || children === "مسدد"
      ? "success"
      : "neutral";
  return <span className={`badge ${tone || inferred}`}>{children}</span>;
}
export function Empty({ children }) {
  return (
    <div className="empty">
      <Check size={24} />
      <p>{children}</p>
    </div>
  );
}
export function Button({
  children,
  variant = "secondary",
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={`button button-${variant} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
export function Field({ label, children, hint }) {
  const generatedId = useId(),
    id = children?.props?.id || generatedId;
  const fieldProps = { id, "aria-describedby": hint ? `${id}-hint` : children?.props?.["aria-describedby"] };
  const localized = React.isValidElement(children) && ["input", "textarea"].includes(children.type) &&
    !["checkbox", "radio", "file", "hidden", "password"].includes(children.props.type);
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {localized ? <LocalizedInput as={children.type} {...children.props} {...fieldProps} /> : React.isValidElement(children)
        ? React.cloneElement(children, {
            ...fieldProps,
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function Modal({
  title,
  children,
  onClose,
  dirty = false,
  busy = false,
  wide = false,
  uncertain = false,
}) {
  const ref = useRef(null),
    titleId = useId(),
    [confirmClose, setConfirmClose] = useState(false);
  const closeRef = useRef(null);
  closeRef.current = () => {
    if (busy) return;
    if (dirty) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };
  useEffect(() => {
    const element = ref.current,
      previous = document.activeElement;
    element.showModal();
    document.body.classList.add("dialog-open");
    return () => {
      element.close();
      document.body.classList.remove("dialog-open");
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const box = ref.current.getBoundingClientRect();
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            closeRef.current();
        }
      }}
    >
      <header className="modal-head">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="إغلاق"
          disabled={busy}
          onClick={() => closeRef.current()}
        >
          <X size={21} />
        </button>
      </header>
      {confirmClose && (
        <div className="stack">
          <h3>هل تريد ترك التغييرات؟</h3>
          <p className="muted">
            {uncertain
              ? "لم تصل نتيجة الحفظ. راجع السجل قبل إنشاء العملية من جديد، أو ابقَ هنا وأعد المحاولة لتأكيدها."
              : "لم تُحفظ البيانات المدخلة بعد."}
          </p>
          <div className="form-actions">
            <Button onClick={() => setConfirmClose(false)} variant="primary">
              متابعة الإدخال
            </Button>
            <Button variant="danger" onClick={onClose}>
              ترك التغييرات
            </Button>
          </div>
        </div>
      )}
      <div hidden={confirmClose}>{children}</div>
      <WalletToast />
    </dialog>
  );
}
export function useFormMutation() {
  const { mutate } = useWallet(),
    [pending, setPending] = useState(false),
    [uncertain, setUncertain] = useState(false),
    [error, setError] = useState(""),
    [errorCode, setErrorCode] = useState(null),
    busy = useRef(false),
    retry = useRef(null);
  const submit = async (path, body, onSuccess, method = "POST") => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    setErrorCode(null);
    const payload = retry.current || {
      path,
      body: structuredClone(body),
      method,
    };
    try {
      const result = await mutate(payload.path, payload.body, payload.method);
      retry.current = null;
      setUncertain(false);
      onSuccess?.(result);
      return result;
    } catch (cause) {
      if (cause.uncertain) {
        retry.current = payload;
        setUncertain(true);
      } else {
        retry.current = null;
        setUncertain(false);
      }
      setError(cause.message);
      setErrorCode(cause.code || null);
      return null;
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { submit, pending, uncertain, error, errorCode };
}
export function Brand({ animated = false, className = "" }) {
  return (
    <span className={`brand ${animated ? "brand-animated" : ""} ${className}`} dir="ltr" lang="en" role="img" aria-label="my Wallet">
      <span className="brand-wordmark" aria-hidden="true">
        <span className="brand-my">my</span>
        <span className="brand-word"><span className="brand-w">W</span><span className="brand-tail-clip"><span className="brand-tail">allet</span></span></span>
      </span>
    </span>
  );
}
export function ProgressRing({ paid = 0, total = 0, semi = false, children }) {
  const percent = total ? Math.max(0, Math.min(100, (paid / total) * 100)) : 0;
  return (
    <div
      className={`progress-ring ${semi ? "semi" : ""}`}
      role="img"
      aria-label={`نسبة التنفيذ ${Math.round(percent)}٪`}
    >
      <svg viewBox={semi ? "0 0 160 94" : "0 0 160 160"} aria-hidden="true">
        {semi ? (
          <>
            <path
              className="ring-track"
              d="M 15 80 A 65 65 0 0 1 145 80"
              pathLength="100"
            />
            <path
              className="ring-fill"
              opacity={percent === 0 ? 0 : 1}
              d="M 15 80 A 65 65 0 0 1 145 80"
              pathLength="100"
              strokeDasharray={`${percent} 100`}
            />
          </>
        ) : (
          <>
            <circle className="ring-track" cx="80" cy="80" r="65" />
            <circle
              className="ring-fill"
              opacity={percent === 0 ? 0 : 1}
              cx="80"
              cy="80"
              r="65"
              pathLength="100"
              strokeDasharray={`${percent} 100`}
              transform="rotate(-90 80 80)"
            />
          </>
        )}
      </svg>
      <div className="ring-content">
        {children || (
          <>
            <strong>
              {Math.round(percent)}
              <small>٪</small>
            </strong>
            <span>تم التنفيذ</span>
          </>
        )}
      </div>
    </div>
  );
}
export function SectionHead({ title, subtitle, children }) {
  return (
    <div className="section-head">
      <div>
        {subtitle && <p className="eyebrow">{subtitle}</p>}
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}
