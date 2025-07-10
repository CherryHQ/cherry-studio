import { SpanEntity } from '@mcp-trace/trace-core'

export interface TraceModal extends SpanEntity {
  children: TraceModal[]
  start: number
  percent: number
}
