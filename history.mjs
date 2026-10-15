// Shared by the live API and the offline preview. Audit dates use Riyadh time.
export const HISTORY_PAGE_SIZE = 50;
const check = (ok, message) => { if (!ok) throw Object.assign(new Error(message),{code:400}); };
function validDate(value) {
  return /^[1-9]\d{3}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(`${value}T12:00:00Z`)) &&
    new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
}
export function historyPeriod(period, today) {
  check(validDate(today), 'التاريخ الحالي غير صحيح');
  const previous = new Date(`${today}T12:00:00Z`);
  previous.setUTCDate(previous.getUTCDate() - 6);
  const ranges = {
    all: ['', ''], today: [today, today],
    week: [previous.toISOString().slice(0, 10), today],
    month: [`${today.slice(0, 7)}-01`, today],
    year: [`${today.slice(0, 4)}-01-01`, today]
  };
  check(period in ranges, 'الفترة غير صحيحة');
  return {from: ranges[period][0], to: ranges[period][1]};
}
export function parseHistoryFilters(params) {
  const from = params.get('from') || '', to = params.get('to') || '';
  const sort = params.get('sort') || 'newest';
  check(!from || validDate(from), 'تاريخ البداية غير صحيح');
  check(!to || validDate(to), 'تاريخ النهاية غير صحيح');
  check(!from || !to || from <= to, 'تاريخ البداية يجب ألا يتجاوز تاريخ النهاية');
  check(['newest', 'oldest'].includes(sort), 'ترتيب السجل غير صحيح');
  const rawLimit = params.get('limit') ?? String(HISTORY_PAGE_SIZE);
  check(/^\d+$/.test(rawLimit) && Number(rawLimit) >= 1 && Number(rawLimit) <= 100, 'عدد النتائج يجب أن يكون بين 1 و100');
  const query = {
    from, to, sort, limit: Number(rawLimit), cursor: null,
    fromUTC: from ? new Date(`${from}T00:00:00.000+03:00`).toISOString() : null,
    toUTC: to ? new Date(`${to}T23:59:59.999+03:00`).toISOString() : null
  };
  const cursor = params.get('cursor');
  if (cursor) {
    try {
      check(cursor.length <= 1024, '');
      const value = JSON.parse(atob(cursor));
      check(Array.isArray(value) && value.length === 5, '');
      const [at, id, cursorFrom, cursorTo, cursorSort] = value;
      check(typeof at === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) && new Date(at).toISOString() === at, '');
      check(typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id), '');
      check(cursorFrom === from && cursorTo === to && cursorSort === sort, '');
      query.cursor = {at, id};
    } catch { throw Object.assign(new Error('رابط متابعة السجل غير صحيح؛ أعد تطبيق الفترة'),{code:400}); }
  }
  return query;
}
export function historyPage(rows, query) {
  const has_more = rows.length > query.limit;
  const entries = rows.slice(0, query.limit);
  const last = entries.at(-1);
  return {
    entries, has_more,
    next_cursor: has_more ? btoa(JSON.stringify([last.created_at, last.id, query.from, query.to, query.sort])) : null,
    filters: {from: query.from, to: query.to, sort: query.sort, timezone: 'Asia/Riyadh'}
  };
}
export function filterHistory(entries, query) {
  const compare = (a, b) => a === b ? 0 : a < b ? -1 : 1;
  const direction = query.sort === 'oldest' ? 1 : -1;
  const rows = entries.filter(entry => {
    if (query.fromUTC && entry.created_at < query.fromUTC) return false;
    if (query.toUTC && entry.created_at > query.toUTC) return false;
    if (!query.cursor) return true;
    return direction * (compare(entry.created_at, query.cursor.at) || compare(entry.id, query.cursor.id)) > 0;
  }).sort((a, b) => direction * (compare(a.created_at, b.created_at) || compare(a.id, b.id)));
  return historyPage(rows, query);
}
