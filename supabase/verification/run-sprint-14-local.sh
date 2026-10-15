#!/usr/bin/env bash
# Sprint 14 — verifica cobros de cancha/iluminación y cuenta corriente contra un PostgreSQL REAL y DESCARTABLE (sin Docker, NO Supabase).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un superusuario.
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde, TMPDIR.
# Crea (y reemplaza si existe) la base `rafa_tenis_verify_14`. NUNCA apuntar a una base con datos reales ni a Supabase.
# Pasos: stub de Supabase + migraciones 01…20261014070000, sprint-14-court-charges-checks.sql y concurrencia con dos sesiones.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_verify_14"
export PGCLIENTENCODING=UTF8 PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
TMP="${TMPDIR:-/tmp}"
FAILS=0

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql" 2>&1 | grep -v NOTICE
echo "== Migraciones"
for f in "$MIGRATIONS"/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$TMP/mig14.err" || { echo "FALLO al aplicar $(basename "$f")"; cat "$TMP/mig14.err"; exit 1; }
done

echo "== Verificaciones"
OUT="$(psql -X -q -d "$DB" -f "$HERE/sprint-14-court-charges-checks.sql" 2>&1)"
echo "$OUT" | sed -n '/^ *area/,$p'
echo "$OUT" | grep -i "^psql:.*ERROR" && FAILS=$((FAILS+1))
NO_CUMPLE="$(echo "$OUT" | grep -E '^ +TOTAL' | awk -F'|' '{gsub(/ /,"",$3); print $3}')"
[[ "${NO_CUMPLE:-1}" -eq 0 ]] || FAILS=$((FAILS+1))

# ---------- Concurrencia ----------
q() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
sess() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$1',false);"; }
verdict() { if [[ "$3" =~ $2 ]]; then echo "  OK    $1 -> $3"; else echo "  FALLA $1 -> $3 (esperado /$2/)"; FAILS=$((FAILS+1)); fi; }
# race <uid> <sqlA> <sqlB>: A abre una transacción, ejecuta y espera 3 s antes de confirmar; B arranca 1 s después.
race() {
  "${PSQL[@]}" -d "$DB" -c "begin; $(sess "$1") $2 select pg_sleep(3); commit;" >"$TMP/b14_a.out" 2>&1 &
  local pid=$!; sleep 1
  "${PSQL[@]}" -d "$DB" -At -c "$(sess "$1") $3" >"$TMP/b14_b.out" 2>&1; RC_B=$?
  wait "$pid"; RC_A=$?
  B_OUT="$(grep -E '^[0-9a-f]{8}-' "$TMP/b14_b.out" | tail -1)"
}
OWNER="a0000000-0000-0000-0000-000000000001"; CA="c0000000-0000-0000-0000-00000000000a"
key() { printf 'f4000000-0000-0000-0000-%012d' "$1"; }
RES() { printf 'f5000000-0000-0000-0000-%012d' "$1"; }
P2="e0000000-0000-0000-0000-000000000002"
CH_SQL() { echo "select (public.create_court_charge('$CA','$(RES "$1")','$P2',true,false,'$(key "$2")')).id;"; }

echo "== C1: doble envío SIMULTÁNEO del mismo cargo (misma clave): un solo cargo"
race "$OWNER" "$(CH_SQL 17 201)" "$(CH_SQL 17 201)"
verdict "ambas sesiones sin error" "^0 0$" "$RC_A $RC_B"
verdict "una sola fila con la clave" "^1$" "$(q "select count(*) from public.court_charges where client_request_id='$(key 201)'")"
verdict "B recibió el id original" "^t$" "$(q "select ('$B_OUT' = (select id::text from public.court_charges where client_request_id='$(key 201)'))")"

echo "== C2: dos cargos con claves DISTINTAS sobre la misma reserva en simultáneo: solo uno"
race "$OWNER" "$(CH_SQL 18 202)" "$(CH_SQL 18 203)"
verdict "exactamente una sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "un solo cargo vigente en la reserva" "^1$" "$(q "select count(*) from public.court_charges where reservation_id='$(RES 18)' and status='confirmed'")"

CH17="$(q "select id from public.court_charges where client_request_id='$(key 201)'")"
PAY_SQL() { echo "select (public.record_court_charge_payment('$CA','$CH17',$3,date '2026-11-05','cash','$(key "$2")')).id;"; }
TOTAL="$(q "select total_cents from public.court_charges where id='$CH17'")"
echo "== C3: reintento SIMULTÁNEO del mismo pago: un solo pago"
race "$OWNER" "$(PAY_SQL x 210 100000)" "$(PAY_SQL x 210 100000)"
verdict "ambas sesiones sin error" "^0 0$" "$RC_A $RC_B"
verdict "un solo pago con la clave" "^1$" "$(q "select count(*) from public.court_charge_payments where client_request_id='$(key 210)'")"
verdict "B recibió el id del pago original" "^t$" "$(q "select ('$B_OUT' = (select id::text from public.court_charge_payments where client_request_id='$(key 210)'))")"

echo "== C4: dos pagos de claves DISTINTAS que juntos exceden el saldo: solo uno entra"
SALDO=$(( TOTAL - 100000 )); MITAD=$(( SALDO * 6 / 10 ))
race "$OWNER" "$(PAY_SQL x 211 $MITAD)" "$(PAY_SQL x 212 $MITAD)"
verdict "exactamente una sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "ningún cargo sobrepagado" "^0$" "$(q "select count(*) from public.court_charges c where coalesce((select sum(amount_cents) from public.court_charge_payments p where p.charge_id=c.id and p.voided_at is null),0) > c.total_cents")"

echo "== C5: pago simultáneo con la anulación de otro pago del mismo cargo (sin deadlock)"
VPAY="$(q "select id from public.court_charge_payments where client_request_id='$(key 210)'")"
race "$OWNER" "select public.void_court_charge_payment('$VPAY','anulacion concurrente');" "$(PAY_SQL x 213 1000)"
verdict "ninguna sesión falló por deadlock/serialización" "^0$" "$(cat "$TMP/b14_a.out" "$TMP/b14_b.out" | grep -ci 'deadlock\|40P01\|40001')"
verdict "ningún cargo sobrepagado" "^0$" "$(q "select count(*) from public.court_charges c where coalesce((select sum(amount_cents) from public.court_charge_payments p where p.charge_id=c.id and p.voided_at is null),0) > c.total_cents")"

echo "== C6: anular el cargo en simultáneo con un pago: nunca queda un cargo anulado con pagos vigentes"
CH18="$(q "select id from public.court_charges where reservation_id='$(RES 18)' and status='confirmed'")"
race "$OWNER" "select public.void_court_charge('$CH18','anulacion concurrente');" "select (public.record_court_charge_payment('$CA','$CH18',1000,date '2026-11-06','cash','$(key 220)')).id;"
verdict "no hay cargo anulado con pagos vigentes" "^0$" "$(q "select count(*) from public.court_charges c where c.status='voided' and exists (select 1 from public.court_charge_payments p where p.charge_id=c.id and p.voided_at is null)")"
verdict "ninguna sesión por deadlock" "^0$" "$(cat "$TMP/b14_a.out" "$TMP/b14_b.out" | grep -ci 'deadlock\|40P01\|40001')"

echo
if [[ $FAILS -eq 0 ]]; then echo "== Sprint 14: TODO OK"; else echo "== Sprint 14: $FAILS grupo(s) con FALLAS"; fi
exit $(( FAILS > 0 ))
