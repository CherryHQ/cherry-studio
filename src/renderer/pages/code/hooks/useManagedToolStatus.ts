import { ipcApi, useIpcOn } from '@renderer/ipc'
import { loggerService } from '@renderer/services/LoggerService'
import { useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useManagedToolStatus')

/** The managed-tool lifecycle states shared by DeepSeek Harness and the OpenClaw gateway. */
export type ManagedToolStatus = 'stopped' | 'starting' | 'running' | 'error'

export type ManagedTool = 'deepseek-harness' | 'openclaw'

export interface ManagedToolStatusState {
  status: ManagedToolStatus
  /** Web UI base URL; only DeepSeek Harness reports one. */
  url?: string
}

const SNAPSHOT_RETRY_MS = 2000

/**
 * Live status of a main-managed tool: one get_status snapshot on mount, then
 * main-pushed status_changed events. Crashes and externally-started gateways
 * surface as they happen — no renderer polling.
 */
export function useManagedToolStatus(tool: ManagedTool): ManagedToolStatusState {
  const [state, setState] = useState<ManagedToolStatusState>({ status: 'stopped' })
  // An applied event is newer than any in-flight snapshot; set on the event path,
  // read by the snapshot path to drop stale bootstrap replies.
  const eventApplied = useRef(false)

  useEffect(() => {
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    eventApplied.current = false

    const readSnapshot = async (): Promise<void> => {
      try {
        if (tool === 'deepseek-harness') {
          const snapshot = await ipcApi.request('deepseek_harness.get_status')
          if (!cancelled && !eventApplied.current) {
            setState({ status: snapshot.status, ...(snapshot.url ? { url: snapshot.url } : {}) })
          }
        } else {
          const snapshot = await ipcApi.request('openclaw.get_status')
          if (!cancelled && !eventApplied.current) setState({ status: snapshot.status })
        }
      } catch (error) {
        // A failed snapshot leaves the default 'stopped' rendering with no event to
        // correct it (e.g. mount racing service readiness) — retry until it lands.
        logger.error(`Failed to read ${tool} status`, error as Error)
        if (!cancelled && !eventApplied.current) retryTimer = setTimeout(readSnapshot, SNAPSHOT_RETRY_MS)
      }
    }

    void readSnapshot()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [tool])

  // Both subscriptions are registered (hooks cannot be conditional); the
  // inactive tool's handler is a no-op filter.
  useIpcOn('deepseek_harness.status_changed', (payload) => {
    if (tool === 'deepseek-harness') {
      eventApplied.current = true
      setState({ status: payload.status, ...(payload.url ? { url: payload.url } : {}) })
    }
  })
  useIpcOn('openclaw.status_changed', (payload) => {
    if (tool === 'openclaw') {
      eventApplied.current = true
      setState({ status: payload.status })
    }
  })

  return state
}
