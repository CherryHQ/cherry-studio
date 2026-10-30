/// <reference types="vite/client" />

import type { AppEdition } from '@shared/types/appEdition'

declare global {
  const __APP_EDITION__: AppEdition

  interface ImportMetaEnv {
    readonly RENDERER_VITE_AIHUBMIX_SECRET: string
    readonly RENDERER_VITE_PPIO_APP_SECRET: string
  }
}
