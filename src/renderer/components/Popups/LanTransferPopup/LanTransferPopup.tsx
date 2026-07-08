import { createPopup } from '@renderer/services/popup'

import { PopupContainer } from './PopupContainer'
import type { PopupResolveData } from './types'

// Re-export types for external use
export type { LanPeerTransferState } from './types'

const LanTransferPopup = createPopup<Record<string, never>, PopupResolveData>(PopupContainer, { dismissResult: {} })

export default LanTransferPopup
