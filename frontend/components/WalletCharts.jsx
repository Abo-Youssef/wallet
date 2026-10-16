import React, { useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ChartNoAxesCombined } from "lucide-react";
import { Money } from "./ui.jsx";
import { fmtDate, money, monthName } from "../lib/format.js";
import { buildCashChart, buildDueComparison } from "../lib/chart-data.mjs";
import "./charts.css";

const compact = new Intl.NumberFormat("ar-SA", {
  notation: "compact",
  maximumFractionDigits: 1,
});
function axisNumber(cents) {
  const value = cents / 100;
  return value >= 10000
    ? compact.format(value)
    : cents > 0 && cents < 1
      ? value.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : money(cents);
}
function chartCeiling(value) {
  if (!value) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}
function DateRange({ start, end }) {
  return (
    <span>
      <bdi>{fmtDate(start)}</bdi> <span aria-hidden="true">←</span>
      <span className="sr-only"> إلى </span> <bdi>{fmtDate(end)}</bdi>
    </span>
  );
}

export function CashFlowChart({ data, month = data.month }) {
  const chart = useMemo(() => buildCashChart(data, month), [data, month]);
  const [selection, setSelection] = useState(null);
  const id = useId(),
    buttons = useRef([]);
  const selectedIndex = chart.weeks.findIndex(
    (week) => selection?.month === chart.month && week.key === selection.key,
  );
  const lastActive = chart.weeks.findLastIndex((week) => week.count > 0);
  const activeIndex =
    selectedIndex >= 0 ? selectedIndex : Math.max(0, lastActive);
  const active = chart.weeks[activeIndex];
  const choose = (index) =>
    setSelection({ month: chart.month, key: chart.weeks[index].key });
  const max = chartCeiling(
    Math.max(0, ...chart.weeks.flatMap((week) => [week.in, week.out])),
  );
  const plot = { left: 70, top: 16, width: 440, height: 174 },
    bin = plot.width / chart.weeks.length;
  const barWidth = Math.min(23, bin * 0.26),
    baseline = plot.top + plot.height;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const keySelect = (event, index) => {
    let next = index;
    if (event.key === "ArrowLeft") next = Math.max(0, index - 1);
    else if (event.key === "ArrowRight")
      next = Math.min(chart.weeks.length - 1, index + 1);
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = chart.weeks.length - 1;
    else if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    choose(next);
    buttons.current[next]?.focus?.();
  };
  return (
    <section
      className="wallet-chart cash-flow-chart"
      aria-labelledby={`${id}-heading`}
    >
      <div className="chart-heading">
        <h3 id={`${id}-heading`}>حركة النقد خلال الشهر</h3>
        <div className="chart-legend" aria-label="مفتاح الرسم">
          <span>
            <i className="chart-dot chart-dot-in" />
            داخل
          </span>
          <span>
            <i className="chart-dot chart-dot-out" />
            خارج
          </span>
        </div>
      </div>
      <p className="chart-caption">
        حركات منفّذة في {monthName(chart.month)}، مجمّعة كل 7 أيام.
      </p>
      {chart.error ? (
        <p className="form-error" role="alert">
          تعذر عرض الرسم بدقة: {chart.error}
        </p>
      ) : !chart.hasActivity ? (
        <div className="chart-empty">
          <ChartNoAxesCombined size={28} aria-hidden="true" />
          <p>لم تُسجّل حركات نقدية خلال هذا الشهر.</p>
          <small>يظهر الرسم عند تسجيل تحصيل أو سداد أو مصروف مباشر.</small>
        </div>
      ) : (
        <>
          <div className="chart-plot">
            <svg
              className="cash-flow-svg"
              viewBox="0 0 530 234"
              role="group"
              aria-labelledby={`${id}-heading`}
              aria-describedby={`${id}-help`}
              direction="ltr"
            >
              {ticks.map((tick) => {
                const y = baseline - tick * plot.height;
                return (
                  <g key={tick} aria-hidden="true">
                    <line
                      className="chart-gridline"
                      x1={plot.left}
                      x2={plot.left + plot.width}
                      y1={y}
                      y2={y}
                    />
                    <text
                      className="chart-axis-label"
                      x={plot.left - 10}
                      y={y + 4}
                      textAnchor="end"
                    >
                      {axisNumber(max * tick)}
                    </text>
                  </g>
                );
              })}
              {chart.weeks.map((week, index) => {
                const center = plot.left + bin * (index + 0.5),
                  inHeight = (week.in / max) * plot.height,
                  outHeight = (week.out / max) * plot.height,
                  chosen = index === activeIndex;
                return (
                  <g
                    key={week.key}
                    ref={(node) => {
                      buttons.current[index] = node;
                    }}
                    role="button"
                    tabIndex={chosen ? 0 : -1}
                    aria-pressed={chosen}
                    aria-label={`الفترة ${week.label} من ${monthName(chart.month)}، داخل ${money(week.in)} ريال، خارج ${money(week.out)} ريال`}
                    className={`chart-week ${chosen ? "is-selected" : ""}`}
                    onClick={() => choose(index)}
                    onKeyDown={(event) => keySelect(event, index)}
                  >
                    <rect
                      className="chart-week-target"
                      x={center - bin / 2 + 3}
                      y={plot.top - 8}
                      width={bin - 6}
                      height={plot.height + 43}
                      rx="9"
                    />
                    <rect
                      className="chart-bar chart-bar-in"
                      x={center - barWidth - 3}
                      y={baseline - inHeight}
                      width={barWidth}
                      height={inHeight}
                      rx="3"
                    />
                    <rect
                      className="chart-bar chart-bar-out"
                      x={center + 3}
                      y={baseline - outHeight}
                      width={barWidth}
                      height={outHeight}
                      rx="3"
                    />
                    <text
                      className="chart-week-label"
                      x={center}
                      y={baseline + 27}
                      textAnchor="middle"
                      aria-hidden="true"
                    >
                      {week.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
          <p id={`${id}-help`} className="chart-axis-note">
            الأيام من اليسار إلى اليمين · المقياس بالريال
            <span className="sr-only">
              . اختر فترة من القائمة أو الرسم. استخدم سهمي اليمين واليسار للتنقل
              داخل الرسم.
            </span>
          </p>
          <div className="chart-period-controls">
            <button
              type="button"
              className="chart-period-button"
              aria-label="الفترة السابقة"
              disabled={activeIndex === 0}
              onClick={() => choose(activeIndex - 1)}
            >
              <ChevronRight size={19} />
            </button>
            <label htmlFor={`${id}-period`} className="sr-only">
              فترة الحركات المعروضة
            </label>
            <select
              id={`${id}-period`}
              value={active.key}
              onChange={(event) =>
                choose(
                  chart.weeks.findIndex(
                    (week) => week.key === event.target.value,
                  ),
                )
              }
            >
              {chart.weeks.map((week) => (
                <option key={week.key} value={week.key}>
                  من {Number(week.start.slice(-2))} إلى{" "}
                  {Number(week.end.slice(-2))} {monthName(chart.month)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="chart-period-button"
              aria-label="الفترة التالية"
              disabled={activeIndex === chart.weeks.length - 1}
              onClick={() => choose(activeIndex + 1)}
            >
              <ChevronLeft size={19} />
            </button>
          </div>
          <div
            className="chart-selected-period"
            role="region"
            aria-label="أرقام الفترة المختارة"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="chart-selected-label">
              <DateRange start={active.start} end={active.end} /> ·{" "}
              {active.count} حركة
            </p>
            <dl className="chart-selected-values">
              <div>
                <dt>
                  <i className="chart-dot chart-dot-in" />
                  داخل
                </dt>
                <dd>
                  <Money value={active.in} />
                </dd>
              </div>
              <div>
                <dt>
                  <i className="chart-dot chart-dot-out" />
                  خارج
                </dt>
                <dd>
                  <Money value={active.out} />
                </dd>
              </div>
              <div>
                <dt>صافي الحركة</dt>
                <dd>
                  <Money value={active.net} />
                </dd>
              </div>
            </dl>
          </div>
          <details className="chart-data-details">
            <summary>عرض الأرقام لكل الفترات</summary>
            <div
              className="chart-table-wrap"
              tabIndex={0}
              role="region"
              aria-label="الأرقام التفصيلية لحركة النقد"
            >
              <table className="chart-data-table">
                <caption className="sr-only">
                  حركة النقد خلال {monthName(chart.month)}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">الأيام</th>
                    <th scope="col">داخل</th>
                    <th scope="col">خارج</th>
                    <th scope="col">الصافي</th>
                    <th scope="col">الحركات</th>
                  </tr>
                </thead>
                <tbody>
                  {chart.weeks.map((week) => (
                    <tr
                      key={week.key}
                      aria-current={
                        week.key === active.key ? "true" : undefined
                      }
                    >
                      <th scope="row">
                        <bdi>{week.label}</bdi>
                      </th>
                      <td>
                        <Money value={week.in} />
                      </td>
                      <td>
                        <Money value={week.out} />
                      </td>
                      <td>
                        <Money value={week.net} />
                      </td>
                      <td>{week.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}

export function DueComparisonChart({ summary, month }) {
  const rows = useMemo(() => buildDueComparison(summary), [summary]),
    max = Math.max(0, ...rows.map((row) => row.due)),
    id = useId();
  return (
    <section
      className="wallet-chart due-comparison-panel"
      aria-labelledby={`${id}-heading`}
    >
      <div className="chart-heading">
        <h3 id={`${id}-heading`}>مقارنة استحقاقات الشهر</h3>
        <span className="chart-month">{monthName(month)}</span>
      </div>
      <p className="chart-caption">
        المنفّذ والمتبقي من هذه الاستحقاقات، بمقياس واحد للتحصيل والسداد.
      </p>
      {max === 0 ? (
        <div className="chart-empty">
          <ChartNoAxesCombined size={28} aria-hidden="true" />
          <p>لا توجد استحقاقات في هذا الشهر.</p>
        </div>
      ) : (
        <>
          <div className="chart-legend due-chart-legend">
            <span>
              <i className="chart-dot chart-dot-in" />
              منفّذ من الاستحقاق
            </span>
            <span>
              <i className="chart-dot chart-dot-remaining" />
              متبقٍ
            </span>
          </div>
          <div className="due-chart-rows">
            {rows.map((row) => (
              <div className="due-chart-row" key={row.direction}>
                <div className="due-chart-row-heading">
                  <strong>{row.label}</strong>
                  <span>
                    {row.due > 0
                      ? `${Math.round(row.percent)}٪ منفّذ`
                      : "لا استحقاق"}
                  </span>
                </div>
                <div
                  className="due-chart-track"
                  role="img"
                  aria-label={`${row.label}: مستحق ${money(row.due)} ريال، منفذ ${money(row.fulfilled)} ريال، متبقٍ ${money(row.remaining)} ريال`}
                >
                  <div
                    className="due-chart-size"
                    style={{ width: `${(row.due / max) * 100}%` }}
                  >
                    <span
                      className="due-chart-fulfilled"
                      style={{
                        width: `${row.due ? (row.fulfilled / row.due) * 100 : 0}%`,
                      }}
                    />
                    <span
                      className="due-chart-remaining"
                      style={{
                        width: `${row.due ? (row.remaining / row.due) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <dl className="due-chart-values">
                  <div>
                    <dt>المستحق</dt>
                    <dd>
                      <Money value={row.due} />
                    </dd>
                  </div>
                  <div>
                    <dt>المنفّذ</dt>
                    <dd>
                      <Money value={row.fulfilled} />
                    </dd>
                  </div>
                  <div>
                    <dt>المتبقي</dt>
                    <dd>
                      <Money value={row.remaining} />
                    </dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="chart-footnote">
        هذه مقارنة للاستحقاقات؛ راجع «حركة النقد» لمعرفة ما دخل وخرج خلال الشهر.
      </p>
    </section>
  );
}
