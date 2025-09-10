/// <reference types="vite/client" />

import { addToast, closeAll, closeToast, getToastQueue, isToastClosing } from '@heroui/toast'
import type KeyvStorage from '@kangfenmao/keyv-storage'
import { HookAPI } from 'antd/es/modal/useModal'
import { NavigateFunction } from 'react-router-dom'

import { error, info, loading, success, warning } from './components/TopView/toast'

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
    keyv: KeyvStorage
    store: any
    navigate: NavigateFunction
    toast: {
      getToastQueue: typeof getToastQueue
      addToast: typeof addToast
      closeToast: typeof closeToast
      closeAll: typeof closeAll
      isToastClosing: typeof isToastClosing
      error: typeof error
      success: typeof success
      warning: typeof warning
      info: typeof info
      loading: typeof loading
    }
  }
}
