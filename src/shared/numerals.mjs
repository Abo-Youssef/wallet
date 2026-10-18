/** Presentation/input normalization only: identifiers stay strings, including leading zeros. */
export function normalizeDigits(value) {
  return String(value ?? '')
    .replace(/[٠-٩]/g, character => String(character.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, character => String(character.charCodeAt(0) - 0x6f0));
}

/** Keep grouping while editing so an incomplete or malformed number is never silently accepted. */
export function normalizeNumericInput(value) {
  return normalizeDigits(value).replace(/٫/g, '.').replace(/٬/g, ',')
    .replace(/[\u00a0\u202f\u2009]/g, ' ');
}

/** Decimal separator: . or ٫. Grouping: , / ٬ / spaces, in complete groups of three.
 * A comma is deliberately never guessed to mean a decimal separator.
 */
export function normalizeDecimal(value, { integer = false, maxDecimals = 2 } = {}) {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('نوع القيمة غير صحيح');
  const text = normalizeNumericInput(value).trim();
  const parts = text.split('.');
  if (parts.length > 2 || (integer && parts.length > 1)) throw new Error('صيغة الرقم غير صحيحة');
  const whole = parts[0], fraction = parts[1];
  const plain = /^\d+$/.test(whole);
  const grouped = /^\d{1,3}(?:,\d{3})+$/.test(whole) || /^\d{1,3}(?: \d{3})+$/.test(whole);
  if ((!plain && !grouped) || (fraction !== undefined && !new RegExp(`^\\d{1,${maxDecimals}}$`).test(fraction))) {
    throw new Error(integer ? 'أدخل عددًا صحيحًا؛ مثال: 1,234' : 'أدخل مبلغًا صحيحًا؛ مثال: 1,234.50');
  }
  return whole.replace(/[, ]/g, '') + (fraction === undefined ? '' : `.${fraction}`);
}

// Keep input comparisons in integer halalas, matching the API's money format.
export function inputCents(value) {
  const text=normalizeDecimal(value);
  if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error('أدخل مبلغًا صحيحًا بحد أقصى منزلتين عشريتين');
  const [whole,fraction='']=text.split('.');
  const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount<0||amount>1e13)throw new Error('المبلغ خارج النطاق المسموح');
  return amount;
}
