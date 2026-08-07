import {
  WEBVIEW_ANNOTATION_BRIDGE_CHANNEL,
  type WebviewAnnotationGuestEvent,
  WebviewAnnotationHostCommandSchema
} from '@shared/types/webview'
import { ipcRenderer } from 'electron'

import { WebviewAnnotationController } from './WebviewAnnotationController'

const controller = new WebviewAnnotationController((state) => {
  const event: WebviewAnnotationGuestEvent = { type: 'state_changed', state }
  ipcRenderer.sendToHost(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, event)
})

ipcRenderer.on(WEBVIEW_ANNOTATION_BRIDGE_CHANNEL, (_event, value: unknown) => {
  const command = WebviewAnnotationHostCommandSchema.safeParse(value)
  if (command.success) controller.handleCommand(command.data)
})

window.addEventListener('unload', () => controller.dispose(), { once: true })
