import type { StreamLifecycle } from './StreamLifecycle'

export const promptStreamLifecycle: StreamLifecycle = {
  name: 'prompt',
  onCreated() {},
  onPromotedToStreaming() {},
  onApprovalPendingChanged() {},
  onStallChanged() {},
  onTerminal() {},
  canAttach() {
    return false
  },
  cleanup(_stream, evict) {
    evict()
  }
}
