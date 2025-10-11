/// <reference types="vite/client" />

import type { ToastUtilities } from '@cherrystudio/ui'
import type { HookAPI } from 'antd/es/modal/useModal'
import type { NavigateFunction } from 'react-router-dom'

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
    navigate: NavigateFunction
    toast: ToastUtilities
  }
}
