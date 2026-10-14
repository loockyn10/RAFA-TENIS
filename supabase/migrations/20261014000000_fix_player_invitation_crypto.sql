-- Sprint 09: corregir funciones criptográficas
-- utilizadas para generar invitaciones.

CREATE OR REPLACE FUNCTION public.create_player_invitation(
    p_club_id uuid,
    p_person_id uuid,
    p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_token text;
    v_invitation public.player_invitations;
BEGIN

    -- Verificar permisos
    IF auth.uid() IS NULL
       OR NOT private.can_manage_club_memberships(p_club_id)
    THEN
        RAISE EXCEPTION
            'No tenés permiso para invitar jugadores en este club.'
            USING errcode = '42501';
    END IF;

    -- Verificar vencimiento
    IF p_expires_at <= now() THEN
        RAISE EXCEPTION
            'La invitación debe vencer en el futuro.'
            USING errcode = '22023';
    END IF;

    -- Verificar persona
    IF NOT EXISTS (
        SELECT 1
        FROM public.club_people
        WHERE club_id = p_club_id
          AND id = p_person_id
          AND active
    ) THEN
        RAISE EXCEPTION
            'La persona no existe o está inactiva en este club.'
            USING errcode = '23503';
    END IF;

    -- Evitar invitaciones para cuentas vinculadas
    IF EXISTS (
        SELECT 1
        FROM public.club_person_auth_links
        WHERE club_id = p_club_id
          AND person_id = p_person_id
    ) THEN
        RAISE EXCEPTION
            'Esta persona ya tiene una cuenta vinculada en el club.'
            USING errcode = '23505';
    END IF;

    -- Revocar invitaciones anteriores
    UPDATE public.player_invitations
    SET revoked_at = now(),
        revoked_by = auth.uid()
    WHERE club_id = p_club_id
      AND person_id = p_person_id
      AND redeemed_at IS NULL
      AND revoked_at IS NULL;

    -- CORRECCIÓN: especificar esquema extensions
    v_token := encode(
        extensions.gen_random_bytes(32),
        'hex'
    );

    -- Guardar invitación
    INSERT INTO public.player_invitations (
        club_id,
        person_id,
        token_hash,
        expires_at,
        created_by
    )
    VALUES (
        p_club_id,
        p_person_id,
        encode(
            extensions.digest(v_token, 'sha256'),
            'hex'
        ),
        p_expires_at,
        auth.uid()
    )
    RETURNING * INTO v_invitation;

    RETURN jsonb_build_object(
        'id', v_invitation.id,
        'code', v_token,
        'expires_at', v_invitation.expires_at
    );

END;
$$;