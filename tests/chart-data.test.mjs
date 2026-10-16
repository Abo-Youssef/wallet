import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCashChart,
  buildDueComparison,
} from "../frontend/lib/chart-data.mjs";
import { currentSummary } from "../src/finance.mjs";

const agreement = (id, direction, extra = {}) => ({
  id,
  direction,
  status: "active",
  kind: "other",
  title: id,
  total_cents: 100000,
  opening_cents: 50000,
  installment_count: 2,
  frequency_months: 1,
  first_due_date: "2026-10-20",
  ...extra,
});
const payment = (id, agreement_id, amount_cents, paid_at, extra = {}) => ({
  id,
  agreement_id,
  amount_cents,
  paid_at,
  active: 1,
  slot_index: 0,
  created_at: `${paid_at}T10:00:00.000Z`,
  ...extra,
});
const sum = (items, key) => items.reduce((total, item) => total + item[key], 0);

test("Cash chart agrees with actual-cash summary and excludes opening capital and planned dates", () => {
  const agreements = [agreement("income", "in"), agreement("outgoing", "out")];
  const payments = [
    payment("p1", "income", 110, "2026-10-01"),
    payment("p2", "outgoing", 111, "2026-10-08"),
    payment("p3", "outgoing", 999, "2026-09-20"),
  ];
  const expenses = [
    { id: "e1", amount_cents: 240, paid_at: "2026-10-15", active: 1 },
  ];
  const chart = buildCashChart({
    month: "2026-10",
    agreements,
    payments,
    expenses,
  });
  const { summary } = currentSummary(
    agreements,
    payments,
    expenses,
    "2026-10",
    "2026-10-15",
  );
  assert.deepEqual(chart.totals, { in: 110, out: 351, net: -241, count: 3 });
  assert.equal(chart.totals.in, summary.cash_in);
  assert.equal(chart.totals.out, summary.cash_out);
  assert.equal(chart.totals.net, summary.net);
  assert.equal(chart.days[19].count, 0); // due date did not create cash
  assert.equal(chart.hasActivity, true);
});

test("Closed agreements retain real cash, voided payments and unknown agreements do not", () => {
  const data = {
    month: "2026-10",
    agreements: [
      agreement("closed", "in", { closed_at: "2026-10-02T12:00:00Z" }),
    ],
    payments: [
      payment("real", "closed", 100, "2026-10-01"),
      payment("voided", "closed", 999, "2026-10-01", { active: 0 }),
      payment("voided-string", "closed", 888, "2026-10-01", { active: "0" }),
      payment("missing", "absent", 777, "2026-10-01"),
    ],
    expenses: [],
  };
  assert.deepEqual(buildCashChart(data).totals, {
    in: 100,
    out: 0,
    net: 100,
    count: 1,
  });
});

test("Direct expenses default to outgoing and explicit incoming rows remain incoming", () => {
  const chart = buildCashChart({
    month: "2026-10",
    expenses: [
      { amount_cents: 110, paid_at: "2026-10-03" },
      { amount_cents: 11, paid_at: "2026-10-03", direction: "in", active: "1" },
      { amount_cents: 50, paid_at: "2026-10-03", direction: "out", active: 1 },
      { amount_cents: 900, paid_at: "2026-10-03", active: 0 },
    ],
  });
  assert.deepEqual(chart.days[2], {
    date: "2026-10-03",
    in: 11,
    out: 160,
    net: -149,
    count: 3,
  });
  assert.deepEqual(chart.totals, { in: 11, out: 160, net: -149, count: 3 });
});

test("All calendar days exist and February uses Gregorian leap-year rules", () => {
  for (const [month, length] of [
    ["2024-02", 29],
    ["2026-02", 28],
    ["2000-02", 29],
    ["2100-02", 28],
    ["2026-04", 30],
    ["2026-12", 31],
  ]) {
    const chart = buildCashChart({ month });
    assert.equal(chart.days.length, length);
    assert.equal(chart.days[0].date, `${month}-01`);
    assert.equal(chart.days.at(-1).date, `${month}-${length}`);
    assert.equal(chart.hasActivity, false);
    assert.deepEqual(chart.totals, { in: 0, out: 0, net: 0, count: 0 });
  }
});

test("Invalid dates, timestamp strings, other months and other years cannot leak into cash", () => {
  const expenses = [
    "2024-02-29",
    "2024-02-30",
    "2024-02-00",
    "2024-2-01",
    "2024-02-1",
    "2024-02-01T00:00:00Z",
    "2024-03-01",
    "2023-02-01",
    null,
  ].map((paid_at) => ({ paid_at, amount_cents: 1 }));
  const chart = buildCashChart({ month: "2024-02", expenses });
  assert.equal(chart.totals.count, 1);
  assert.equal(chart.totals.out, 1);
  assert.equal(chart.days[28].out, 1);
  assert.equal(
    buildCashChart({
      month: "2026-02",
      expenses: [{ paid_at: "2026-02-29", amount_cents: 10 }],
    }).hasActivity,
    false,
  );
});

test("An explicit selected month isolates execution dates across a year boundary", () => {
  const data = {
    month: "2026-12",
    agreements: [agreement("a", "in")],
    payments: [
      payment("dec", "a", 110, "2026-12-31"),
      payment("jan", "a", 220, "2027-01-01"),
    ],
  };
  assert.deepEqual(buildCashChart(data).totals, {
    in: 110,
    out: 0,
    net: 110,
    count: 1,
  });
  const january = buildCashChart(data, "2027-01");
  assert.equal(january.month, "2027-01");
  assert.deepEqual(january.totals, { in: 220, out: 0, net: 220, count: 1 });
  assert.equal(data.month, "2026-12");
});

test("Weekly chunks conserve every halala, operation count and day without gaps or overlaps", () => {
  const expenses = Array.from({ length: 31 }, (_, index) => ({
    paid_at: `2026-10-${String(index + 1).padStart(2, "0")}`,
    amount_cents: index + 1,
    direction: index % 2 ? "in" : "out",
  }));
  const chart = buildCashChart({ month: "2026-10", expenses });
  assert.deepEqual(
    chart.weeks.map(({ key, label, start, end }) => ({
      key,
      label,
      start,
      end,
    })),
    [
      {
        key: "2026-10-w1",
        label: "1–7",
        start: "2026-10-01",
        end: "2026-10-07",
      },
      {
        key: "2026-10-w2",
        label: "8–14",
        start: "2026-10-08",
        end: "2026-10-14",
      },
      {
        key: "2026-10-w3",
        label: "15–21",
        start: "2026-10-15",
        end: "2026-10-21",
      },
      {
        key: "2026-10-w4",
        label: "22–28",
        start: "2026-10-22",
        end: "2026-10-28",
      },
      {
        key: "2026-10-w5",
        label: "29–31",
        start: "2026-10-29",
        end: "2026-10-31",
      },
    ],
  );
  for (const key of ["in", "out", "net", "count"]) {
    assert.equal(sum(chart.days, key), chart.totals[key]);
    assert.equal(sum(chart.weeks, key), chart.totals[key]);
  }
  assert.equal(chart.totals.count, 31);
  assert.equal(chart.totals.in + chart.totals.out, 496);
  const leap = buildCashChart({ month: "2024-02" });
  assert.equal(leap.weeks.at(-1).label, "29–29");
  assert.equal(leap.weeks.at(-1).start, leap.weeks.at(-1).end);
});

test("Fractional, negative or unsafe cents never produce misleading rounded chart values", () => {
  const expenses = [
    1.1,
    -1,
    NaN,
    Infinity,
    Number.MAX_SAFE_INTEGER + 1,
    null,
    true,
    {},
    "",
  ].map((amount_cents) => ({ amount_cents, paid_at: "2026-10-01" }));
  expenses.push({ amount_cents: "110", paid_at: "2026-10-01" });
  assert.deepEqual(buildCashChart({ month: "2026-10", expenses }).totals, {
    in: 0,
    out: 110,
    net: -110,
    count: 1,
  });
  const overflow = buildCashChart({
    month: "2026-10",
    expenses: [
      { amount_cents: Number.MAX_SAFE_INTEGER, paid_at: "2026-10-01" },
      { amount_cents: 1, paid_at: "2026-10-08" },
    ],
  });
  assert.match(overflow.error, /نطاق الأرقام الدقيق/);
  assert.deepEqual(overflow.totals, { in: 0, out: 0, net: 0, count: 0 });
  assert.equal(overflow.hasActivity, false);
  assert.equal(overflow.days.length, 31);
  assert.ok(
    overflow.days.every(
      (day) => day.in === 0 && day.out === 0 && day.count === 0,
    ),
  );
});

test("Actual paid_at controls inclusion even if future-dated or created in another month", () => {
  const data = {
    month: "2026-12",
    today: "2026-12-01",
    agreements: [
      agreement("closed", "in", {
        entity_id: "archived",
        closed_at: "2026-12-01T12:00:00Z",
      }),
    ],
    archived_entities: [{ id: "archived", kind: "car", name: "أصل مؤرشف" }],
    payments: [
      payment("future", "closed", 110, "2026-12-31", {
        created_at: "2026-11-01T10:00:00Z",
      }),
      payment("previous", "closed", 220, "2026-11-30", {
        created_at: "2026-12-01T10:00:00Z",
      }),
    ],
    expenses: [{ amount_cents: 999, paid_at: "2026-12-01", active: "0" }],
  };
  const chart = buildCashChart(data);
  assert.deepEqual(chart.totals, { in: 110, out: 0, net: 110, count: 1 });
  assert.equal(chart.days[30].in, 110);
  assert.equal(chart.days[0].count, 0);
});

test("Malformed months fail clearly instead of creating an invalid or guessed period", () => {
  for (const month of [
    "",
    undefined,
    "2026-00",
    "2026-13",
    "2026-2",
    "26-02",
    "0099-02",
    "2026-10-01",
  ])
    assert.throws(() => buildCashChart({ month }), /صيغة شهر الرسم/);
});

test("Due comparison uses only monthly dues and fulfilled values, never cash or opening balances", () => {
  const summary = {
    due_in: 10000,
    fulfilled_in: 2500,
    remaining_in: 7500,
    due_out: 110,
    fulfilled_out: 110,
    remaining_out: 0,
    cash_in: 999999,
    cash_out: 500000,
    net: 499999,
    overdue_in: 12345,
    future_out: 67890,
    opening_cents: 90000,
  };
  assert.deepEqual(buildDueComparison(summary), [
    {
      direction: "in",
      label: "التحصيل",
      due: 10000,
      fulfilled: 2500,
      remaining: 7500,
      percent: 25,
    },
    {
      direction: "out",
      label: "السداد",
      due: 110,
      fulfilled: 110,
      remaining: 0,
      percent: 100,
    },
  ]);
});

test("Due comparison preserves server remaining independently and zero-due completion is zero", () => {
  const rows = buildDueComparison({
    due_in: 0,
    fulfilled_in: 0,
    remaining_in: 0,
    due_out: 300,
    fulfilled_out: 100,
    remaining_out: 197,
  });
  assert.equal(rows[0].percent, 0);
  assert.equal(rows[1].percent, (100 / 300) * 100);
  assert.equal(rows[1].remaining, 197); // do not silently recalculate API summary
  assert.deepEqual(
    buildDueComparison().map((row) => [
      row.due,
      row.fulfilled,
      row.remaining,
      row.percent,
    ]),
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  );
});
