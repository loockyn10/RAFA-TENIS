-- Sprint 15 — procesos programados de notificaciones (recordatorios + despacho de push).
--
-- ESTE ARCHIVO NO SE EJECUTA SOLO. No es una migración: activa procesos remotos y por eso lo corre una persona, a mano, en el
-- SQL Editor de Supabase, DESPUÉS de aplicar la migración 20261015000000 y de desplegar la Edge Function `dispatch-push`.
-- Nada de lo que contiene está activado hoy. Ver docs/CURRENT_STATE.md, «Sprint 15 — pasos de activación».
--
-- Requisitos (Dashboard → Database → Extensions): `pg_cron` y `pg_net` habilitadas. Vault ya viene incluido en Supabase.

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 1. Secretos en Vault (una sola vez). NO pegar los valores reales en Git, en tickets ni en el chat.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
--   select vault.create_secret('<mismo valor que el secreto PUSH_DISPATCH_SECRET de la Edge Function>', 'push_dispatch_secret');
--   select vault.create_secret('https://<PROJECT_REF>.supabase.co', 'project_url');
--   select vault.create_secret('<anon / publishable key del proyecto (es pública)>', 'anon_key');
--  El gateway recibe la clave anon mediante el encabezado apikey.
-- Authorization utiliza la misma clave anon legacy en formato JWT.
-- La autorización del despachador se valida mediante x-dispatch-secret.

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 2. Recordatorios de reservas: cada hora (minuto 5), avisa ~24 h antes (1440 min). Cambiar el 1440 cambia la anticipación
--    (60–10080). Es idempotente: ejecutarla de más no duplica avisos. No recuerda reservas canceladas, pasadas, sin persona
--    vinculada a una cuenta, ni creadas dentro de la propia ventana.
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
select cron.schedule(
  'rafa-reservation-reminders',
  '5 * * * *',
  $$ select public.generate_reservation_reminders(1440) $$
);

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 3. Despacho de push: cada minuto, solo si hay entregas pendientes (sin entregas no hace ninguna llamada HTTP).
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
select cron.schedule(
  'rafa-push-dispatch',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/dispatch-push',
    headers := jsonb_build_object(
  'Content-Type', 'application/json',

  'apikey', (
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'anon_key'
  ),

  'Authorization', 'Bearer ' || (
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'anon_key'
  ),

  'x-dispatch-secret', (
    SELECT decrypted_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_dispatch_secret'
  )
),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  )
  where exists (
    select 1 from public.push_deliveries
    where (status = 'pending' and next_attempt_at <= now()) or (status = 'sending' and locked_until < now())
  );
  $$
);

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 4. Verificación (solo lectura)
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
--   select jobname, schedule, active from cron.job where jobname like 'rafa-%';
--   select jobname, status, start_time, return_message from cron.job_run_details d join cron.job j using (jobid) where j.jobname like 'rafa-%' order by start_time desc limit 20;
--   select status, count(*) from public.push_deliveries group by status;

-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
-- 5. Desactivar
-- ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
--   select cron.unschedule('rafa-reservation-reminders');
--   select cron.unschedule('rafa-push-dispatch');
