/// <reference types="vite/client" />

import type KeyvStorage from '@kangfenmao/keyv-storage'
import type { MessageInstance } from 'antd/es/message/interface'
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
    message: MessageInstance
    modal: HookAPI
    keyv: KeyvStorage
    store: any
    navigate: NavigateFunction
  }
}
