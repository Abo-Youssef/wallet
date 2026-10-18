// Browser memory/request limit, not database capacity. Larger backups use pg_dump.
export const MAX_RESTORE_BYTES = 10_000_000;
export const MAX_RESTORE_LABEL = '10 MB';
