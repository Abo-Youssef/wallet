import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDigits, normalizeDecimal, inputCents } from '../src/shared/numerals.mjs';
import { parseMoney } from '../src/shared/finance.mjs';
import { fmtDate, monthName, money } from '../src/client/lib/format.js';
import { formatRiyadhDate } from '../src/shared/client-model.mjs';
import { statementCSV, statementHTML } from '../src/shared/statements.mjs';

test('Arabic and Persian financial input has identical exact cents on client and API', () => {
  const cases = [['١٢٣٤٫٥٠', 123450], ['۱٬۲۳۴٫۵۰', 123450], ['1,234.50', 123450], ['1 234.50', 123450], ['١\u202f٢٣٤٫٥٠', 123450], ['٠٫٠١', 1], ['٠٠١٫١٠', 110], ['99,999,999,999.99', 9999999999999]];
  for (const [input, expected] of cases) {
    assert.equal(inputCents(input), expected, input);
    assert.equal(parseMoney(input), expected, input);
  }
  assert.equal(money(parseMoney('١٢٣٤٫٥٠')), '1,234.50');
});

test('malformed or ambiguous grouping is rejected, never silently reinterpreted', () => {
  for (const value of ['', '1,23', '1234,50', '1,234,56', '1,234 567', '1.234,50', '١٫٢٫٣', '1,234.567', '1 23', '-١', '١e٣', '0x10', true, null, {}]) {
    assert.throws(() => inputCents(value), String(value));
    assert.throws(() => parseMoney(value), String(value));
  }
});

test('identifier normalization preserves leading zeros, punctuation, and text', () => {
  assert.equal(normalizeDigits('٠٠١۲٣-أ / ٠٥٠١٢٣٤٥٦٧'), '00123-أ / 0501234567');
  assert.equal(normalizeDecimal('۱٬۲۳۴', { integer: true }), '1234');
  assert.throws(() => normalizeDecimal('1.5', { integer: true }));
});

test('Arabic dates retain Gregorian and Riyadh date behavior with Latin digits', () => {
  for (const value of [fmtDate('2026-10-17'), monthName('2026-10'), formatRiyadhDate('2026-10-16T22:00:00Z')]) {
    assert.match(value, /2026/);
    assert.doesNotMatch(value, /[٠-٩۰-۹]/);
  }
  assert.equal(formatRiyadhDate('2026-10-16T22:00:00Z'), fmtDate('2026-10-17'));
});

test('reports normalize legacy text without mutating source or weakening CSV/HTML escaping', () => {
  const statement = { month: '2026-10', summary: {}, transactions: [{ date: '2026-10-17', type: 'تحصيل', title: '=١+١', entity: '<شقة ٠٠١>', direction: 'in', amount_cents: 123450, note: 'عقد ۱۲۳' }] };
  const original = structuredClone(statement);
  const csv = statementCSV(statement), html = statementHTML(statement);
  assert.doesNotMatch(csv + html, /[٠-٩۰-۹]/);
  assert.match(csv, /"'=1\+1"/);
  assert.match(html, /&lt;شقة 001&gt;/);
  assert.match(html, /1,234.50/);
  assert.deepEqual(statement, original);
});
