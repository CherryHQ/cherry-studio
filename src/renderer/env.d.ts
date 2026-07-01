/// <reference types="vite/client" />

import type { ToastUtilities } from '@cherrystudio/ui'
import type { AppModalApi } from '@renderer/components/AppModal'
import type { UseNavigateResult } from '@tanstack/react-router'

declare global {
  interface ImportMetaEnv {
    readonly RENDERER_VITE_AIHUBMIX_SECRET: string
    readonly RENDERER_VITE_PPIO_APP_SECRET: string
  }

  interface Window {
    root: HTMLElement
    modal: AppModalApi
    navigate: UseNavigateResult<string>
    toast: ToastUtilities
  }
}
