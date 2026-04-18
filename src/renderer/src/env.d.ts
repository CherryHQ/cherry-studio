/// <reference types="vite/client" />

import type { ToastUtilities } from '@cherrystudio/ui'
import type { UseNavigateResult } from '@tanstack/react-router'
import type { HookAPI } from 'antd/es/modal/useModal'

interface ImportMetaEnv {
  VITE_RENDERER_INTEGRATED_MODEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    root: HTMLElement
    modal: HookAPI
    store: any
    navigate: UseNavigateResult<string>
    toast: ToastUtilities
  }
}
