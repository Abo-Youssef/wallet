-- Run as the schema owner in a dedicated wallet database, after npm run migrate.
-- Create wallet_app with SQL (not the Neon role-creation dashboard) first.
-- This file never creates users, stores passwords, or changes table ownership.
BEGIN;

DO $permissions$
DECLARE
  app_role pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO app_role FROM pg_catalog.pg_roles WHERE rolname = 'wallet_app';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Create the limited LOGIN role wallet_app using SQL before applying permissions.sql';
  END IF;
  IF NOT app_role.rolcanlogin OR app_role.rolsuper OR app_role.rolcreatedb
     OR app_role.rolcreaterole OR app_role.rolreplication OR app_role.rolbypassrls THEN
    RAISE EXCEPTION 'wallet_app must be a LOGIN role without administrative role attributes';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members WHERE member = app_role.oid) THEN
    RAISE EXCEPTION 'wallet_app must not inherit or be able to assume other database roles';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = current_database() AND datdba = app_role.oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspowner = app_role.oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE relowner = app_role.oid)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE proowner = app_role.oid) THEN
    RAISE EXCEPTION 'wallet_app must not own databases, schemas, tables, or functions';
  END IF;
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO wallet_app', current_database());
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM wallet_app', current_database());
END
$permissions$;

-- PUBLIC schema creation is enabled on some older PostgreSQL installations.
-- This dedicated application database must not give that privilege to everyone.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM wallet_app;
GRANT USAGE ON SCHEMA public TO wallet_app;

-- An explicit allowlist leaves schema_migrations and future tables ungranted.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM wallet_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.entities,
  public.agreements,
  public.payments,
  public.expenses,
  public.tasks,
  public.audit,
  public.hidden_audit,
  public.dismissed_alerts,
  public.mutation_requests,
  public.restore_control
TO wallet_app;

DO $functions$
DECLARE
  function_signature text;
BEGIN
  FOR function_signature IN
    SELECT p.oid::pg_catalog.regprocedure::text
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND left(p.proname, 7) = 'wallet_' AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', function_signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO wallet_app', function_signature);
  END LOOP;
END
$functions$;

COMMIT;
