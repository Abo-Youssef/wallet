import React, { useId, useMemo } from "react";
import { buildCashChart } from "../lib/chart-data.mjs";
import { fmtDate, money, monthName } from "../lib/format.js";

const plot = { left: 76, top: 18, width: 526, height: 170 };
const baseline = plot.top + plot.height;
const compactAmount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const axisAmount = (cents) => cents >= 100000 ? compactAmount.format(cents / 100) : money(cents);

function cumulativeCash(data, month) {
  let chart;
  try {
    chart = buildCashChart(data, month);
  } catch (error) {
    return { error: error.message };
  }
  if (chart.error) return chart;
  const lastActivity = chart.days.findLastIndex((day) => day.count > 0);
  const elapsedDays = !data.today || month < data.today.slice(0, 7)
    ? chart.days.length
    : month === data.today.slice(0, 7) ? Number(data.today.slice(-2)) : 0;
  // Trim only unrecorded future days. Recorded cash must agree with the monthly
  // summary even when its entered paid_at date is later than today's date.
  const days = chart.days.slice(0, Math.max(elapsedDays, lastActivity + 1));
  let incoming = 0, outgoing = 0, count = 0;
  const points = days.map((day) => {
    incoming += day.in;
    outgoing += day.out;
    count += day.count;
    return { date: day.date, in: incoming, out: outgoing };
  });
  // buildCashChart already checks every daily and monthly sum in integer cents.
  // Non-negative cumulative values cannot exceed those validated totals.
  return { points, hasActivity: count > 0, incoming, outgoing };
}

export function HomeCashFlow({ data, month = data.month }) {
  const chart = useMemo(() => cumulativeCash(data, month), [data, month]);
  const id = useId();
  if (chart.error) return <p className="home-cash-error form-error" role="alert">تعذر عرض الرسم بدقة: {chart.error}</p>;
  if (!chart.hasActivity) return <div className="home-cash-empty"><p>لم تُسجّل حركات نقدية خلال هذا الشهر.</p></div>;

  const { points, incoming, outgoing } = chart;
  const max = Math.max(incoming, outgoing, 100);
  const x = (index) => plot.left + plot.width * (index + 1) / points.length;
  const y = (cents) => baseline - (cents / max) * plot.height;
  const line = (direction) => `M ${plot.left} ${baseline} ` + points.map((point, index) => `L ${x(index)} ${y(point[direction])}`).join(" ");
  const dates = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];
  const end = points.at(-1);
  const title = `حركة النقد التراكمية في ${monthName(month)}`;
  const description = `من ${fmtDate(points[0].date)} إلى ${fmtDate(end.date)}. داخل ${money(incoming)} ريال، خارج ${money(outgoing)} ريال. الأيام من اليسار إلى اليمين، والمقياس بالريال. حركات منفّذة فقط؛ لا يشمل الرسم الأرصدة الافتتاحية أو الاستحقاقات المستقبلية.`;
  return (
    <figure className="home-cash-chart">
      <figcaption className="home-cash-caption">
        <span>تراكمي · حتى <bdi>{fmtDate(end.date)}</bdi></span>
        <span className="home-cash-legend" aria-label="مفتاح الرسم">
          <span><i className="home-cash-key-in" aria-hidden="true" />داخل</span>
          <span><i className="home-cash-key-out" aria-hidden="true" />خارج</span>
        </span>
      </figcaption>
      <svg className="home-cash-svg" width="100%" viewBox="0 0 620 234" role="img" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} direction="ltr">
        <title id={`${id}-title`}>{title}</title>
        <desc id={`${id}-description`}>{description}</desc>
        <defs><linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#4169E1" stopOpacity="0.2" /><stop offset="100%" stopColor="#4169E1" stopOpacity="0" /></linearGradient></defs>
        <g aria-hidden="true">
          {[0, 0.5, 1].map((ratio) => <g key={ratio}>
            <line className="home-cash-gridline" x1={plot.left} x2={plot.left + plot.width} y1={y(max * ratio)} y2={y(max * ratio)} />
            <text className="home-cash-axis" x={plot.left - 12} y={y(max * ratio) + 4} textAnchor="end">{axisAmount(Math.round(max * ratio))}</text>
          </g>)}
          <path className="home-cash-area" d={`${line("in")} L ${plot.left + plot.width} ${baseline} Z`} fill={`url(#${id}-fill)`} />
          <path className="home-cash-line-in" d={line("in")} stroke="#4169E1" strokeWidth="3" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <path className="home-cash-line-out" d={line("out")} stroke="#C7A85C" strokeWidth="2.5" fill="none" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          <circle className="home-cash-endpoint-in" cx={x(points.length - 1)} cy={y(incoming)} r="4" fill="#4169E1" />
          <circle className="home-cash-endpoint-out" cx={x(points.length - 1)} cy={y(outgoing)} r="4" fill="#C7A85C" />
          {dates.map((index) => <text className="home-cash-axis" key={points[index].date} x={x(index)} y={baseline + 28} textAnchor={index === points.length - 1 ? "end" : "middle"}>{Number(points[index].date.slice(-2))}</text>)}
        </g>
      </svg>
    </figure>
  );
}
