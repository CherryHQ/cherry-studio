import { ipcRenderer } from 'electron'

import { mcpAppGuestMessage, mcpAppHostMessage } from '@shared/types/mcpApp'

if (process.isMainFrame) {
  const frame = () => document.querySelector('iframe')?.contentWindow

  window.addEventListener('message', (event) => {
    if (!event.source || event.source !== frame() || event.origin !== 'null') return
    try {
      const payload = JSON.stringify(event.data)
      if (payload && payload.length <= 256 * 1024) ipcRenderer.send(mcpAppGuestMessage, payload)
    } catch {
      // postMessage accepts values that the JSON-RPC transport cannot serialize.
    }
  })

  ipcRenderer.on(mcpAppHostMessage, (_event, message: unknown) => {
    frame()?.postMessage(message, '*')
  })
}
