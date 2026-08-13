import type { SpanEntity } from '@mcp-trace/trace-core/types/config'
import * as z from 'zod'

export interface TraceDataCursor {
  historyVersion: string | null
  liveRevision: number
}

export interface TraceDataResult {
  cursor: TraceDataCursor
  /** A reset replaces the viewer snapshot; otherwise `spans` contains live changes only. */
  reset: boolean
  spans: SpanEntity[]
}

/**
 * Container-level OTel trace id: 32 lowercase hex chars. {@link deriveRootSpanId} and the
 * trace viewer silently depend on this shape, so validate it at the schema boundary instead
 * of accepting any string.
 */
export const TraceIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'traceId must be 32 lowercase hex chars')

/**
 * Deterministic synthetic root span id for a container trace: the first 16 hex of the
 * traceId (a span id is 16 hex; a trace id is 32). Falls back to a fixed non-zero id when
 * those happen to be all-zero. Stable across reconnects / restarts, so once the wiring emits
 * per-turn child spans under it, every turn span and the Claude Code subprocess parent to the
 * same container root.
 *
 * Lives in `shared` because both the main-process trace producers and the renderer trace
 * viewer (which re-homes warm subprocess spans under the turn that owns them) must agree on
 * the container root id.
 */
export function deriveRootSpanId(traceId: string): string {
  const head = traceId.slice(0, 16).toLowerCase()
  return /^[0-9a-f]{16}$/.test(head) && head !== '0000000000000000' ? head : '1111111111111111'
}
