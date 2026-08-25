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
const SNAPSHOT_MAX_ATTEMPTS = 5

/**
 * Live status of a main-managed tool: a get_status snapshot whenever the tool
 * becomes the selected one, then main-pushed status_changed events. The
 * snapshot doubles as the discovery point for a gateway started outside the
 * app, so nothing polls on either side.
 *
 * @param enabled whether this tool is the selected one; false reads nothing.
 */
export function useManagedToolStatus(tool: ManagedTool, enabled: boolean): ManagedToolStatusState {
  const [state, setState] = useState<ManagedToolStatusState>({ status: 'stopped' })
  // True once an event arrived after the current snapshot request was issued; the
  // in-flight response is then older than that event and must not overwrite it.
  const eventApplied = useRef(false)

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempts = 0

    const readSnapshot = async (): Promise<void> => {
      eventApplied.current = false // every request supersedes earlier events
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
        attempts += 1
        if (!cancelled && !eventApplied.current && attempts < SNAPSHOT_MAX_ATTEMPTS) {
          retryTimer = setTimeout(readSnapshot, SNAPSHOT_RETRY_MS)
        }
      }
    }

    void readSnapshot()
    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
    }
  }, [tool, enabled])

  // Both subscriptions are registered (hooks cannot be conditional); the
  // inactive tool's handler is a no-op filter.
  useIpcOn('deepseek_harness.status_changed', (payload) => {
    if (enabled && tool === 'deepseek-harness') {
      eventApplied.current = true
      setState({ status: payload.status, ...(payload.url ? { url: payload.url } : {}) })
    }
  })
  useIpcOn('openclaw.status_changed', (payload) => {
    if (enabled && tool === 'openclaw') {
      eventApplied.current = true
      setState({ status: payload.status })
    }
  })

  return state
}
