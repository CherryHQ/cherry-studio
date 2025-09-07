/// <reference types="vite/client" />

import { addToast, closeAll, closeToast, getToastQueue, isToastClosing } from '@heroui/toast'
import type KeyvStorage from '@kangfenmao/keyv-storage'
import { MessageInstance } from 'antd/es/message/interface'
import { HookAPI } from 'antd/es/modal/useModal'
import { NavigateFunction } from 'react-router-dom'

interface ImportMetaEnv {
  VITE_RENDERER_INTEGRATED_MODEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare global {
  interface Window {
    root: HTMLElement
    /**
     * @deprecated
     */
    message: MessageInstance
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
    }
  }
}
