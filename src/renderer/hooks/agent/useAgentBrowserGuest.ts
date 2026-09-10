import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { WebviewTag } from 'electron'
import { useEffect, useRef, useState } from 'react'

const logger = loggerService.withContext('useAgentBrowserGuest')

export function useAgentBrowserGuest(
  sessionId: string | undefined,
  guest: WebviewTag | null,
  revision: number
): string | undefined {
  const [binding, setBinding] = useState<{ guest: WebviewTag; sessionId: string; tabId: string }>()
  const operations = useRef<Promise<void>>(Promise.resolve())
  useEffect(() => {
    if (!sessionId || !guest) return
    let cancelled = false
    let attaching = false
    let tabId: string | undefined
    const detach = (id: string) => ipcApi.request('browser.pane.detach', { sessionId, tabId: id })
    const attach = () => {
      if (attaching || tabId) return
      attaching = true
      operations.current = operations.current.then(async () => {
        try {
          if (cancelled) return
          const webviewId = guest.getWebContentsId()
          if (!webviewId) return
          const result = await ipcApi.request('browser.pane.attach', { sessionId, webviewId })
          if (cancelled) await detach(result.tabId)
          else {
            tabId = result.tabId
            setBinding({ guest, sessionId, tabId })
          }
        } catch (error) {
          logger.debug('Browser guest is not ready to attach', { error })
        } finally {
          attaching = false
        }
      })
    }
    guest.addEventListener('dom-ready', attach)
    attach()
    return () => {
      cancelled = true
      guest.removeEventListener('dom-ready', attach)
      if (tabId) {
        const detachedId = tabId
        operations.current = operations.current
          .then(() => detach(detachedId))
          .catch((error) => logger.debug('Browser guest already detached', { error }))
      }
    }
  }, [sessionId, guest, revision])
  return binding?.guest === guest && binding?.sessionId === sessionId ? binding?.tabId : undefined
}
