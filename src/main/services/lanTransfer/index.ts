/**
 * LAN Transfer Client Module
 *
 * Protocol: v1.0 (streaming mode)
 *
 * Features:
 * - Binary frame format for file chunks (no base64 overhead)
 * - Streaming mode (no per-chunk acknowledgment)
 * - JSON messages for control flow (handshake, file_start, file_end, etc.)
 * - Global timeout protection
 * - Backpressure handling
 *
 * Binary Frame Format:
 * ┌──────────┬──────────┬──────────┬───────────────┬──────────────┬────────────┬───────────┐
 * │ Magic    │ TotalLen │ Type     │ TransferId Len│ TransferId   │ ChunkIdx   │ Data      │
 * │ 0x43 0x53│ (4B BE)  │ 0x01     │ (2B BE)       │ (variable)   │ (4B BE)    │ (raw)     │
 * └──────────┴──────────┴──────────┴───────────────┴──────────────┴────────────┴───────────┘
 */

export { HANDSHAKE_PROTOCOL_VERSION, lanTransferClientService } from './LanTransferClientService'
export type { ActiveFileTransfer, ConnectionContext, FileTransferContext, PendingResponse } from './types'
