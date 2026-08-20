import type { ReactNode } from 'react'

export type HistoryRecordsMode = 'assistant' | 'agent'

/** A selectable source (assistant / agent, plus the "all" and unlinked sentinels) in the filter bar. */
export interface HistorySourceOption {
  id: string
  label: string
  icon?: ReactNode
}

/** A bulk-move destination assistant (assistant mode only). */
export interface HistoryBulkMoveTarget {
  id: string
  label: string
  icon?: ReactNode
}
