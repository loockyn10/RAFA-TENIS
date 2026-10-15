import type { SupabaseClient } from '@supabase/supabase-js'
import { describe, expect, it, vi } from 'vitest'
import { archivePost, createPost, fetchFeed, publishPost, signedImageUrls, updatePost, uploadPostImage } from './newsApi'
import { emptyDraft } from './newsUtils'

const draft = { ...emptyDraft('event'), title: 'Peña', body: 'Asado', eventDate: '2026-11-01', eventTime: '21:00', location: 'Quincho', featured: true }

function clientWith(rpc: (name: string, args: Record<string, unknown>) => unknown, storage?: unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const client = {
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return rpc(name, args) }),
    storage,
  } as unknown as SupabaseClient
  return { client, calls }
}

describe('newsApi (RPC)', () => {
  it('crea con la clave de la operación y los argumentos del formulario', async () => {
    const { client, calls } = clientWith(() => ({ data: { id: 'p1', status: 'draft' }, error: null }))
    const result = await createPost(client, 'club-1', draft, 'key-1')
    expect(result).toEqual({ ok: true, data: { id: 'p1', status: 'draft' } })
    expect(calls[0]).toEqual({ name: 'create_club_post', args: expect.objectContaining({ p_club_id: 'club-1', p_kind: 'event', p_event_date: '2026-11-01', p_event_time: '21:00', p_is_featured: true, p_client_request_id: 'key-1' }) })
  })

  it('actualiza por id; publicar y archivar usan sus funciones del servidor', async () => {
    const { client, calls } = clientWith(() => ({ data: { id: 'p1' }, error: null }))
    await updatePost(client, 'p1', draft)
    await publishPost(client, 'p1', true)
    await archivePost(client, 'p1')
    expect(calls.map((call) => call.name)).toEqual(['update_club_post', 'publish_club_post', 'archive_club_post'])
    expect(calls[0].args).toMatchObject({ p_post_id: 'p1' })
    expect(calls[1].args).toEqual({ p_post_id: 'p1', p_notify: true })
  })

  it('traduce los errores de negocio del servidor y oculta los técnicos', async () => {
    const business = clientWith(() => ({ data: null, error: { code: '22023', message: 'La fecha del evento no puede estar en el pasado.' } }))
    expect(await createPost(business.client, 'club-1', draft, 'k')).toEqual({ ok: false, message: 'La fecha del evento no puede estar en el pasado.' })
    const technical = clientWith(() => ({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }))
    const result = await publishPost(technical.client, 'p1', false)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.message).toMatch(/No pudimos completar/)
  })

  it('el feed del portal consulta solo el club pedido', async () => {
    const { client, calls } = clientWith(() => ({ data: [{ id: 'a' }], error: null }))
    expect(await fetchFeed(client, 'club-9')).toEqual({ ok: true, data: [{ id: 'a' }] })
    expect(calls[0]).toEqual({ name: 'club_posts_feed', args: { p_club_id: 'club-9' } })
    const failing = clientWith(() => ({ data: null, error: { message: 'x' } }))
    expect((await fetchFeed(failing.client, 'club-9')).ok).toBe(false)
  })
})

describe('newsApi (imágenes)', () => {
  const file = (type: string, size: number) => ({ type, size, name: 'mi foto.png' }) as unknown as File

  it('sube al bucket privado, bajo la carpeta del club, con nombre aleatorio y sin sobrescribir', async () => {
    const upload = vi.fn().mockResolvedValue({ error: null })
    const { client } = clientWith(() => ({}), { from: vi.fn(() => ({ upload })) })
    const result = await uploadPostImage(client, 'club-1', file('image/png', 1000))
    expect(result.ok).toBe(true)
    const [path, , options] = upload.mock.calls[0]
    expect(path).toMatch(/^club-1\/[0-9a-f-]{36}\.png$/)
    expect(path).not.toContain('mi foto')
    expect(options).toMatchObject({ upsert: false, contentType: 'image/png' })
  })

  it('rechaza tipo y tamaño inválidos sin llamar a storage', async () => {
    const from = vi.fn()
    const { client } = clientWith(() => ({}), { from })
    expect((await uploadPostImage(client, 'club-1', file('image/svg+xml', 10))).ok).toBe(false)
    expect((await uploadPostImage(client, 'club-1', file('image/png', 3 * 1024 * 1024))).ok).toBe(false)
    expect(from).not.toHaveBeenCalled()
  })

  it('un error de storage no se muestra crudo', async () => {
    const { client } = clientWith(() => ({}), { from: () => ({ upload: vi.fn().mockResolvedValue({ error: { message: 'new row violates row-level security policy' } }) }) })
    const result = await uploadPostImage(client, 'club-1', file('image/png', 10))
    expect(result.ok === false && result.message).toMatch(/No pudimos subir la imagen/)
  })

  it('las URLs firmadas se piden en un solo pedido sin repetir rutas y fallan en silencio', async () => {
    const createSignedUrls = vi.fn().mockResolvedValue({ data: [{ path: 'a.png', signedUrl: 'https://x/a' }, { path: 'b.png', signedUrl: 'https://x/b' }], error: null })
    const { client } = clientWith(() => ({}), { from: () => ({ createSignedUrls }) })
    expect(await signedImageUrls(client, ['a.png', 'b.png', 'a.png'])).toEqual({ 'a.png': 'https://x/a', 'b.png': 'https://x/b' })
    expect(createSignedUrls).toHaveBeenCalledWith(['a.png', 'b.png'], 3600)
    const broken = clientWith(() => ({}), { from: () => ({ createSignedUrls: vi.fn().mockRejectedValue(new Error('red')) }) })
    expect(await signedImageUrls(broken.client, ['a.png'])).toEqual({})
    expect(await signedImageUrls(client, [])).toEqual({})
  })
})
