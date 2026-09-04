import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  WebviewAnnotationHostCommandSchema
} from '@shared/types/webviewAnnotation'
import {
  isForwardableGuestKey,
  isHostOwnedGuestKey,
  MINI_APP_KEYDOWN_CHANNEL,
  toMiniAppKeyPayload
} from '@shared/utils/webviewKey'
import { ipcRenderer } from 'electron'

import { WebviewAnnotationController } from './WebviewAnnotationController'

const controller = new WebviewAnnotationController((event: WebviewAnnotationGuestEvent) =>
  ipcRenderer.sendToHost(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, event)
)

ipcRenderer.on(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, (_event, value: unknown) => {
  const command = WebviewAnnotationHostCommandSchema.safeParse(value)
  if (command.success) controller.handleCommand(command.data)
})

// A `<webview>` accepts only one preload. Site shortcuts and annotations therefore
// share this entry; local mini apps retain their separate sandbox capability bridge.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.isComposing || !isForwardableGuestKey(event)) return
    if (isHostOwnedGuestKey(event)) event.preventDefault()
    ipcRenderer.sendToHost(MINI_APP_KEYDOWN_CHANNEL, toMiniAppKeyPayload(event))
  },
  true
)

window.addEventListener('unload', () => controller.dispose(), { once: true })
