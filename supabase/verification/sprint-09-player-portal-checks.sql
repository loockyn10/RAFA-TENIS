-- Sprint 09 — ejecutar SOLO en un proyecto de prueba, con dos clubes y al menos
-- owner/admin A, jugador A, jugador B y usuario sin vinculación. Adaptar UUIDs.
-- Requiere la migración 20261013080000_player_portal.sql aplicada tras confirmar 01–08.

-- 1) Como owner/admin A: crear invitación para <person_a> activa y copiar el
-- código devuelto. La tabla player_invitations debe contener solo token_hash.
-- select public.create_player_invitation('<club_a>', '<person_a>', now() + interval '7 days');
-- Repetir para la misma persona: la previa queda revocada.

-- 2) Como usuario Auth sin vínculo: select public.redeem_player_invitation('<code>');
-- select public.player_access_context(); -- solo club A/person_a
-- Repetir canje, usar código vencido/revocado o reclamar otra persona en club A:
-- espera 22023/23505 sin revelar datos de persona o club. En club B debe poder
-- canjear una invitación separada y el contexto debe devolver ambos clubes.

-- 3) Como jugador A, no debe haber SELECT directo permitido sobre datos privados:
-- select * from public.club_people where club_id = '<club_a>';
-- select * from public.membership_dues where club_id = '<club_a>';
-- select * from public.reservations where club_id = '<club_a>';
-- Las RPC player_profile, player_membership_dues y player_reservations deben
-- devolver exclusivamente los registros de <person_a>.

-- 4) select public.player_court_availability('<club_a>', current_date + 1);
-- Verificar que cada ocupado tiene solo starts_at, ends_at y kind: sin nombre,
-- notas ni identificadores de personas. Jugador B/sin vínculo contra club A: 42501.

-- 5) Como owner/admin A habilitar una configuración de prueba:
-- select public.set_online_booking_settings('<club_a>', true, '07:00', '23:00', 7, array[60,90]::smallint[], 2, 120);
-- Como jugador A crear una reserva válida:
-- select public.create_player_reservation('<club_a>', '<active_court_a>', '<future_start>'::timestamptz, 60);
-- Probar cancha ajena/inactiva, duración 30, horario inválido, más de 7 días y
-- más de 2 reservas futuras: debe fallar sin inserción parcial. En dos sesiones,
-- mismo rango: una confirma y otra falla por exclusión GiST. Debe verse en agenda admin.

-- 6) select public.cancel_player_reservation('<reservation_created_by_player_a>');
-- Debe liberar cancha. Una reserva manual vinculada a person_a aparece en portal
-- pero su cancelación falla. Cancelar ajena o dentro de 120 minutos: 42501.

-- 7) update_player_profile solo edita nombre/teléfono/email propio; confirmar que
-- no altera auth.users.email, notas, club, membresía ni roles. Con cuotas de dos
-- personas, player_membership_dues A no debe incluir saldo/pagos de B.

-- 8) player_tournaments muestra torneo/categoría/fixture/resultados y estado vacío
-- sin fixture. No hay RPC del jugador para gestionar torneos. El bug conocido
-- tournament_matches_next_target sigue pendiente y no se marca como validado.
