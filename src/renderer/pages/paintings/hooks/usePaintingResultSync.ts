import { type Dispatch, type SetStateAction, useEffect } from 'react'

import type { PaintingData } from '../model/types/paintingData'

interface UsePaintingResultSyncInput {
  currentPainting: PaintingData
  historyItems: PaintingData[]
  setCurrentPainting: Dispatch<SetStateAction<PaintingData>>
}

/**
 * Backfill a completed generation's output files into the live `currentPainting`
 * when they only landed in refreshed history.
 *
 * A background generation finishes by calling `usePaintingGeneration`'s
 * `applyIfVisible` — a no-op when the finishing painting isn't the visible one at
 * completion time (the user switched away, or the generation belongs to a prior,
 * now-unmounted page instance). In that case the in-memory draft keeps
 * `files: []` while the DB row — and therefore the refreshed history — gained the
 * outputs. `usePaintingInitialSelection` only bootstraps once, so it won't
 * re-adopt the now-file-bearing history item.
 *
 * The Artboard's reveal machine, having watched loading go false with no file,
 * then parks at `{ status: 'awaiting' }` forever — there is no `succeeded`
 * generationStatus for it to escape on. Copying the files in supplies the
 * `currentFile` the reveal is waiting for. Only `files` is synced — prompt,
 * params, inputFiles and every other local edit are preserved — and only when
 * history carries strictly more outputs than the local copy, so a fresh draft
 * (absent from history) and an in-flight generation (history not yet caught up)
 * are both left untouched and the sync is idempotent.
 */
export function usePaintingResultSync({
  currentPainting,
  historyItems,
  setCurrentPainting
}: UsePaintingResultSyncInput) {
  const currentId = currentPainting.id
  const localFileCount = currentPainting.files.length
  const historyFiles = historyItems.find((item) => item.id === currentId)?.files

  useEffect(() => {
    if (!historyFiles || historyFiles.length <= localFileCount) return
    setCurrentPainting((prev) => {
      // Re-check against the freshest state: the visible generation's own
      // applyIfVisible may have merged these files between render and commit.
      if (prev.id !== currentId || prev.files.length >= historyFiles.length) return prev
      return { ...prev, files: historyFiles }
    })
  }, [currentId, localFileCount, historyFiles, setCurrentPainting])
}
