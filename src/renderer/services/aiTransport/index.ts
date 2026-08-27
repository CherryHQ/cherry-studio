// Public API of the renderer-side AI-streaming runtime. Consumers import from
// this barrel; the directory's other files are internal. See
// docs/references/architecture/renderer.md §5.
export {
  ConversationOverlayDurability,
  type ConversationOverlayRecoveryBinding,
  type ExecutionFinishEvent,
  type ExecutionOverlayActiveNodeOverride,
  ExecutionOverlayPhase,
  type ExecutionOverlayRecord,
  type ExecutionOverlayView,
  executionStreamOverlayService
} from './ExecutionStreamOverlayService'
export { getStreamBlockedMessage } from './getStreamBlockedMessage'
export { IpcChatTransport, ipcChatTransport } from './IpcChatTransport'
