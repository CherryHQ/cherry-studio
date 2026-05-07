import type { LanHandshakeAckMessage, LocalTransferPeer, LocalTransferState } from '@shared/config/types'

// ==========================================
// Transfer Status
// ==========================================

export type TransferStatus = 'idle' | 'selecting' | 'transferring' | 'completed' | 'failed'

// ==========================================
// Per-Peer Transfer State
// ==========================================

export interface LanPeerTransferState {
  transferId?: string
  fileName?: string
  progress: number
  speed?: number
  status: TransferStatus
  error?: string
}

// ==========================================
// Handshake Result
// ==========================================

export type HandshakeResult = {
  peerId: string
  ack: LanHandshakeAckMessage
  timestamp: number
} | null

// ==========================================
// Reducer State
// ==========================================

export interface LanTransferReducerState {
  open: boolean
  lanState: LocalTransferState | null
  lanHandshakePeerId: string | null
  lastHandshakeResult: HandshakeResult
  fileTransferState: Record<string, LanPeerTransferState>
  tempBackupPath: string | null
}

// ==========================================
// Reducer Actions
// ==========================================

export type LanTransferAction =
  | { type: 'SET_OPEN'; payload: boolean }
  | { type: 'SET_LAN_STATE'; payload: LocalTransferState | null }
  | { type: 'SET_HANDSHAKE_PEER_ID'; payload: string | null }
  | { type: 'SET_HANDSHAKE_RESULT'; payload: HandshakeResult }
  | { type: 'SET_TEMP_BACKUP_PATH'; payload: string | null }
  | { type: 'UPDATE_TRANSFER_STATE'; payload: { peerId: string; state: Partial<LanPeerTransferState> } }
  | { type: 'SET_TRANSFER_STATE'; payload: { peerId: string; state: LanPeerTransferState } }
  | { type: 'CLEANUP_STALE_PEERS'; payload: Set<string> }
  | { type: 'RESET_CONNECTION_STATE' }

// ==========================================
// Component Props
// ==========================================

export interface LanDeviceCardProps {
  service: LocalTransferPeer
  transferState?: LanPeerTransferState
  isConnected: boolean
  handshakeInProgress: boolean
  isDisabled: boolean
  onSendFile: (peerId: string) => void
}

export interface ProgressIndicatorProps {
  transferState: LanPeerTransferState
  handshakeInProgress: boolean
}

export interface PopupResolveData {
  // Empty for now, can be extended
}

export interface PopupContainerProps {
  resolve: (data: PopupResolveData) => void
}
