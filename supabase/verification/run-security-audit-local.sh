#!/usr/bin/env bash
# Sprint 10B — auditoría de seguridad dinámica contra un PostgreSQL REAL y DESCARTABLE (sin Docker, NO Supabase).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un superusuario.
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde.
# Crea (y reemplaza si existe) la base `rafa_tenis_audit_10b`. NUNCA apuntar a una base con datos reales
# ni a Supabase: el guion crea roles/usuarios de prueba y borra la base.
#
# Pasos:
#   1. Stub de Supabase + TODAS las migraciones (estado actual del repositorio).
#   2. security-audit-dynamic.sql: matriz de roles (owner/admin/staff/jugadores A y B/sin vínculo/anon, dos clubes).
#   3. Concurrencia con dos sesiones: pagos de cuota, pagos de cantina, solape de reservas, límite de reservas
#      online por persona y atomicidad de series.
#   4. Canje de invitaciones con la función real (desde Sprint 10B.1 ya no se parchea nada): un solo uso,
#      concurrencia, vencimiento y revocación.
# Tras las migraciones de Sprint 10B.1 la matriz solo debe dejar la decisión de producto D008 y los hallazgos
# SEC-06…SEC-13 aún abiertos (ver docs/SECURITY_AUDIT.md): el script no falla por ellos.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_audit_10b"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
TMP="${TMPDIR:-/tmp}"

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql" 2>&1 | grep -v NOTICE
# Matriz de la auditoría 10B: valida el estado hasta Sprint 10B.1. Sprint 10B.2 cambia las firmas de los pagos
# (clave idempotente obligatoria); se verifica con run-sprint-10b2-local.sh.
for f in "$MIGRATIONS"/*.sql; do
  b="$(basename "$f")"; [[ "${b:0:14}" > "20261014050000" ]] && continue
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>&1 || { echo "FALLO al aplicar $f"; exit 1; }
done

echo "== Matriz de roles (security-audit-dynamic.sql)"
psql -X -d "$DB" -f "$HERE/security-audit-dynamic.sql" 2>&1 | sed -n '/RESUMEN POR/,$p'

# ---------- Concurrencia ----------
OWNER_A="a0000000-0000-0000-0000-000000000001"; STAFF_A="a0000000-0000-0000-0000-000000000003"; DUAL="a0000000-0000-0000-0000-000000000009"
CLUB_A="c0000000-0000-0000-0000-00000000000a"; COURT1="d0000000-0000-0000-0000-000000000001"; COURT2="d0000000-0000-0000-0000-000000000002"
sess() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$1',false);"; }
q() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
# race <uid> <sql-A> <sql-B> : A abre una transacción, ejecuta y espera 3 s antes de confirmar; B arranca 1 s después.
race() {
  local uid="$1" a="$2" b="$3"
  "${PSQL[@]}" -d "$DB" -c "begin; $(sess "$uid") $a select pg_sleep(3); commit;" >"$TMP/audit_a.out" 2>&1 &
  local pid=$!; sleep 1
  "${PSQL[@]}" -d "$DB" -c "$(sess "$uid") $b" >"$TMP/audit_b.out" 2>&1; RC_B=$?
  wait "$pid"; RC_A=$?
}
verdict() { # nombre esperado-regex actual
  if [[ "$3" =~ $2 ]]; then echo "  OK    $1 -> $3"; else echo "  FALLA $1 -> $3 (esperado /$2/)"; fi
}

echo "== C1: dos pagos simultáneos de cuota que juntos exceden el saldo (500000; 300000 + 300000)"
DUE="$(q "select d.id from public.membership_dues d join public.club_memberships m on m.id=d.membership_id where m.person_id='e0000000-0000-0000-0000-000000000002'")"
SQL="select public.record_membership_due_payment('$CLUB_A','$DUE',300000,current_date,'cash');"
race "$OWNER_A" "$SQL" "$SQL"
verdict "una sola sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "suma de pagos válidos <= importe" "^300000$" "$(q "select coalesce(sum(amount_cents),0) from public.membership_due_payments where due_id='$DUE' and voided_at is null")"

echo "== C2: dos pagos simultáneos de cantina sobre un consumo pendiente (5 x 120000 = 600000; 400000 + 400000)"
PROD="$(q "select id from public.canteen_products where name='Agua'")"
SALE="$(q "set role authenticated; select set_config('request.jwt.claim.sub','$STAFF_A',false); select (public.create_canteen_sale('$CLUB_A', jsonb_build_array(jsonb_build_object('product_id','$PROD','quantity',5)), 'e0000000-0000-0000-0000-000000000002')).id" | tail -1)"
SQL="select public.record_canteen_sale_payment('$CLUB_A','$SALE',400000,current_date,'cash');"
race "$STAFF_A" "$SQL" "$SQL"
verdict "una sola sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "suma de pagos <= total" "^400000$" "$(q "select coalesce(sum(amount_cents),0) from public.canteen_sale_payments where sale_id='$SALE'")"

echo "== C3: dos inserciones solapadas simultáneas en la misma cancha (agenda única, exclusión GiST)"
D3="(date_trunc('day', now()) + interval '9 day 13 hour')"
SQLA="insert into public.reservations(club_id,court_id,customer_name,starts_at,ends_at) values ('$CLUB_A','$COURT1','Carrera A',$D3,$D3 + interval '1 hour');"
SQLB="insert into public.reservations(club_id,court_id,customer_name,starts_at,ends_at) values ('$CLUB_A','$COURT1','Carrera B',$D3 + interval '30 minutes',$D3 + interval '90 minutes');"
race "$STAFF_A" "$SQLA" "$SQLB"
verdict "una sola inserción tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
grep -q "reservations_occupied_court_no_overlap" "$TMP/audit_b.out" && echo "  OK    la sesión perdedora fue rechazada por la exclusión GiST" || echo "  FALLA la sesión B no devolvió el error de exclusión"

echo "== C4: límite de reservas online por persona (max 1) con dos reservas simultáneas de la misma persona"
q "update public.club_online_booking_settings set max_active_reservations = 1 where club_id='$CLUB_A'" >/dev/null
T4="(date_trunc('day', now() at time zone 'America/Argentina/Buenos_Aires') + interval '5 day 16 hour') at time zone 'America/Argentina/Buenos_Aires'"
SQLA="select public.create_player_reservation('$CLUB_A','$COURT1',$T4,60::smallint);"
SQLB="select public.create_player_reservation('$CLUB_A','$COURT2',$T4,60::smallint);"
race "$DUAL" "$SQLA" "$SQLB"
verdict "una sola reserva online quedó confirmada" "^1$" "$(q "select count(*) from public.reservations where person_id='e0000000-0000-0000-0000-000000000009' and occupation_type='reservation' and status='confirmed' and starts_at > now() and created_by='$DUAL'")"

echo "== C5: serie semanal atómica (la ocurrencia 3 choca con un bloqueo): no debe quedar NADA de la serie"
B4="(date_trunc('day', now()) + interval '30 day 14 hour')"
q "insert into public.reservations(club_id,court_id,starts_at,ends_at,status,occupation_type,block_reason,created_by) values ('$CLUB_A','$COURT2',$B4 + interval '14 day',$B4 + interval '14 day 1 hour','active','block','mantenimiento','$OWNER_A')" >/dev/null
BEFORE="$(q "select (select count(*) from public.reservation_series)||'/'||(select count(*) from public.reservations)")"
"${PSQL[@]}" -d "$DB" -c "$(sess "$STAFF_A") select * from public.create_weekly_reservation_series('$CLUB_A','$COURT2','Serie',null,$B4,$B4 + interval '1 hour',4::smallint);" >"$TMP/audit_s.out" 2>&1 || true
AFTER="$(q "select (select count(*) from public.reservation_series)||'/'||(select count(*) from public.reservations)")"
verdict "series/reservas antes y después idénticas" "^$BEFORE\$" "$AFTER"

echo "== C6: canje de invitaciones con la función REAL del repositorio (migración 20261014020000)"
q "insert into auth.users(id,email) values ('a0000000-0000-0000-0000-00000000000b','x1@t'),('a0000000-0000-0000-0000-00000000000c','x2@t') on conflict do nothing" >/dev/null
NEWP="e0000000-0000-0000-0000-0000000000f1"
q "insert into public.club_people(id,club_id,full_name) values ('$NEWP','$CLUB_A','Invitada concurrente') on conflict do nothing" >/dev/null
mkcode() { q "set role authenticated; select set_config('request.jwt.claim.sub','$OWNER_A',false); select (public.create_player_invitation('$CLUB_A','$1', now() + interval '$2'))->>'code'" | tail -1; }
CODE="$(mkcode "$NEWP" "1 day")"
SQLA="select public.redeem_player_invitation('$CODE');"
"${PSQL[@]}" -d "$DB" -c "begin; $(sess a0000000-0000-0000-0000-00000000000b) $SQLA select pg_sleep(3); commit;" >"$TMP/audit_a.out" 2>&1 & PID=$!; sleep 1
"${PSQL[@]}" -d "$DB" -c "$(sess a0000000-0000-0000-0000-00000000000c) $SQLA" >"$TMP/audit_b.out" 2>&1; RC_B=$?; wait "$PID"; RC_A=$?
verdict "canje concurrente: un solo ganador" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "vínculos de la persona = 1" "^1$" "$(q "select count(*) from public.club_person_auth_links where person_id='$NEWP'")"
RC3="$("${PSQL[@]}" -d "$DB" -c "$(sess a0000000-0000-0000-0000-000000000008) $SQLA" 2>&1 | grep -o 'No pudimos validar' | head -1)"
verdict "reutilizar un código ya canjeado" "No pudimos validar" "$RC3"
NEWP2="e0000000-0000-0000-0000-0000000000f2"; q "insert into public.club_people(id,club_id,full_name) values ('$NEWP2','$CLUB_A','Invitada revocada') on conflict do nothing" >/dev/null
CODE2="$(mkcode "$NEWP2" "1 day")"
q "update public.player_invitations set revoked_at = now(), revoked_by='$OWNER_A' where token_hash = encode(extensions.digest('$CODE2','sha256'),'hex')" >/dev/null
RC4="$("${PSQL[@]}" -d "$DB" -c "$(sess a0000000-0000-0000-0000-000000000008) select public.redeem_player_invitation('$CODE2');" 2>&1 | grep -o 'No pudimos validar' | head -1)"
verdict "código revocado" "No pudimos validar" "$RC4"
CODE3="$(mkcode "$NEWP2" "1 day")"
q "update public.player_invitations set expires_at = now() - interval '1 minute' where token_hash = encode(extensions.digest('$CODE3','sha256'),'hex')" >/dev/null
RC5="$("${PSQL[@]}" -d "$DB" -c "$(sess a0000000-0000-0000-0000-000000000008) select public.redeem_player_invitation('$CODE3');" 2>&1 | grep -o 'No pudimos validar' | head -1)"
verdict "código vencido" "No pudimos validar" "$RC5"
echo "== Fin. Los hallazgos de la matriz de roles están documentados en docs/SECURITY_AUDIT.md"
