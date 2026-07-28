import { cn } from '@cherrystudio/ui/lib/utils'
import HighlightText from '@renderer/components/HighlightText'
import { EVENT_NAMES, EventEmitter } from '@renderer/services/EventService'
import type { SearchMatch } from '@renderer/services/NotesSearchService'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { FC } from 'react'
import { memo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SEARCH_HIGHLIGHT_CLASS } from './searchHighlight'

/** Matches shown before the list has to be expanded. */
const COLLAPSED_MATCH_COUNT = 3

interface NotesSearchMatchListProps {
  noteId: string
  keyword: string
  matches: SearchMatch[]
}

/**
 * The per-occurrence hit list under a note in the search results. Clicking a hit
 * asks NotesPage to open that note and scroll to the line, via
 * `EVENT_NAMES.LOCATE_NOTE_LINE`.
 */
const NotesSearchMatchList: FC<NotesSearchMatchListProps> = ({ noteId, keyword, matches }) => {
  const { t } = useTranslation()
  const [showAll, setShowAll] = useState(false)

  if (matches.length === 0) {
    return null
  }

  const visibleMatches = showAll ? matches : matches.slice(0, COLLAPSED_MATCH_COUNT)
  const hiddenCount = matches.length - COLLAPSED_MATCH_COUNT

  return (
    // Hairline rule instead of a filled surface: the block is subordinate to its row,
    // and the intent-tinted surfaces are compatibility-only tokens (DESIGN.md §2).
    <div className="mt-0.5 mb-1.5 ml-8 border-border border-l pl-1.5">
      {visibleMatches.map((match, index) => {
        // `visibleMatches` is a prefix of `matches`, so `index` indexes both.
        const lineMatches = matches.filter((m) => m.lineNumber === match.lineNumber)
        const indexWithinLine = matches.slice(0, index).filter((m) => m.lineNumber === match.lineNumber).length

        return (
          <button
            key={`${match.lineNumber}-${match.matchStart}-${index}`}
            type="button"
            className="flex w-full cursor-pointer gap-2 rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-left text-xs transition-colors hover:bg-muted/40"
            onClick={() => {
              void EventEmitter.emit(EVENT_NAMES.LOCATE_NOTE_LINE, {
                noteId,
                lineNumber: match.lineNumber,
                lineContent: match.lineContent,
                // The ordinal within this line, plus the line's total. The editor can
                // only resolve a top-level rendered block, which need not stand for one
                // markdown line — a list or table is one block for many lines, and a
                // link URL is counted here but never rendered. Sending the tally lets
                // the editor detect that and decline to point at a guessed hit.
                matchIndex: indexWithinLine,
                lineMatchCount: lineMatches.length
              })
            }}>
            <span className="w-6 shrink-0 text-right font-mono text-muted-foreground/70 tabular-nums">
              {match.lineNumber}
            </span>
            <HighlightText
              text={match.context}
              keyword={keyword}
              className={cn('min-w-0 flex-1 truncate text-muted-foreground', SEARCH_HIGHLIGHT_CLASS)}
            />
          </button>
        )
      })}

      {hiddenCount > 0 && (
        <button
          type="button"
          className="flex w-full cursor-pointer items-center rounded-sm border-0 bg-transparent px-1.5 py-0.5 text-left text-muted-foreground text-xs transition-colors hover:bg-muted/40 hover:text-foreground"
          onClick={() => setShowAll((prev) => !prev)}>
          {showAll ? (
            <>
              <ChevronDown size={12} className="mr-1" />
              {t('notes.search.show_less')}
            </>
          ) : (
            <>
              <ChevronRight size={12} className="mr-1" />+{hiddenCount} {t('notes.search.more_matches')}
            </>
          )}
        </button>
      )}
    </div>
  )
}

export default memo(NotesSearchMatchList)
