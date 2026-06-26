import { createContext, use } from 'react'

import type { PaintingData } from '../../model/types/paintingData'
import type { CanvasOp } from './canvasOps'

/**
 * Stable canvas actions shared with every node via context — keeps node `data`
 * primitive (so `memo` holds) and avoids prop-drilling callbacks through React
 * Flow. Provided by `CanvasView`; consumed by `PaintingNode` / its toolbar and
 * context menu.
 */
export interface CanvasActions {
  /** Derive a new generation from this card under the op's mode. */
  onNodeOp: (op: CanvasOp, source: PaintingData) => void
  onDelete: (source: PaintingData) => void
  onDownload: (source: PaintingData) => void
  onCopyPrompt: (source: PaintingData) => void
  onResize: (id: string, width: number) => void
  /** Re-run a failed/canceled card's generation in place (same recipe). */
  onRetry: (source: PaintingData) => void
}

const CanvasActionsContext = createContext<CanvasActions | null>(null)

export const CanvasActionsProvider = CanvasActionsContext.Provider

export function useCanvasActions(): CanvasActions {
  const ctx = use(CanvasActionsContext)
  if (!ctx) throw new Error('useCanvasActions must be used within a CanvasView')
  return ctx
}
