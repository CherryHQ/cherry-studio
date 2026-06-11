import type { SpanEntity } from '@mcp-trace/trace-core'

export interface TraceNode extends SpanEntity {
  children: TraceNode[]
  start: number
  percent: number
}

/**
 * Shared 3-column grid (name / spend time / progress) so the list header and every row stay aligned.
 * The only place trace styling needs to be shared; everything else is inline Tailwind.
 */
export const TRACE_ROW_GRID =
  'grid min-w-0 items-center gap-px ' +
  '[grid-template-columns:minmax(0,2.4fr)_minmax(3.5rem,0.7fr)_minmax(4rem,1fr)] ' +
  'max-[520px]:[grid-template-columns:minmax(0,1.7fr)_minmax(3.25rem,0.65fr)_minmax(3.5rem,0.75fr)]'
