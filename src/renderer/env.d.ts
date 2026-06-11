/// <reference types="vite/client" />

import type { ToastUtilities } from '@cherrystudio/ui'
import type { AppModalApi } from '@renderer/components/AppModal'
import type { UseNavigateResult } from '@tanstack/react-router'

interface ImportMetaEnv {
  VITE_RENDERER_INTEGRATED_MODEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    root: HTMLElement
    modal: AppModalApi
    store: any
    navigate: UseNavigateResult<string>
    toast: ToastUtilities
  }
}
