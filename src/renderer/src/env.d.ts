/// <reference types="vite/client" />

import type { PermissionUpdate } from '@anthropic-ai/claude-agent-sdk'
import type KeyvStorage from '@kangfenmao/keyv-storage'
import type { HookAPI } from 'antd/es/modal/useModal'
import type { NavigateFunction } from 'react-router-dom'

import type {
  addToast,
  closeAll,
  closeToast,
  error,
  getToastQueue,
  info,
  isToastClosing,
  loading,
  success,
  warning
} from './components/TopView/toast'

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
    agentTools: {
      respondToPermission: (payload: {
        requestId: string
        behavior: 'allow' | 'deny'
        updatedInput?: Record<string, unknown>
        message?: string
        updatedPermissions?: PermissionUpdate[]
      }) => Promise<{ success: boolean }>
    }
  }
}
