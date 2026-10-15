import { useEffect, useState, type FormEvent } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Club } from '../../types/domain'

type Person = { id: string; full_name: string }
type Invitation = { id: string; person_id: string; person_name: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null }

export function PlayerAccessPanel({ client, club, onOpenSettings }: { client: SupabaseClient; club: Club; onOpenSettings?: () => void }) {
  const [people, setPeople] = useState<Person[]>([])
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [personId, setPersonId] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [generatedCode, setGeneratedCode] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = async () => {
    setError(null)
    const [{ data: peopleData, error: peopleError }, { data: invitationsData, error: invitationsError }] = await Promise.all([
      client.from('club_people').select('id, full_name').eq('club_id', club.id).eq('active', true).order('full_name'),
      client.rpc('list_player_invitations', { p_club_id: club.id }),
    ])
    if (peopleError || invitationsError) setError('No pudimos cargar la configuración del portal.')
    else { const nextPeople = (peopleData ?? []) as Person[]; setPeople(nextPeople); setPersonId((current) => nextPeople.some((person) => person.id === current) ? current : nextPeople[0]?.id ?? ''); setInvitations((invitationsData ?? []) as Invitation[]); }
  }
  useEffect(() => { void load() }, [club.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setError(null); setNotice(null); setGeneratedCode(null)
    const { data, error: createError } = await client.rpc('create_player_invitation', { p_club_id: club.id, p_person_id: personId, p_expires_at: new Date(expiresAt).toISOString() })
    if (createError) setError('No pudimos generar la invitación. Revisá la persona y el vencimiento.')
    else { setGeneratedCode((data as { code: string }).code); setNotice('Copiá el código ahora: no se volverá a mostrar.'); void load() }
  }
  const revoke = async (id: string) => { setError(null); const { error: revokeError } = await client.rpc('revoke_player_invitation', { p_invitation_id: id }); if (revokeError) setError('No pudimos revocar la invitación.'); else void load() }
  const copy = async () => { if (generatedCode) { await navigator.clipboard?.writeText(generatedCode); setNotice('Código copiado. Compartilo manualmente con la persona.') } }
  return <section className="player-access-panel"><div className="section-heading"><div><p className="eyebrow">Portal de jugadores</p><h2>Invitaciones y reservas online</h2></div></div>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success" role="status">{notice}</p>}
    <div className="portal-admin-grid"><form className="portal-form" onSubmit={createInvitation}><h3>Generar invitación</h3><p className="subtle-copy">La persona debe tener ficha activa. El código se muestra una sola vez y se comparte manualmente.</p><label>Persona<select value={personId} onChange={(event) => setPersonId(event.target.value)} required>{people.map((person) => <option key={person.id} value={person.id}>{person.full_name}</option>)}</select></label><label>Vence<input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /></label><button disabled={!personId}>Generar código</button>{generatedCode && <div className="invitation-code"><code>{generatedCode}</code><button className="secondary-button" type="button" onClick={() => void copy()}>Copiar</button></div>}</form>
      <div className="portal-form"><h3>Reglas de reservas online</h3><p className="subtle-copy">Las reglas (horario, duraciones, anticipación, turnos y cancelación) ahora se configuran en la sección Configuración.</p>{onOpenSettings && <button className="secondary-button" type="button" onClick={onOpenSettings}>Ir a Configuración</button>}</div></div>
    <div className="invitation-list"><h3>Invitaciones emitidas</h3>{invitations.length === 0 ? <p className="subtle-copy">Todavía no emitiste invitaciones.</p> : invitations.map((invitation) => <article key={invitation.id}><div><strong>{invitation.person_name}</strong><span>Vence {new Date(invitation.expires_at).toLocaleString('es-AR')}</span></div><div>{invitation.redeemed_at ? <em>Usada</em> : invitation.revoked_at ? <em>Revocada</em> : <button className="secondary-button" type="button" onClick={() => void revoke(invitation.id)}>Revocar</button>}</div></article>)}</div>
  </section>
}
