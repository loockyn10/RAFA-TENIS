import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { signedImageUrls } from './newsApi'

/** Resuelve en un solo pedido las URLs firmadas de las portadas visibles. Si falla, las tarjetas se muestran sin imagen. */
export function useSignedImages(client: SupabaseClient, paths: (string | null | undefined)[]): Record<string, string> {
  const key = useMemo(() => [...new Set(paths.filter((path): path is string => Boolean(path)))].sort().join('|'), [paths])
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    if (!key) { setUrls({}); return }
    void signedImageUrls(client, key.split('|')).then((next) => { if (!cancelled) setUrls(next) })
    return () => { cancelled = true }
  }, [client, key])
  return urls
}
