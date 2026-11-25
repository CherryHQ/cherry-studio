import type { TraceSpanSnapshot } from '../core/spanConvert'

export interface TraceStore {
  createSpan: (span: TraceSpanSnapshot) => void
  endSpan: (span: TraceSpanSnapshot) => void
  clear: () => void
}
