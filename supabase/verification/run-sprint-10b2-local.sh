#!/usr/bin/env bash
# Sprint 10B.2 — verifica SEC-05 (idempotencia financiera) contra un PostgreSQL REAL y DESCARTABLE (sin Docker, NO Supabase).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un superusuario.
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde, TMPDIR.
# Crea (y reemplaza si existe) la base `rafa_tenis_verify_10b2`. NUNCA apuntar a una base con datos reales ni a Supabase.
#
# Pasos:
#   1. Stub de Supabase + migraciones hasta Sprint 10B.1 (estado previo; sin la migración 10B.2).
#   2. Datos históricos generados con las RPC anteriores + control negativo (SEC-05 reproducido en el estado previo).
#   3. Se aplica 20261014060000_idempotent_financial_operations.sql sobre esos datos.
#   4. sprint-10b2-checks.sql (venta, pagos, reintentos, aislamiento, permisos, anulaciones, datos históricos).
#   5. Concurrencia con dos sesiones (reintentos simultáneos, doble cobro, claves distintas, clave con otro contenido).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_verify_10b2"
NEW="20261014060000_idempotent_financial_operations.sql"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
TMP="${TMPDIR:-/tmp}"
FAILS=0

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql" 2>&1 | grep -v NOTICE

echo "== Migraciones previas a 10B.2"
for f in "$MIGRATIONS"/*.sql; do
  b="$(basename "$f")"
  [[ "$b" == "$NEW" || "$b" > "$NEW" ]] && continue
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$TMP/mig10b2.err" || { echo "FALLO al aplicar $b"; cat "$TMP/mig10b2.err"; exit 1; }
done

echo "== Datos históricos (RPC anteriores) y control negativo"
"${PSQL[@]}" -d "$DB" -f "$HERE/sprint-10b2-seed.sql" 2>&1 | grep -v NOTICE

echo "== Aplicando la migración 10B.2 sobre los datos existentes"
"${PSQL[@]}" -d "$DB" -f "$MIGRATIONS/$NEW" 2>&1 | grep -v NOTICE
[[ ${PIPESTATUS[0]} -eq 0 ]] && echo "  aplicada $NEW" || { echo "  FALLO $NEW"; exit 1; }

echo "== Verificaciones"
OUT="$(psql -X -q -d "$DB" -f "$HERE/sprint-10b2-checks.sql" 2>&1)"
echo "$OUT" | sed -n '/CONTROL NEGATIVO/,$p'
echo "$OUT" | grep -i "^psql:.*ERROR" && FAILS=$((FAILS+1))
NO_CUMPLE="$(echo "$OUT" | grep -E '^ TOTAL' | awk -F'|' '{gsub(/ /,"",$4); print $4}')"
[[ "${NO_CUMPLE:-1}" -eq 0 ]] || FAILS=$((FAILS+1))
REPRO="$(psql -X -At -d "$DB" -c "select count(*) filter (where ok) from t2.results where area = 'CONTROL-ANTES'")"
[[ "${REPRO:-0}" -eq 2 ]] || { echo "  FALLA el control negativo: se esperaban 2 hallazgos reproducidos en el estado previo (hay ${REPRO:-0})"; FAILS=$((FAILS+1)); }

# ---------- Concurrencia ----------
q() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
sess() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$1',false);"; }
verdict() { if [[ "$3" =~ $2 ]]; then echo "  OK    $1 -> $3"; else echo "  FALLA $1 -> $3 (esperado /$2/)"; FAILS=$((FAILS+1)); fi; }
# race <uid> <sqlA> <sqlB>: A abre una transacción, ejecuta y espera 3 s antes de confirmar; B arranca 1 s después.
# Con claves iguales, B queda bloqueado por el candado de la clave hasta que A confirma y luego recupera el resultado.
race() {
  "${PSQL[@]}" -d "$DB" -c "begin; $(sess "$1") $2 select pg_sleep(3); commit;" >"$TMP/b2_a.out" 2>&1 &
  local pid=$!; sleep 1
  "${PSQL[@]}" -d "$DB" -At -c "$(sess "$1") $3" >"$TMP/b2_b.out" 2>&1; RC_B=$?
  wait "$pid"; RC_A=$?
  B_OUT="$(grep -E '^[0-9a-f]{8}-' "$TMP/b2_b.out" | tail -1)"
}
OWNER_A="a0000000-0000-0000-0000-000000000001"; STAFF_A="a0000000-0000-0000-0000-000000000003"
CLUB_A="c0000000-0000-0000-0000-00000000000a"
AGUA="b1000000-0000-0000-0000-0000000000a1"; PEL="b1000000-0000-0000-0000-0000000000a3"
key() { printf 'f3000000-0000-0000-0000-%012d' "$1"; }
SALE_SQL() { echo "select (public.create_canteen_sale('$CLUB_A','$2'::jsonb,null,'cash','$(key "$1")')).id;"; }
ITEMS2="[{\"product_id\":\"$AGUA\",\"quantity\":2}]"

echo "== C1: doble envío SIMULTÁNEO de la misma venta (misma clave y contenido): una sola venta, ambas sesiones reciben el mismo id"
race "$STAFF_A" "$(SALE_SQL 1 "$ITEMS2")" "$(SALE_SQL 1 "$ITEMS2")"
verdict "ambas sesiones terminan sin error" "^0 0$" "$RC_A $RC_B"
verdict "una sola fila de venta con la clave" "^1$" "$(q "select count(*) from public.canteen_sales where client_request_id='$(key 1)'")"
verdict "un solo cobro asociado" "^1$" "$(q "select count(*) from public.canteen_sale_payments p join public.canteen_sales s on s.id=p.sale_id where s.client_request_id='$(key 1)'")"
verdict "la sesión B recibió el id de la venta original" "^t$" "$(q "select ('$B_OUT' = (select id::text from public.canteen_sales where client_request_id='$(key 1)'))")"

echo "== C2: misma clave con CONTENIDO DISTINTO en simultáneo: una gana, la otra se rechaza (23505)"
race "$STAFF_A" "$(SALE_SQL 2 "$ITEMS2")" "$(SALE_SQL 2 "[{\"product_id\":\"$AGUA\",\"quantity\":3}]")"
verdict "exactamente una sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "una sola venta con la clave" "^1$" "$(q "select count(*) from public.canteen_sales where client_request_id='$(key 2)'")"
verdict "el perdedor recibió 23505" "23505|ya se usó con otros datos" "$(cat "$TMP/b2_a.out" "$TMP/b2_b.out" | grep -o '23505\|ya se usó con otros datos' | head -1)"

echo "== C3: dos ventas DELIBERADAMENTE distintas con el mismo contenido y claves distintas en simultáneo: dos ventas"
race "$STAFF_A" "$(SALE_SQL 3 "$ITEMS2")" "$(SALE_SQL 4 "$ITEMS2")"
verdict "ambas sesiones terminan sin error" "^0 0$" "$RC_A $RC_B"
verdict "dos filas de venta (no se deduplica por contenido)" "^2$" "$(q "select count(*) from public.canteen_sales where client_request_id in ('$(key 3)','$(key 4)')")"

DUE3="$(q "select d.id from public.membership_dues d join public.club_memberships m on m.id=d.membership_id where m.person_id='e0000000-0000-0000-0000-000000000003'")"
PAY_SQL() { echo "select (public.record_membership_due_payment('$CLUB_A','$1',$3,date '2026-10-05','cash',null,null,'$(key "$2")')).id;"; }

echo "== C4: reintento SIMULTÁNEO del mismo pago de cuota: un solo pago"
BEFORE="$(q "select coalesce(sum(amount_cents),0) from public.membership_due_payments where due_id='$DUE3' and voided_at is null")"
race "$OWNER_A" "$(PAY_SQL "$DUE3" 10 1000000)" "$(PAY_SQL "$DUE3" 10 1000000)"
verdict "ambas sesiones terminan sin error" "^0 0$" "$RC_A $RC_B"
verdict "un solo pago con la clave" "^1$" "$(q "select count(*) from public.membership_due_payments where client_request_id='$(key 10)'")"
verdict "el saldo bajó una sola vez (1.000.000)" "^1000000$" "$(( $(q "select coalesce(sum(amount_cents),0) from public.membership_due_payments where due_id='$DUE3' and voided_at is null") - BEFORE ))"
verdict "B recibió el id del pago original" "^t$" "$(q "select ('$B_OUT' = (select id::text from public.membership_due_payments where client_request_id='$(key 10)'))")"

echo "== C5: dos pagos de cuota con claves DISTINTAS que juntos exceden el saldo: solo uno entra (sobrepago imposible)"
SALDO="$(q "select d.amount_cents - coalesce(sum(p.amount_cents),0) from public.membership_dues d left join public.membership_due_payments p on p.due_id=d.id and p.voided_at is null where d.id='$DUE3' group by d.amount_cents")"
MITAD=$(( SALDO * 6 / 10 ))
race "$OWNER_A" "$(PAY_SQL "$DUE3" 11 "$MITAD")" "$(PAY_SQL "$DUE3" 12 "$MITAD")"
verdict "exactamente una sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "ninguna cuota sobrepagada" "^0$" "$(q "select count(*) from public.membership_dues d where coalesce((select sum(amount_cents) from public.membership_due_payments p where p.due_id=d.id and p.voided_at is null),0) > d.amount_cents")"

echo "== C6: reintento SIMULTÁNEO del mismo pago de cantina y pagos de claves distintas que exceden el saldo"
PSALE="$(q "set role authenticated; select set_config('request.jwt.claim.sub','$STAFF_A',false); select (public.create_canteen_sale('$CLUB_A','[{\"product_id\":\"$PEL\",\"quantity\":2}]'::jsonb,'e0000000-0000-0000-0000-000000000004',null,'$(key 20)')).id" | tail -1)"
CPAY_SQL() { echo "select (public.record_canteen_sale_payment('$CLUB_A','$PSALE',$3,date '2026-10-05','cash',null,null,'$(key "$2")')).id;"; }
race "$STAFF_A" "$(CPAY_SQL "$PSALE" 21 200000)" "$(CPAY_SQL "$PSALE" 21 200000)"
verdict "reintento simultáneo: ambas terminan sin error" "^0 0$" "$RC_A $RC_B"
verdict "reintento simultáneo: un solo pago" "^1$" "$(q "select count(*) from public.canteen_sale_payments where client_request_id='$(key 21)'")"
race "$STAFF_A" "$(CPAY_SQL "$PSALE" 22 200000)" "$(CPAY_SQL "$PSALE" 23 200000)"
verdict "claves distintas (saldo 300000, 2×200000): solo una entra" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "la venta no queda cobrada de más" "^0$" "$(q "select count(*) from public.canteen_sales s where s.id='$PSALE' and (select coalesce(sum(amount_cents),0) from public.canteen_sale_payments p where p.sale_id=s.id) > s.total_cents")"

echo "== C7: reintento de pago SIMULTÁNEO con la anulación del mismo pago (sin deadlock; estado coherente)"
VPAY="$(q "select id from public.membership_due_payments where client_request_id='$(key 10)'")"
VOID_SQL="select public.void_membership_due_payment('$VPAY','anulacion concurrente');"
race "$OWNER_A" "$VOID_SQL" "$(PAY_SQL "$DUE3" 10 1000000)"
verdict "ninguna sesión falló por deadlock/serialización" "^0$" "$(cat "$TMP/b2_a.out" "$TMP/b2_b.out" | grep -ci 'deadlock\|40P01\|40001')"
verdict "sigue habiendo un solo pago con la clave y está anulado" "^1\|1$" "$(q "select count(*) || '|' || count(*) filter (where voided_at is not null) from public.membership_due_payments where client_request_id='$(key 10)'")"

echo "== Consistencia final"
verdict "ninguna cuota sobrepagada" "^0$" "$(q "select count(*) from public.membership_dues d where coalesce((select sum(amount_cents) from public.membership_due_payments p where p.due_id=d.id and p.voided_at is null),0) > d.amount_cents")"
verdict "ninguna venta cobrada de más" "^0$" "$(q "select count(*) from public.canteen_sales s where (select coalesce(sum(amount_cents),0) from public.canteen_sale_payments p where p.sale_id=s.id) > s.total_cents")"

echo
if [[ $FAILS -eq 0 ]]; then echo "== Sprint 10B.2: TODO OK"; else echo "== Sprint 10B.2: $FAILS grupo(s) con FALLAS"; fi
exit $(( FAILS > 0 ))
