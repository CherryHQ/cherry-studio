import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { useEffect, useState } from 'react'

const logger = loggerService.withContext('useManagedToolStatus')

/** The managed-tool lifecycle states shared by DeepSeek Harness and the OpenClaw gateway. */
export type ManagedToolStatus = 'stopped' | 'starting' | 'running' | 'error'

export type ManagedTool = 'deepseek-harness' | 'openclaw'

export interface ManagedToolStatusState {
  status: ManagedToolStatus
  /** Web UI base URL; only DeepSeek Harness reports one. */
  url?: string
}

/**
 * Live status of a main-managed tool: one get_status snapshot on mount, then
 * main-pushed status_changed events. Crashes and externally-started gateways
 * surface as they happen — no renderer polling.
 */
export function useManagedToolStatus(tool: ManagedTool): ManagedToolStatusState {
  const [state, setState] = useState<ManagedToolStatusState>({ status: 'stopped' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        if (tool === 'deepseek-harness') {
          const snapshot = await ipcApi.request('deepseek_harness.get_status')
          if (!cancelled) setState({ status: snapshot.status, ...(snapshot.url ? { url: snapshot.url } : {}) })
        } else {
          const snapshot = await ipcApi.request('openclaw.get_status')
          if (!cancelled) setState({ status: snapshot.status })
        }
      } catch (error) {
        logger.error(`Failed to read ${tool} status`, error as Error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [tool])

  // Both subscriptions are registered (hooks cannot be conditional); the
  // inactive tool's handler is a no-op filter.
  useIpcOn('deepseek_harness.status_changed', (payload) => {
    if (tool === 'deepseek-harness') setState({ status: payload.status, ...(payload.url ? { url: payload.url } : {}) })
  })
  useIpcOn('openclaw.status_changed', (payload) => {
    if (tool === 'openclaw') setState({ status: payload.status })
  })

  return state
}
