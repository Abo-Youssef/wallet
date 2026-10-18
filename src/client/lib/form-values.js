import { normalizeDecimal } from "../../shared/numerals.mjs";

/** Normalize only numeric quantities, never phone numbers or other identifiers.
 * This also covers Enter submission while the editing control still has focus.
 */
export function readFormValues(form) {
  const values = Object.fromEntries(new FormData(form));
  for (const field of form.elements) {
    if (!field.dataset?.numeric || !Object.hasOwn(values, field.name) || values[field.name] === "") continue;
    try {
      values[field.name] = normalizeDecimal(values[field.name], { integer: field.dataset.numeric === "integer" });
    } catch {
      // Keep malformed input intact for native form validation / API rejection.
      // Never reinterpret or partially parse an invalid amount.
    }
  }
  return values;
}
