/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** Clave PÚBLICA VAPID (la privada vive solo como secreto de la Edge Function). Si falta, el push se presenta como no configurado. */
  readonly VITE_VAPID_PUBLIC_KEY?: string
}
