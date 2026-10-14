SELECT
  (
    SELECT n.nspname
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname = 'pgcrypto'
  ) AS pgcrypto_schema,

  (
    SELECT count(*)
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private')
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'EXECUTE')
  ) AS rpc_accesibles_anon,

  (
    SELECT count(*)
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  ) AS tablas_sin_rls,

  (
    SELECT count(*)
    FROM information_schema.role_table_grants
    WHERE table_schema = 'public'
      AND grantee = 'anon'
  ) AS permisos_tablas_anon,

  (
    SELECT count(*)
    FROM supabase_migrations.schema_migrations
  ) AS migraciones_aplicadas,

  (
    SELECT count(*)
    FROM (
      SELECT d.id
      FROM public.membership_dues d
      JOIN public.membership_due_payments p
        ON p.due_id = d.id
      GROUP BY d.id, d.amount_cents
      HAVING COALESCE(
        SUM(p.amount_cents)
        FILTER (WHERE p.voided_at IS NULL), 0
      ) > d.amount_cents
    ) AS errores
  ) AS cuotas_sobrepagadas;