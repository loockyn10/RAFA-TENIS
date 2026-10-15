import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminClubPost, ClubPost } from '../../types/domain'
import { IMAGE_BUCKET, draftToArgs, imageStoragePath, postErrorMessage, validateImageFile, type PostDraft } from './newsUtils'

/** Todas las escrituras pasan por RPC del servidor (validan permisos, fechas y texto plano); aquí solo se arman los argumentos. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; message: string }

const ADMIN_FIELDS = 'id, club_id, kind, title, body, status, is_featured, event_date, event_time, location, image_path, tournament_id, published_at, archived_at, notified_at, created_at, updated_at'

export const newRequestKey = (): string => globalThis.crypto.randomUUID()

export async function fetchAdminPosts(client: SupabaseClient, clubId: string): Promise<ApiResult<AdminClubPost[]>> {
  const { data, error } = await client.from('club_posts').select(ADMIN_FIELDS).eq('club_id', clubId).order('updated_at', { ascending: false }).limit(300)
  if (error) return { ok: false, message: 'No pudimos cargar las publicaciones.' }
  return { ok: true, data: (data ?? []) as AdminClubPost[] }
}

/** Publicadas del club (staff y jugadores). El servidor excluye borradores y archivadas. */
export async function fetchFeed(client: SupabaseClient, clubId: string): Promise<ApiResult<ClubPost[]>> {
  const { data, error } = await client.rpc('club_posts_feed', { p_club_id: clubId })
  if (error) return { ok: false, message: 'No pudimos cargar las novedades.' }
  return { ok: true, data: (data ?? []) as ClubPost[] }
}

export async function createPost(client: SupabaseClient, clubId: string, draft: PostDraft, requestKey: string): Promise<ApiResult<AdminClubPost>> {
  const args = draftToArgs(draft)
  const { data, error } = await client.rpc('create_club_post', { p_club_id: clubId, ...args, p_client_request_id: requestKey })
  if (error) return { ok: false, message: postErrorMessage(error) }
  return { ok: true, data: data as AdminClubPost }
}

export async function updatePost(client: SupabaseClient, postId: string, draft: PostDraft): Promise<ApiResult<AdminClubPost>> {
  const { data, error } = await client.rpc('update_club_post', { p_post_id: postId, ...draftToArgs(draft) })
  if (error) return { ok: false, message: postErrorMessage(error) }
  return { ok: true, data: data as AdminClubPost }
}

export type PublishOutcome = { id: string; status: string; notified: boolean; already_notified: boolean; recipients: number }

/** Publicar es idempotente: repetirlo (doble clic, reintento) no vuelve a avisar a los jugadores. */
export async function publishPost(client: SupabaseClient, postId: string, notify: boolean): Promise<ApiResult<PublishOutcome>> {
  const { data, error } = await client.rpc('publish_club_post', { p_post_id: postId, p_notify: notify })
  if (error) return { ok: false, message: postErrorMessage(error) }
  return { ok: true, data: data as PublishOutcome }
}

export async function archivePost(client: SupabaseClient, postId: string): Promise<ApiResult<AdminClubPost>> {
  const { data, error } = await client.rpc('archive_club_post', { p_post_id: postId })
  if (error) return { ok: false, message: postErrorMessage(error) }
  return { ok: true, data: data as AdminClubPost }
}

export type TournamentOption = { id: string; name: string; starts_on: string }
export async function fetchTournamentOptions(client: SupabaseClient, clubId: string): Promise<TournamentOption[]> {
  const { data, error } = await client.from('tournaments').select('id, name, starts_on').eq('club_id', clubId).neq('status', 'cancelled').order('starts_on', { ascending: false }).limit(50)
  return error ? [] : ((data ?? []) as TournamentOption[])
}

// ── Imágenes de portada (bucket privado, URLs firmadas de corta duración) ──

/** Sube con nombre aleatorio y sin sobrescribir (upsert=false). Devuelve la ruta a guardar en la publicación. */
export async function uploadPostImage(client: SupabaseClient, clubId: string, file: File): Promise<ApiResult<string>> {
  const problem = validateImageFile(file)
  if (problem) return { ok: false, message: problem }
  const path = imageStoragePath(clubId, file, globalThis.crypto.randomUUID())
  const { error } = await client.storage.from(IMAGE_BUCKET).upload(path, file, { upsert: false, contentType: file.type, cacheControl: '3600' })
  if (error) return { ok: false, message: 'No pudimos subir la imagen. Intentá de nuevo o publicá sin imagen.' }
  return { ok: true, data: path }
}

/** Limpieza al reemplazar o quitar una portada. Es de mejor esfuerzo: un archivo huérfano no afecta a nadie (nadie lo referencia). */
export async function removePostImage(client: SupabaseClient, path: string): Promise<void> {
  try { await client.storage.from(IMAGE_BUCKET).remove([path]) } catch { /* sin efecto visible */ }
}

export async function signedImageUrls(client: SupabaseClient, paths: string[]): Promise<Record<string, string>> {
  const unique = [...new Set(paths)]
  if (unique.length === 0) return {}
  try {
    const { data, error } = await client.storage.from(IMAGE_BUCKET).createSignedUrls(unique, 3600)
    if (error || !data) return {}
    const urls: Record<string, string> = {}
    for (const entry of data) if (entry.path && entry.signedUrl) urls[entry.path] = entry.signedUrl
    return urls
  } catch { return {} }
}
