/// <reference types="vite/client" />

declare const __APP_RELEASE_NOTES__: string
declare const __APP_RELEASE_VERSION__: string
declare const __APP_RELEASE_HISTORY__: ReadonlyArray<{
  readonly releaseNotes: string
  readonly version: string
}>

interface ImportMetaEnv {
  readonly RENDERER_VITE_AIHUBMIX_SECRET: string
  readonly RENDERER_VITE_PPIO_APP_SECRET: string
}
