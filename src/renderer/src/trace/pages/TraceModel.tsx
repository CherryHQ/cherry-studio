import type { SpanEntity } from '@shared/trace'

export interface TraceModal extends SpanEntity {
  children: TraceModal[]
  start: number
  percent: number
}
