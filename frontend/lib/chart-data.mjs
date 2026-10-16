// Chart amounts remain integer halalas. Cash uses actual execution dates;
// scheduled dues and opening balances never enter this projection.
const MONTH = /^[1-9]\d{3}-(0[1-9]|1[0-2])$/;
const emptyTotals = () => ({ in: 0, out: 0, net: 0, count: 0 });

function daysInMonth(month) {
  if (typeof month !== "string" || !MONTH.test(month))
    throw new RangeError("صيغة شهر الرسم غير صحيحة");
  const [year, number] = month.split("-").map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    number - 1
  ];
}

function validCents(value) {
  if ((typeof value !== "number" && typeof value !== "string") || value === "")
    return null;
  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function safeAdd(left, right) {
  const value = left + right;
  if (!Number.isSafeInteger(value))
    throw new RangeError("إجماليات الرسم تتجاوز نطاق الأرقام الدقيق");
  return value;
}

function combine(target, source) {
  target.in = safeAdd(target.in, source.in);
  target.out = safeAdd(target.out, source.out);
  target.count = safeAdd(target.count, source.count);
  target.net = target.in - target.out;
  return target;
}

function summarize(month, days) {
  const weeks = [];
  const totals = emptyTotals();
  for (let start = 0; start < days.length; start += 7) {
    const chunk = days.slice(start, start + 7);
    const end = start + chunk.length;
    const week = {
      key: `${month}-w${weeks.length + 1}`,
      label: `${start + 1}–${end}`,
      start: chunk[0].date,
      end: chunk.at(-1).date,
      ...emptyTotals(),
    };
    for (const day of chunk) combine(week, day);
    weeks.push(week);
    combine(totals, week);
  }
  return { month, days, weeks, totals, hasActivity: totals.count > 0 };
}

export function buildCashChart(data, month = data.month) {
  const dayCount = daysInMonth(month);
  const days = Array.from({ length: dayCount }, (_, index) => ({
    date: `${month}-${String(index + 1).padStart(2, "0")}`,
    ...emptyTotals(),
  }));
  const byDate = new Map(days.map((day) => [day.date, day]));
  const agreements = new Map(
    (data.agreements || []).map((agreement) => [agreement.id, agreement]),
  );

  const record = (row, direction) => {
    if (Number(row.active ?? 1) !== 1) return;
    // Exact lookup excludes other months, impossible dates and timestamps.
    // paid_at is a calendar date in the API, not a created_at timestamp.
    const day = byDate.get(row.paid_at);
    if (!day) return;
    const amount = validCents(row.amount_cents);
    if (amount === null) return;
    day[direction] = safeAdd(day[direction], amount);
    day.count = safeAdd(day.count, 1);
    day.net = day.in - day.out;
  };
  try {
    for (const payment of data.payments || []) {
      const agreement = agreements.get(payment.agreement_id);
      if (agreement)
        record(payment, agreement.direction === "in" ? "in" : "out");
    }
    for (const expense of data.expenses || [])
      record(expense, expense.direction === "in" ? "in" : "out");
    return summarize(month, days);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    // Never display partial or rounded financial totals, and never crash the
    // React view. Callers render this error instead of the empty-state chart.
    const emptyDays = days.map(({ date }) => ({ date, ...emptyTotals() }));
    return { ...summarize(month, emptyDays), error: error.message };
  }
}

export function buildDueComparison(summary = {}) {
  return [
    ["in", "التحصيل"],
    ["out", "السداد"],
  ].map(([direction, label]) => {
    const due = validCents(summary[`due_${direction}`]) ?? 0;
    const fulfilled = validCents(summary[`fulfilled_${direction}`]) ?? 0;
    const remaining = validCents(summary[`remaining_${direction}`]) ?? 0;
    // This is completion of the month's scheduled dues, never cash / dues.
    const percent = due
      ? Math.min(100, Math.max(0, (fulfilled / due) * 100))
      : 0;
    return { direction, label, due, fulfilled, remaining, percent };
  });
}
