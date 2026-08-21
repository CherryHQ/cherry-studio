import {
  isForwardableGuestKey,
  isHostOwnedGuestKey,
  MINI_APP_KEYDOWN_CHANNEL,
  toMiniAppKeyPayload
} from '@shared/utils/webviewKey'
import { ipcRenderer } from 'electron'

// Capture phase so a guest page cannot stop the host from seeing app shortcuts;
// the page still receives the key unless the host owns its default.
window.addEventListener(
  'keydown',
  (event) => {
    if (event.isComposing || !isForwardableGuestKey(event)) return
    if (isHostOwnedGuestKey(event)) {
      event.preventDefault()
    }
    ipcRenderer.sendToHost(MINI_APP_KEYDOWN_CHANNEL, toMiniAppKeyPayload(event))
  },
  true
)
