#!/usr/bin/env bash
# Sprint 16 — verifica el ranking interno contra un PostgreSQL REAL y DESCARTABLE (sin Docker, NO Supabase).
#
# Requisitos: psql en el PATH y un servidor PostgreSQL 15+ local con un superusuario.
# Variables: PGHOST (127.0.0.1), PGPORT (5432), PGUSER (postgres), PGPASSWORD si corresponde.
# Crea (y reemplaza si existe) la base `rafa_tenis_verify_16`. NUNCA apuntar a una base con datos reales ni a Supabase.
# Pasos: stub de Supabase + migraciones 01…20261015010000 y sprint-16-ranking-checks.sql (todo en una transacción con ROLLBACK).
# NO prueba: PostgREST, JWT reales ni las políticas del proyecto desplegado.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS="$HERE/../migrations"
DB="rafa_tenis_verify_16"
export PGCLIENTENCODING=UTF8 PGHOST="${PGHOST:-127.0.0.1}" PGPORT="${PGPORT:-5432}" PGUSER="${PGUSER:-postgres}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
TMP="${TMPDIR:-/tmp}"

echo "== Creando base descartable $DB en $PGHOST:$PGPORT"
"${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB" 2>&1 | grep -v NOTICE
"${PSQL[@]}" -d "$DB" -f "$HERE/local-supabase-stub.sql" 2>&1 | grep -v NOTICE
echo "== Migraciones"
for f in "$MIGRATIONS"/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null 2>"$TMP/mig16.err" || { echo "FALLO al aplicar $(basename "$f")"; cat "$TMP/mig16.err"; exit 1; }
done
echo "== Verificaciones"
OUT="$(psql -v ON_ERROR_STOP=1 -X -q -d "$DB" -f "$HERE/sprint-16-ranking-checks.sql" 2>&1)"; RC=$?
echo "$OUT" | grep -E "^psql:|OK [0-9]|verificaciones_ok|^ +[0-9]+ *$|ERROR|FALLO"
if [[ $RC -ne 0 ]]; then echo "== Sprint 16: FALLAS"; exit 1; fi
echo "== Sprint 16: TODO OK"
