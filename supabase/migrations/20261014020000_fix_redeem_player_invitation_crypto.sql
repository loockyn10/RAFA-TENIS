-- Sprint 10B.1 / SEC-01: el canje de invitaciones debe resolver digest() en el esquema donde Supabase instala pgcrypto.
-- Dependencias: 20261013080000_player_portal.sql (crea la función y las tablas). No requiere las otras migraciones 10B.1.
-- 20261014000000 corrigió solo create_player_invitation; esta corrige redeem_player_invitation.
-- Cuerpo idéntico al original salvo extensions.digest(...): mismas validaciones, uso único, vencimiento, revocación,
-- bloqueo FOR UPDATE de la invitación (canje concurrente) y aislamiento por club. No modifica datos.

do $$
begin
  if to_regprocedure('extensions.digest(text,text)') is null then
    raise exception 'pgcrypto no está instalado en el esquema extensions: no se puede corregir redeem_player_invitation.' using errcode = '58000';
  end if;
end $$;

create or replace function public.redeem_player_invitation(p_code text)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public
as $$
declare v_invitation public.player_invitations; v_person public.club_people;
begin
  if auth.uid() is null or char_length(trim(coalesce(p_code, ''))) < 32 then raise exception 'No pudimos validar el código de invitación.' using errcode = '22023'; end if;
  select * into v_invitation from public.player_invitations
  where token_hash = encode(extensions.digest(trim(p_code), 'sha256'), 'hex') for update;
  if not found or v_invitation.expires_at <= now() or v_invitation.redeemed_at is not null or v_invitation.revoked_at is not null then raise exception 'No pudimos validar el código de invitación.' using errcode = '22023'; end if;
  select * into v_person from public.club_people where club_id = v_invitation.club_id and id = v_invitation.person_id for key share;
  if not found or not v_person.active then raise exception 'No pudimos validar el código de invitación.' using errcode = '22023'; end if;
  if exists (select 1 from public.club_person_auth_links where club_id = v_invitation.club_id and (person_id = v_invitation.person_id or auth_user_id = auth.uid())) then raise exception 'Esta cuenta o persona ya tiene una vinculación en el club.' using errcode = '23505'; end if;
  insert into public.club_person_auth_links(club_id, person_id, auth_user_id, created_by) values (v_invitation.club_id, v_invitation.person_id, auth.uid(), v_invitation.created_by);
  update public.player_invitations set redeemed_at = now(), redeemed_by = auth.uid() where id = v_invitation.id;
  return jsonb_build_object('club_id', v_invitation.club_id, 'person_id', v_invitation.person_id);
end;
$$;

-- create or replace conserva los privilegios; se reafirman por claridad (solo authenticated).
revoke all on function public.redeem_player_invitation(text) from public, anon;
grant execute on function public.redeem_player_invitation(text) to authenticated;
