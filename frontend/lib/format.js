import { entityReference } from "../../public/client-model.mjs";
export const money = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
export const toInput = (cents) => (Number(cents || 0) / 100).toFixed(2);
export const fmtDate = (date) =>
  date
    ? new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
    : "—";
export const monthName = (month) =>
  new Intl.DateTimeFormat("ar-SA-u-ca-gregory", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month}-15T12:00:00Z`));
export const entityById = (data, id) => entityReference(data, id);
export const agreementById = (data, id) =>
  data?.agreements?.find((item) => item.id === id);
export function plusDays(date, days) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export const currentMonth = () =>
  new Date()
    .toLocaleDateString("sv-SE", { timeZone: "Asia/Riyadh" })
    .slice(0, 7);
