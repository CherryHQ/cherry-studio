import { TopView } from '@renderer/components/TopView'

import { getHideCallback, PopupContainer } from './popup'
import type { PopupResolveData } from './types'

// Re-export types for external use
export type { LanPeerTransferState } from './types'

const TopViewKey = 'LanTransferPopup'

export default class LanTransferPopup {
  static topviewId = 0

  static hide() {
    // Try to use the registered callback for proper cleanup, fallback to TopView.hide
    const callback = getHideCallback()
    if (callback) {
      callback()
    } else {
      TopView.hide(TopViewKey)
    }
  }

  static show() {
    return new Promise<PopupResolveData>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide(TopViewKey)
          }}
        />,
        TopViewKey
      )
    })
  }
}
