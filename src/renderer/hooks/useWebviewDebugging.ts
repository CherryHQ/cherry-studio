import type { WebviewTag } from 'electron'
import { useEffect, useState } from 'react'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'

const logger = loggerService.withContext('useWebviewDebugging')

export function useWebviewDebugging(webview: WebviewTag | null): boolean {
  const [state, setState] = useState<{ webview: WebviewTag; attached: boolean } | null>(null)

  useEffect(() => {
    if (!webview) {
      setState(null)
      return
    }
    let webviewId: number | undefined
    let disposed = false
    let generation = 0
    let latestRevision = -1
    const apply = (value: { attached: boolean; revision: number }) => {
      if (disposed || value.revision < latestRevision) return
      latestRevision = value.revision
      setState({ webview, attached: value.attached })
    }
    const unsubscribe = ipcApi.on('webview.debugging.changed', (value) => {
      if (value.webviewId === webviewId) apply(value)
    })
    const bind = () => {
      let id: number
      try {
        id = webview.getWebContentsId()
      } catch {
        return
      }
      if (id === webviewId) return
      webviewId = id
      const currentGeneration = ++generation
      latestRevision = -1
      setState({ webview, attached: false })
      void ipcApi
        .request('webview.debugging.get_state', { webviewId: id })
        .then((value) => {
          if (id === webviewId && currentGeneration === generation) apply(value)
        })
        .catch((error) => {
          if (!disposed) logger.debug('Unable to read webview debugging state', { error })
        })
    }
    webview.addEventListener('dom-ready', bind)
    bind()
    return () => {
      disposed = true
      unsubscribe()
      webview.removeEventListener('dom-ready', bind)
    }
  }, [webview])

  return state !== null && state.webview === webview && state.attached
}
