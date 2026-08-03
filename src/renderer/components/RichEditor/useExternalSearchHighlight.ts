import { loggerService } from '@logger'
import type { ContentSearchRef } from '@renderer/components/ContentSearch'
import { type RefObject, useEffect, useRef } from 'react'

const logger = loggerService.withContext('useExternalSearchHighlight')

/** Debounce before re-scanning the document for an external highlight after an edit. */
const RESCAN_DELAY_MS = 300

interface UseExternalSearchHighlightOptions {
  /** The find bar handle that owns the document's highlight layer. */
  contentSearchRef: RefObject<ContentSearchRef | null>
  /** False while there is no highlight layer to project into (no search, no editor). */
  enabled: boolean
  /** Keyword an outside search UI wants highlighted; empty retracts it. */
  keyword: string | undefined
  /** The rendered document - a change invalidates the ranges found for `keyword`. */
  content: string
}

/**
 * Projects a keyword owned by a search UI outside the editor (e.g. the notes sidebar)
 * onto the editor's highlight layer, without opening the find bar.
 *
 * Prop-driven rather than imperative on purpose: the editor is remounted on view-mode
 * changes, so a call from the page would simply be lost, while an effect re-applies
 * itself.
 */
export function useExternalSearchHighlight({
  contentSearchRef,
  enabled,
  keyword,
  content
}: UseExternalSearchHighlightOptions): void {
  const appliedKeywordRef = useRef('')

  useEffect(() => {
    if (!enabled) return
    const nextKeyword = keyword ?? ''
    const keywordChanged = appliedKeywordRef.current !== nextKeyword
    // With no external keyword there is nothing to project and - unless it was just
    // retracted - nothing to retract either. Skipping matters: the editor's own find
    // bar owns the highlight state the rest of the time, and firing an empty apply on
    // every keystroke would reset the user's Cmd+F results as they type.
    if (!nextKeyword && !keywordChanged) return

    // Re-scanning means walking every text node in the document, so an edit must not
    // trigger it per keystroke; only a keyword change is worth applying immediately.
    const timer = setTimeout(
      () => {
        try {
          contentSearchRef.current?.highlightExternal(nextKeyword)
          // Recorded only once the call has happened: a timer cleared by a rerender must
          // leave the keyword unapplied, or the next run would read "already applied" and
          // skip a retraction that never reached the editor.
          appliedKeywordRef.current = nextKeyword
        } catch (error) {
          logger.error('Failed to apply external search highlight:', error as Error)
        }
      },
      keywordChanged ? 0 : RESCAN_DELAY_MS
    )
    return () => clearTimeout(timer)
  }, [contentSearchRef, enabled, keyword, content])
}
