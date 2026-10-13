# ROADMAP.md — priorización incremental

| Prioridad | Sprint | Entregable demostrable | Dependencias |
|---|---|---|---|
| P0 | **0** | Bootstrap repo, PWA shell, tooling, docs; local build/test | Ninguna cuenta cloud necesaria |
| P0 | **1** | Auth staff/admin, esquema `clubs`/`club_staff`/`courts`, RLS, carga de seis canchas | Política segura de primer admin y Supabase real |
| P0 | **2** | Agenda diaria + alta/edición/cancelación manual de reservas y DB antisolape | Implementado localmente; falta aplicar migración y validarlo en Supabase |
| P0 | **3** | Bloqueos, reservas semanales acotadas, conflictos y base de pruebas multicliente | Implementado localmente; requiere aplicar y verificar migraciones 2–3 |
| P1 | **4** | Personas y socios | Implementado localmente; falta aplicar/verificar migración 4 |
| P1 | **5** | Cuotas y pagos manuales | Implementado localmente; requiere aplicar/verificar migraciones 2–5 |
| P1 | **6** | Profesores, alumnos y clases en agenda única | Implementado localmente; requiere aplicar/verificar migraciones 2–6 |
| P0 | **Piloto** | Piloto con Rafa en PC/móvil y ajustes operativos | Sprints 1–5 aplicados y verificados |
| P1 | **7** | Portal del jugador / PWA autogestión | Política anticipación/cancelación/cupos |
| P1 | **8** | Portal del profesor, si se acuerda | Política de acceso docente y privacidad |
| P1 | **7** | Torneos, categorías, inscripciones, fixtures y resultados | Implementado localmente; requiere aplicar/verificar migración 7 |
| P2 | **10** | Eventos y noticias del club | Alcance eventos |
| P2 | **11** | Cantina, ventas y cargos informales + caja básica | Política económica acordada |
| Later | — | Rankings, estadísticas, check-in opcional, tiendas de apps | Demanda real |

Cada sprint acaba con tests, documentación y verificación acorde a su alcance. **No son fechas comprometidas.** Los números son el nuevo orden propuesto, no las numeraciones del ZIP de origen.

No avanzar de reservas hacia cobros complejos si integridad y autorización siguen sin verificar.
