#!/usr/bin/env bash
# Sprint 15 — verifica Novedades, notificaciones, push (cola/entregas) y recordatorios contra un PostgreSQL REAL y DESCARTABLE (sin Docker, NO Supabase).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un superusuario.
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde, TMPDIR.
# Crea (y reemplaza si existe) la base `rafa_tenis_verify_15`. NUNCA apuntar a una base con datos reales ni a Supabase.
# Pasos: stub de Supabase (con storage mínimo) + migraciones 01…20261015000000, sprint-15-news-notifications-push-checks.sql y concurrencia con dos sesiones.
# NO prueba: envío push real (Edge Function + servicio push del navegador), PostgREST, JWT reales ni el servicio Storage real.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_verify_15"
export PGCLIENTENCODING=UTF8 PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
TMP="${TMPDIR:-/tmp}"
FAILS=0

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql" 2>&1 | grep -v NOTICE
echo "== Migraciones"
for f in "$MIGRATIONS"/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$TMP/mig15.err" || { echo "FALLO al aplicar $(basename "$f")"; cat "$TMP/mig15.err"; exit 1; }
done

echo "== Verificaciones"
OUT="$(psql -X -q -d "$DB" -f "$HERE/sprint-15-news-notifications-push-checks.sql" 2>&1)"
echo "$OUT" | sed -n '/^ *area/,$p'
echo "$OUT" | grep -i "^psql:.*ERROR" && FAILS=$((FAILS+1))
NO_CUMPLE="$(echo "$OUT" | grep -E '^ +TOTAL' | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
[[ "${NO_CUMPLE:-1}" -eq 0 ]] || FAILS=$((FAILS+1))

# ---------- Concurrencia ----------
q() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
sess() { echo "set role $2; select set_config('request.jwt.claim.sub','$1',false);"; }
verdict() { if [[ "$3" =~ $2 ]]; then echo "  OK    $1 -> $3"; else echo "  FALLA $1 -> $3 (esperado /$2/)"; FAILS=$((FAILS+1)); fi; }
# race <uid> <role> <sqlA> <sqlB>: A abre una transacción, ejecuta y espera 3 s antes de confirmar; B arranca 1 s después.
race() {
  "${PSQL[@]}" -d "$DB" -c "begin; $(sess "$1" "$2") $3 select pg_sleep(3); commit;" >"$TMP/b15_a.out" 2>&1 &
  local pid=$!; sleep 1
  "${PSQL[@]}" -d "$DB" -At -c "$(sess "$1" "$2") $4" >"$TMP/b15_b.out" 2>&1; RC_B=$?
  wait "$pid"; RC_A=$?
}
OWNER="a0000000-0000-0000-0000-000000000001"; CA="c0000000-0000-0000-0000-00000000000a"
key() { printf 'f1500000-0000-0000-0000-%012d' "$1"; }
A87="$(printf 'A%.0s' $(seq 1 87))"; B22="$(printf 'B%.0s' $(seq 1 22))"

echo "== C1: dos publicaciones SIMULTÁNEAS con aviso de la misma noticia destacada: un solo envío"
POST="$("${PSQL[@]}" -d "$DB" -At -c "$(sess "$OWNER" authenticated) select (public.create_club_post('$CA','news','Aviso concurrente','Texto',null,null,null,true,null,null,'$(key 901)')).id;" | tail -1)"
race "$OWNER" authenticated "select public.publish_club_post('$POST', true);" "select public.publish_club_post('$POST', true);"
verdict "ambas sesiones sin error" "^0 0$" "$RC_A $RC_B"
verdict "exactamente un lote de avisos (3 destinatarios, sin duplicados)" "^3$" "$(q "select count(*) from public.notifications where dedupe_key = 'post:$POST'")"
verdict "la segunda sesión recibió already_notified" "already_notified\": true" "$(cat "$TMP/b15_b.out")"
verdict "notified_at se fijó una sola vez" "^1$" "$(q "select count(*) from public.club_posts where id = '$POST' and notified_at is not null")"

echo "== C2: doble envío SIMULTÁNEO de la misma creación (misma clave): una sola publicación"
CREATE_SQL="select (public.create_club_post('$CA','news','Creada en carrera','Texto',null,null,null,false,null,null,'$(key 902)')).id;"
race "$OWNER" authenticated "$CREATE_SQL" "$CREATE_SQL"
verdict "ambas sesiones sin error" "^0 0$" "$RC_A $RC_B"
verdict "una sola fila con la clave" "^1$" "$(q "select count(*) from public.club_posts where client_request_id = '$(key 902)'")"

echo "== C3: dos generaciones SIMULTÁNEAS de recordatorios: no hay duplicados"
q "set session_replication_role = replica; insert into public.reservations(id, club_id, court_id, customer_name, person_id, starts_at, ends_at, status, occupation_type, created_by, created_at) values ('f5000000-0000-0000-0000-0000000009a1','$CA','d0000000-0000-0000-0000-000000000001','Cliente','e0000000-0000-0000-0000-000000000001', now() + interval '12 hours', now() + interval '13 hours','confirmed','reservation','$OWNER', now() - interval '5 days'), ('f5000000-0000-0000-0000-0000000009a2','$CA','d0000000-0000-0000-0000-000000000002','Cliente','e0000000-0000-0000-0000-000000000002', now() + interval '12 hours', now() + interval '13 hours','confirmed','reservation','$OWNER', now() - interval '5 days')" >/dev/null
race "$OWNER" service_role "select public.generate_reservation_reminders(1440);" "select public.generate_reservation_reminders(1440);"
verdict "ambas sesiones sin error" "^0 0$" "$RC_A $RC_B"
verdict "un recordatorio por reserva y destinatario (2)" "^2$" "$(q "select count(*) from public.notifications where kind = 'reservation_reminder' and target_id in ('f5000000-0000-0000-0000-0000000009a1','f5000000-0000-0000-0000-0000000009a2')")"
verdict "la segunda sesión no generó nada (0)" "^0$" "$(grep -E '^[0-9]+$' "$TMP/b15_b.out" | tail -1)"

echo "== C4: dos reclamos SIMULTÁNEOS de la cola: conjuntos disjuntos (sin envíos duplicados)"
q "delete from public.push_deliveries; delete from public.push_subscriptions" >/dev/null
for n in 1 2 3 4; do q "insert into public.push_subscriptions(user_id, endpoint, p256dh, auth_secret) values ('a0000000-0000-0000-0000-000000000005','https://push.example.test/c4/$n','$A87','$B22')" >/dev/null; done
q "insert into public.notifications(club_id,user_id,kind,title,dedupe_key) values ('$CA','a0000000-0000-0000-0000-000000000005','news_published','Cola C4','c4-note')" >/dev/null
verdict "4 entregas pendientes" "^4$" "$(q "select count(*) from public.push_deliveries where status = 'pending'")"
"${PSQL[@]}" -d "$DB" -At -c "begin; $(sess '' service_role) select jsonb_path_query_array(public.claim_push_deliveries(2), '\$[*].delivery_id'); select pg_sleep(3); commit;" >"$TMP/b15_a.out" 2>&1 &
PID=$!; sleep 1
"${PSQL[@]}" -d "$DB" -At -c "$(sess '' service_role) select jsonb_path_query_array(public.claim_push_deliveries(2), '\$[*].delivery_id');" >"$TMP/b15_b.out" 2>&1
wait "$PID"
IDS_A="$(grep '^\[' "$TMP/b15_a.out" | tr -d '[]" ' | tr ',' '\n' | sort)"; IDS_B="$(grep '^\[' "$TMP/b15_b.out" | tr -d '[]" ' | tr ',' '\n' | sort)"
verdict "cada sesión reclamó 2" "^2 2$" "$(echo "$IDS_A" | grep -c .) $(echo "$IDS_B" | grep -c .)"
verdict "ninguna entrega fue reclamada por ambas" "^0$" "$(comm -12 <(echo "$IDS_A") <(echo "$IDS_B") | grep -c .)"
verdict "las 4 quedaron reservadas («sending»)" "^4$" "$(q "select count(*) from public.push_deliveries where status = 'sending'")"

echo "== C5: dos cuentas registran el MISMO dispositivo a la vez: un solo registro"
EP="https://push.example.test/c5/shared"
"${PSQL[@]}" -d "$DB" -c "begin; $(sess a0000000-0000-0000-0000-000000000005 authenticated) select public.register_push_subscription('$EP','$A87','$B22'); select pg_sleep(3); commit;" >"$TMP/b15_a.out" 2>&1 &
PID=$!; sleep 1
"${PSQL[@]}" -d "$DB" -At -c "$(sess a0000000-0000-0000-0000-000000000006 authenticated) select public.register_push_subscription('$EP','$A87','$B22');" >"$TMP/b15_b.out" 2>&1; RC_B=$?
wait "$PID"; RC_A=$?
verdict "ambas sin error" "^0 0$" "$RC_A $RC_B"
verdict "un solo registro del dispositivo" "^1$" "$(q "select count(*) from public.push_subscriptions where endpoint = '$EP'")"

echo
if [[ $FAILS -eq 0 ]]; then echo "== Sprint 15: TODO OK"; else echo "== Sprint 15: $FAILS grupo(s) con FALLAS"; fi
exit $(( FAILS > 0 ))
