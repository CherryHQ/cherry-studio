import { createContext, use } from 'react'

import type { PaintingData } from '../../model/types/paintingData'

/**
 * Stable canvas actions shared with every node via context — keeps node `data`
 * primitive (so `memo` holds) and avoids prop-drilling callbacks through React
 * Flow. Provided by `CanvasView`; consumed by `PaintingNode` / its toolbar and
 * context menu.
 */
export interface CanvasActions {
  /** Load this card's image into the composer under edit mode (replaces the draft). */
  onEdit: (source: PaintingData) => void
  /** One click: fork a new card from this card's recipe and generate it right away. */
  onRegenerate: (source: PaintingData) => void
  /** Append this card's image to the current composer draft as an input. */
  onAddToChat: (source: PaintingData) => void
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
