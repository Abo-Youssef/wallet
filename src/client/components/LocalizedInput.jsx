import React, { useEffect, useRef } from "react";
import { normalizeDecimal, normalizeDigits, normalizeNumericInput } from "../../shared/numerals.mjs";

/** Native number fields discard Arabic digits before React can normalize them.
 * Use a text control + numeric keyboard and retain native form constraint validation.
 */
export default function LocalizedInput({ as = "input", type = "text", value, defaultValue, onChange, onBlur, onCompositionEnd, onPaste, ...props }) {
  const ref = useRef(null);
  const numeric = type === "number";
  const calendar = type === "date" || type === "month" || type === "time";
  const integer = numeric && String(props.step ?? 1) === "1";
  const normalize = numeric ? normalizeNumericInput : normalizeDigits;
  const validate = (element) => {
    if (!numeric || !element) return;
    let message = "";
    if (element.value) {
      try {
        const canonical = normalizeDecimal(element.value, { integer });
        const number = Number(canonical);
        if (!Number.isFinite(number) || (integer && !Number.isSafeInteger(number))) message = "الرقم خارج النطاق المسموح";
        else if (props.min !== undefined && number < Number(props.min)) message = `أقل قيمة مسموحة هي ${props.min}`;
        else if (props.max !== undefined && number > Number(props.max)) message = `أعلى قيمة مسموحة هي ${props.max}`;
      } catch (error) { message = error.message; }
    }
    element.setCustomValidity(message);
  };
  useEffect(() => { validate(ref.current); }, [value, defaultValue, props.min, props.max, integer]);
  const handleChange = (event) => {
    const element = event.currentTarget;
    const selection = element.selectionStart;
    const normalized = normalize(element.value);
    if (normalized !== element.value) {
      element.value = normalized;
      if (!calendar && selection != null) element.setSelectionRange(Math.min(selection, normalized.length), Math.min(selection, normalized.length));
    }
    validate(element);
    onChange?.(event);
  };
  const Component = as;
  return <Component
    {...props}
    ref={ref}
    {...(as === "input" ? { type: numeric ? "text" : type } : {})}
    {...(numeric ? { inputMode: integer ? "numeric" : "decimal", dir: "ltr", "data-numeric": integer ? "integer" : "decimal" } : {})}
    {...(calendar ? { lang: "en-GB", dir: "ltr" } : {})}
    {...(type === "tel" ? { dir: "ltr" } : {})}
    {...(value !== undefined ? { value: normalize(value) } : {})}
    {...(defaultValue !== undefined ? { defaultValue: normalize(defaultValue) } : {})}
    onChange={handleChange}
    onPaste={(event) => {
      onPaste?.(event);
      if (!calendar || event.defaultPrevented) return;
      const pasted = normalizeDigits(event.clipboardData.getData("text")).trim();
      const pattern = type === "date" ? /^\d{4}-\d{2}-\d{2}$/ : type === "month" ? /^\d{4}-\d{2}$/ : /^\d{2}:\d{2}(?::\d{2})?$/;
      if (!pattern.test(pasted)) return;
      // Preserve the native calendar and ISO value. Only normalize an explicit ISO paste.
      const previous = event.currentTarget.value;
      event.currentTarget.value = pasted;
      if (!event.currentTarget.value) { event.currentTarget.value = previous; return; }
      event.preventDefault();
      onChange?.(event);
    }}
    onBlur={(event) => {
      // Keep grouping while typing: removing the first comma too early would
      // corrupt the next group in a number such as 1,234,567.
      if (integer && event.currentTarget.value) {
        try {
          const canonical = normalizeDecimal(event.currentTarget.value, { integer: true });
          if (canonical !== event.currentTarget.value) {
            event.currentTarget.value = canonical;
            onChange?.(event);
          }
        } catch {}
      }
      validate(event.currentTarget);
      onBlur?.(event);
    }}
    onCompositionEnd={(event) => { handleChange(event); onCompositionEnd?.(event); }}
  />;
}
