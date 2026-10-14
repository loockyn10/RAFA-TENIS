#!/usr/bin/env bash
# Sprint 10B.1 — verifica SEC-01…SEC-04 contra un PostgreSQL REAL y DESCARTABLE (sin Docker, NO Supabase).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un superusuario.
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde, TMPDIR.
# Crea (y reemplaza si existe) la base `rafa_tenis_verify_10b1`. NUNCA apuntar a una base con datos reales ni a Supabase.
#
# Pasos:
#   1. Stub de Supabase + migraciones previas a 10B.1 (estado actual de producción según el repositorio).
#   2. Datos de prueba generados por las RPC reales (seed) + huella financiera.
#   3. Control negativo: las mismas verificaciones SOBRE EL ESTADO PREVIO deben fallar donde están los hallazgos.
#   4. Se aplican las 4 migraciones 10B.1 (sobre los datos existentes).
#   5. Las verificaciones deben cumplirse al 100 % (el script devuelve código 1 si alguna falla).
#   6. Concurrencia con dos sesiones: canje de invitación, anulación de pago de cuota, anulación de venta de cantina.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_verify_10b1"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
TMP="${TMPDIR:-/tmp}"
NEW=(20261014020000_fix_redeem_player_invitation_crypto.sql 20261014030000_revoke_anon_rpc_and_check_permissions_first.sql 20261014040000_restrict_table_privileges.sql 20261014050000_fix_player_membership_dues_balance.sql)
FAILS=0

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql" 2>&1 | grep -v NOTICE

echo "== Migraciones previas a 10B.1"
for f in "$MIGRATIONS"/*.sql; do
  b="$(basename "$f")"; skip=0
  for n in "${NEW[@]}"; do [[ "$b" == "$n" ]] && skip=1; done
  [[ $skip == 1 ]] && continue
  # Sprint 10B.2 cambia las firmas de los pagos: este guion valida el estado de 10B.1, no lo aplica.
  [[ "${b:0:14}" > "20261014050000" ]] && continue
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$TMP/mig10b1.err" || { echo "FALLO al aplicar $b"; cat "$TMP/mig10b1.err"; exit 1; }
done

echo "== Datos de prueba (RPC reales) y huella financiera"
"${PSQL[@]}" -d "$DB" -f "$HERE/sprint-10b1-seed.sql" 2>&1 | grep -v NOTICE

echo "== CONTROL NEGATIVO: verificaciones sobre el estado previo (en una copia; deben fallar donde estaban los hallazgos)"
CTL="${DB}_ctl"
"${PSQL[@]}" -d postgres -c "drop database if exists $CTL with (force)" -c "create database $CTL template $DB" 2>&1 | grep -v NOTICE
BEFORE="$(psql -X -q -d "$CTL" -f "$HERE/sprint-10b1-checks.sql" 2>&1)"
echo "$BEFORE" | sed -n '/RESUMEN SPRINT/,/PRUEBAS QUE NO CUMPLEN/p' | head -12
echo "$BEFORE" | grep "TOTAL"
BEFORE_FAIL="$(echo "$BEFORE" | grep -o 'no_cumple=[0-9]*' | cut -d= -f2)"
"${PSQL[@]}" -d postgres -c "drop database if exists $CTL with (force)" 2>&1 | grep -v NOTICE
if [[ "${BEFORE_FAIL:-0}" -lt 20 ]]; then echo "  FALLA el control negativo: se esperaban muchos incumplimientos en el estado previo"; FAILS=$((FAILS+1)); else echo "  OK    el estado previo incumple $BEFORE_FAIL verificaciones (control negativo válido)"; fi

echo "== Aplicando migraciones 10B.1 sobre los datos existentes"
for n in "${NEW[@]}"; do
  "${PSQL[@]}" -d "$DB" -f "$MIGRATIONS/$n" 2>&1 | grep -v NOTICE
  [[ ${PIPESTATUS[0]} -eq 0 ]] && echo "  aplicada $n" || { echo "  FALLO $n"; exit 1; }
done

echo "== Verificaciones con las migraciones aplicadas"
AFTER="$(psql -X -q -d "$DB" -f "$HERE/sprint-10b1-checks.sql" 2>&1)"
echo "$AFTER" | sed -n '/RESUMEN SPRINT/,$p'
AFTER_FAIL="$(echo "$AFTER" | grep -o 'no_cumple=[0-9]*' | cut -d= -f2)"
[[ "${AFTER_FAIL:-1}" -eq 0 ]] || FAILS=$((FAILS+1))

# ---------- Concurrencia ----------
q() { "${PSQL[@]}" -d "$DB" -Atc "$1"; }
sess() { echo "set role authenticated; select set_config('request.jwt.claim.sub','$1',false);"; }
verdict() { if [[ "$3" =~ $2 ]]; then echo "  OK    $1 -> $3"; else echo "  FALLA $1 -> $3 (esperado /$2/)"; FAILS=$((FAILS+1)); fi; }
# race_as <uidA> <sqlA> <uidB> <sqlB>: A abre una transacción, ejecuta y espera 3 s antes de confirmar; B arranca 1 s después.
race_as() {
  "${PSQL[@]}" -d "$DB" -c "begin; $(sess "$1") $2 select pg_sleep(3); commit;" >"$TMP/b1_a.out" 2>&1 &
  local pid=$!; sleep 1
  "${PSQL[@]}" -d "$DB" -c "$(sess "$3") $4" >"$TMP/b1_b.out" 2>&1; RC_B=$?
  wait "$pid"; RC_A=$?
}
OWNER_A="a0000000-0000-0000-0000-000000000001"; STAFF_A="a0000000-0000-0000-0000-000000000003"
R5="a1000000-0000-0000-0000-000000000005"; R6="a1000000-0000-0000-0000-000000000006"

echo "== C1: canje concurrente del mismo código por dos cuentas (un solo ganador, un solo vínculo)"
q "select t10.mk_invite('cc1','ownerA','clubA','inv5','1 day')" >/dev/null
CODE="$(q "select code from t10.codes where name = 'cc1'")"
SQL="select public.redeem_player_invitation('$CODE');"
race_as "$R5" "$SQL" "$R6" "$SQL"
verdict "una sola sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "vínculos de la persona = 1" "^1$" "$(q "select count(*) from public.club_person_auth_links where person_id='e0000000-0000-0000-0000-0000000000f5'")"
verdict "la invitación quedó usada una sola vez" "^1$" "$(q "select count(*) from public.player_invitations where person_id='e0000000-0000-0000-0000-0000000000f5' and redeemed_at is not null")"
verdict "el perdedor recibió el mensaje genérico o de vínculo existente" "No pudimos validar|ya tiene una vinculaci" "$(cat "$TMP/b1_a.out" "$TMP/b1_b.out" | grep -o 'No pudimos validar\|ya tiene una vinculaci' | head -1)"

echo "== C2: dos anulaciones simultáneas del mismo pago de cuota (una sola anula)"
PAY="$(q "set role authenticated; select set_config('request.jwt.claim.sub','$OWNER_A',false); select (public.record_membership_due_payment('c0000000-0000-0000-0000-00000000000a','$(q "select val from t10.tok where name='dueA2'")',20000,current_date,'cash')).id" | tail -1)"
SQL="select public.void_membership_due_payment('$PAY','carrera');"
race_as "$OWNER_A" "$SQL" "$OWNER_A" "$SQL"
verdict "una sola sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "el pago quedó anulado una vez" "^1$" "$(q "select count(*) from public.membership_due_payments where id='$PAY' and voided_at is not null")"

echo "== C3: dos anulaciones simultáneas de la misma venta de cantina (una sola anula)"
SALE="$(q "set role authenticated; select set_config('request.jwt.claim.sub','$STAFF_A',false); select (public.create_canteen_sale('c0000000-0000-0000-0000-00000000000a','[{\"product_id\":\"b1000000-0000-0000-0000-0000000000a1\",\"quantity\":1}]'::jsonb,'e0000000-0000-0000-0000-000000000002')).id" | tail -1)"
SQL="select public.void_canteen_sale('$SALE','carrera');"
race_as "$OWNER_A" "$SQL" "$OWNER_A" "$SQL"
verdict "una sola sesión tuvo éxito" "^1$" "$(( (RC_A==0) + (RC_B==0) ))"
verdict "la venta quedó anulada" "^voided$" "$(q "select status from public.canteen_sales where id='$SALE'")"

echo "== Consistencia final de cuotas"
verdict "ninguna cuota sobrepagada (pagos válidos > importe)" "^0$" "$(q "select count(*) from public.membership_dues d where coalesce((select sum(amount_cents) from public.membership_due_payments p where p.due_id=d.id and p.voided_at is null),0) > d.amount_cents")"

echo
if [[ $FAILS -eq 0 ]]; then echo "== Sprint 10B.1: TODO OK"; else echo "== Sprint 10B.1: $FAILS grupo(s) con FALLAS"; fi
exit $(( FAILS > 0 ))
