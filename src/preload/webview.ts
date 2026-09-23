import { ipcRenderer } from 'electron'

import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  WebviewAnnotationHostCommandSchema
} from '@shared/types/webviewAnnotation'
import {
  isForwardableGuestKey,
  isHostOwnedGuestKey,
  toWebviewKeyPayload,
  WEBVIEW_KEYDOWN_CHANNEL
} from '@shared/utils/webviewKey'

import { WebviewAnnotationController } from './WebviewAnnotationController'

const controller = new WebviewAnnotationController(
  (event: WebviewAnnotationGuestEvent) => ipcRenderer.sendToHost(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, event),
  (event) => {
    if (event.isComposing || !isForwardableGuestKey(event)) return
    if (isHostOwnedGuestKey(event)) event.preventDefault()
    ipcRenderer.sendToHost(WEBVIEW_KEYDOWN_CHANNEL, toWebviewKeyPayload(event))
  }
)

ipcRenderer.on(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, (_event, value: unknown) => {
  const command = WebviewAnnotationHostCommandSchema.safeParse(value)
  if (command.success) controller.handleCommand(command.data)
})

window.addEventListener('unload', () => controller.dispose(), { once: true })
