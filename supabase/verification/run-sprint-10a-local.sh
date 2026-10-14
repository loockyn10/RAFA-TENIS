#!/usr/bin/env bash
# Sprint 10A — corre las verificaciones de torneos contra un PostgreSQL REAL y DESCARTABLE (sin Docker).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un usuario superusuario (no es Supabase real).
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde.
# Crea (y reemplaza si existe) la base `rafa_tenis_verify_10a`. NUNCA apuntar a una base con datos reales.
#
# Pasos:
#   1. Aplica stub de Supabase + migraciones 01–10 (estado previo al Sprint 10A).
#   2. Genera datos con las funciones ANTERIORES (fixtures existentes, algunos con resultados) y toma una huella.
#   3. Aplica la migración del Sprint 10A y comprueba que los fixtures existentes no cambiaron y siguen siendo jugables.
#   4. Ejecuta sprint-10a-tournament-fixture-checks.sql (tamaños 2..32, dobles, restricciones, permisos).
#   5. Ejecuta la prueba de concurrencia (dos sesiones generando el mismo fixture).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_verify_10a"
export PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
FIX="20261014010000_fix_tournament_fixture.sql"

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql"

echo "== Aplicando migraciones previas al Sprint 10A"
for f in "$MIGRATIONS"/*.sql; do
  [[ "$(basename "$f")" == "$FIX" ]] && continue
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
done

echo "== Datos existentes generados con las funciones anteriores"
"${PSQL[@]}" -d "$DB" -f "$HERE/sprint-10a-legacy-before.sql"

echo "== Aplicando migración del Sprint 10A sobre esos datos"
"${PSQL[@]}" -d "$DB" -f "$MIGRATIONS/$FIX"
# Diagnóstico de solo lectura: debe señalar únicamente el partido corrupto sembrado ("L3 corrupto").
DIAG="$("${PSQL[@]}" -d "$DB" -At -F'|' -f "$HERE/sprint-10a-legacy-diagnostics.sql")"
echo "$DIAG"
[[ -n "$DIAG" && "$(echo "$DIAG" | cut -d'|' -f2 | sort -u | wc -l)" -eq 1 ]] || { echo "FALLO: el diagnóstico no señaló exactamente el partido corrupto sembrado"; exit 1; }
"${PSQL[@]}" -d "$DB" -f "$HERE/sprint-10a-legacy-after.sql"

echo "== Verificaciones principales"
"${PSQL[@]}" -d "$DB" -f "$HERE/sprint-10a-tournament-fixture-checks.sql"

echo "== Concurrencia: dos sesiones generan el mismo fixture"
"${PSQL[@]}" -d "$DB" -f "$HERE/sprint-10a-concurrency-setup.sql"
CAT="$("${PSQL[@]}" -d "$DB" -Atc "select id from public.tournament_categories where name = 'Concurrencia'")"
SUB="00000000-0000-0000-0000-0000000010c1"
SESSION_SQL="set role authenticated; select set_config('request.jwt.claim.sub','$SUB',false);"
# Sesión A: genera y mantiene la transacción abierta 3 s antes de confirmar.
"${PSQL[@]}" -d "$DB" -c "begin; $SESSION_SQL select count(*) from public.generate_tournament_fixture('$CAT'); select pg_sleep(3); commit;" >"${TMPDIR:-/tmp}/t10a_a.out" 2>&1 &
PID_A=$!
sleep 1
# Sesión B: intenta lo mismo mientras A sigue abierta; debe esperar y luego ser rechazada.
set +e
"${PSQL[@]}" -d "$DB" -c "$SESSION_SQL select count(*) from public.generate_tournament_fixture('$CAT');" >"${TMPDIR:-/tmp}/t10a_b.out" 2>&1
RC_B=$?
set -e
wait "$PID_A"
[[ $RC_B -ne 0 ]] || { echo "FALLO: la segunda generación concurrente no fue rechazada"; exit 1; }
grep -q "Abrí inscripciones" "${TMPDIR:-/tmp}/t10a_b.out" || { echo "FALLO: error inesperado en la sesión B"; cat "${TMPDIR:-/tmp}/t10a_b.out"; exit 1; }
"${PSQL[@]}" -d "$DB" -Atc "select 'partidos tras la carrera: ' || count(*) from public.tournament_matches where category_id = '$CAT'" | tee /dev/stderr | grep -q "partidos tras la carrera: 7" \
  || { echo "FALLO: el fixture quedó duplicado o incompleto"; exit 1; }
echo "OK concurrencia: una sola generación (7 partidos para 8 inscripciones), la otra rechazada"
echo "== Todo OK"
