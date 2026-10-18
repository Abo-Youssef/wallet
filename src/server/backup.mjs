import {inspectBackup} from './integrity.mjs';

export const BACKUP_TABLES = ['entities','agreements','payments','expenses','tasks','audit','hidden_audit','dismissed_alerts','mutation_requests'];
export const BACKUP_FORMAT = 2;
export const BACKUP_SCHEMA = 9;
export const BOOKING_DEFAULTS = {rental_mode:'period',booking_cancelled_at:null,booking_cancelled_by:null,booking_cancel_note:null};
export function upgradeBackupData(data) {
  return {...data,
    entities:data.schema_version===6 ? data.entities.map(e=>({...e,property_type:null})) : data.entities,
    agreements:data.schema_version<9 ? data.agreements.map(a=>({...BOOKING_DEFAULTS,...a})) : data.agreements};
}
export {MAX_RESTORE_BYTES} from '../shared/backup-limits.mjs';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const canonicalJSON = value => JSON.stringify(canonical(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
export async function backupDigest(data) {
  const {integrity, ...payload} = data;
  const bytes = new TextEncoder().encode(canonicalJSON(payload));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2,'0')).join('');
}
export async function sealBackup(data) {
  return {...data, integrity: {algorithm:'SHA-256', digest:await backupDigest(data)}};
}

// Older exports remain inspectable. Restoration requires the complete current
// schema, including retry receipts; never silently discard unknown columns.
export async function verifyBackup(data, {forRestore = false} = {}) {
  const report = inspectBackup(data);
  const issue = (table, id, reason) => report.issues.push({table, id:id ?? null, reason});
  if (!record(data)) return {...report, checksum:'absent', restore_supported:false};
  const supported = data.format_version === BACKUP_FORMAT && [6,7,8,BACKUP_SCHEMA].includes(data.schema_version);
  if (forRestore && !supported) issue(null,null,'الاستعادة تدعم النسخة الكاملة بصيغة 2 ومخطط 6 إلى 9؛ الملف الأقدم يحتاج ترحيلًا منفصلًا');
  if (supported) {
    if (typeof data.exported_at !== 'string' || !Number.isFinite(Date.parse(data.exported_at))) issue(null,null,'تاريخ تصدير النسخة غير صحيح');
    if (data.timezone !== 'Asia/Riyadh') issue(null,null,'المنطقة الزمنية للنسخة غير مدعومة');
  }
  if (supported || data.mutation_requests !== undefined) {
    if (!Array.isArray(data.mutation_requests)) issue('mutation_requests',null,'جدول إيصالات الطلبات مفقود أو غير صحيح');
    else {
      report.counts.mutation_requests = data.mutation_requests.length;
      const ids = new Set();
      for (const row of data.mutation_requests) {
        if (!record(row)) { issue('mutation_requests',null,'إيصال بتنسيق غير صحيح'); continue; }
        if (typeof row.request_id !== 'string' || !row.request_id || ids.has(row.request_id)) issue('mutation_requests',row.request_id,'معرف إيصال مفقود أو مكرر');
        ids.add(row.request_id);
        if (typeof row.actor !== 'string' || !row.actor.trim() || typeof row.scope !== 'string' || !row.scope.trim() ||
          typeof row.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(row.fingerprint) ||
          typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) issue('mutation_requests',row.request_id,'بيانات إيصال الطلب غير صحيحة');
        try { if (typeof row.response_json !== 'string' || !record(JSON.parse(row.response_json))) throw new Error(); }
        catch { issue('mutation_requests',row.request_id,'استجابة إيصال الطلب ليست JSON صالحًا'); }
      }
    }
  }
  let checksum = 'absent';
  if (data.integrity !== undefined) {
    checksum = record(data.integrity) && data.integrity.algorithm === 'SHA-256' &&
      typeof data.integrity.digest === 'string' && data.integrity.digest === await backupDigest(data) ? 'verified' : 'invalid';
    if (checksum === 'invalid') issue(null,null,'بصمة النسخة غير مطابقة؛ الملف تغيّر أو تلف');
  }
  return {...report, ok:report.issues.length === 0, checksum, restore_supported:supported};
}
