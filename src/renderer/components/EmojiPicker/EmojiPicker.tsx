import { Scrollbar } from '@cherrystudio/ui'
import { EmojiGlyph } from '@cherrystudio/ui/fluent-emoji'
import { cn } from '@cherrystudio/ui/lib/utils'
import { loggerService } from '@logger'
import type { LanguageVarious } from '@shared/data/preference/preferenceTypes'
import { defaultLanguage } from '@shared/utils/languages'
import { defaultRangeExtractor, type Range, useVirtualizer } from '@tanstack/react-virtual'
import type { FC } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { EMOJI_CATEGORIES, RECENT_CATEGORY_LABEL_KEY } from './categories'
import { type EmojiRecord, loadStableEmojiOptions } from './data'
import { useRecentEmojis } from './useRecentEmojis'

const logger = loggerService.withContext('EmojiPicker')
const EMOJI_COLUMNS = 7
const HEADER_ROW_ESTIMATE_PX = 30
const EMOJI_ROW_ESTIMATE_PX = 43

type EmojiOption = Pick<EmojiRecord, 'emoji'> & Partial<EmojiRecord>

type EmojiPickerRow =
  | { key: string; type: 'header'; title: string }
  | { key: string; type: 'emoji'; emojis: EmojiOption[] }

interface Props {
  onEmojiClick: (emoji: string) => void
}

const EmojiPicker: FC<Props> = ({ onEmojiClick }) => {
  const { t, i18n } = useTranslation()
  const locale = i18n.language as LanguageVarious
  const [emojis, setEmojis] = useState<EmojiRecord[]>([])
  const { recent, pushRecent } = useRecentEmojis()
  const scrollRef = useRef<HTMLDivElement>(null)
  const activeStickyIndexRef = useRef(-1)

  useEffect(() => {
    let cancelled = false
    void loadStableEmojiOptions(locale)
      .catch((error) => {
        logger.error('Failed to load emoji data', error)
        if (locale === defaultLanguage) {
          return []
        }

        return loadStableEmojiOptions(defaultLanguage as LanguageVarious)
      })
      .catch((error) => {
        logger.error('Failed to load fallback emoji data', error)
        return []
      })
      .then((records) => {
        if (!cancelled) setEmojis(records)
      })
    return () => {
      cancelled = true
    }
  }, [locale])

  const groupedEmojis = useMemo(() => {
    const groups = new Map<number, EmojiRecord[]>()
    for (const record of emojis) {
      const list = groups.get(record.group) ?? []
      list.push(record)
      groups.set(record.group, list)
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.order - b.order)
    }
    return groups
  }, [emojis])

  const handleEmojiPick = (emoji: string) => {
    pushRecent(emoji)
    onEmojiClick(emoji)
  }

  const rows = useMemo(() => {
    const nextRows: EmojiPickerRow[] = []

    const appendSection = (key: string, title: string, options: EmojiOption[]) => {
      if (options.length === 0) return

      nextRows.push({ key: `${key}-header`, type: 'header', title })
      for (let index = 0; index < options.length; index += EMOJI_COLUMNS) {
        nextRows.push({
          key: `${key}-row-${index / EMOJI_COLUMNS}`,
          type: 'emoji',
          emojis: options.slice(index, index + EMOJI_COLUMNS)
        })
      }
    }

    appendSection(
      'recent',
      t(RECENT_CATEGORY_LABEL_KEY),
      recent.map((emoji) => ({ emoji }))
    )
    for (const { group, labelKey } of EMOJI_CATEGORIES) {
      appendSection(`group-${group}`, t(labelKey), groupedEmojis.get(group) ?? [])
    }

    return nextRows
  }, [groupedEmojis, recent, t])

  const stickyIndexes = useMemo(() => rows.flatMap((row, index) => (row.type === 'header' ? [index] : [])), [rows])

  const rangeExtractor = useCallback(
    (range: Range) => {
      let activeStickyIndex = -1
      for (const index of stickyIndexes) {
        if (index > range.startIndex) break
        activeStickyIndex = index
      }
      activeStickyIndexRef.current = activeStickyIndex

      const indexes = defaultRangeExtractor(range)
      if (activeStickyIndex < 0) return indexes
      return [...new Set([activeStickyIndex, ...indexes])].sort((left, right) => left - right)
    },
    [stickyIndexes]
  )

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.type === 'header' ? HEADER_ROW_ESTIMATE_PX : EMOJI_ROW_ESTIMATE_PX),
    overscan: 3,
    rangeExtractor
  })

  return (
    <div className="flex h-88 max-h-[min(22rem,calc(100vh-6rem))] w-80 max-w-[calc(100vw-2rem)] flex-col rounded-lg bg-card text-card-foreground">
      <Scrollbar ref={scrollRef} className="min-h-0 flex-1 overscroll-contain px-2.5 pb-2">
        <div className="relative w-full" style={{ height: rowVirtualizer.getTotalSize() }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]
            if (!row) return null

            const isActiveHeader = row.type === 'header' && activeStickyIndexRef.current === virtualRow.index
            return (
              <div
                key={row.key}
                ref={rowVirtualizer.measureElement}
                data-index={virtualRow.index}
                className={cn('left-0 w-full', isActiveHeader ? 'sticky top-0 z-10' : 'absolute top-0')}
                style={{ transform: isActiveHeader ? undefined : `translateY(${virtualRow.start}px)` }}>
                {row.type === 'header' ? (
                  <h3
                    className={cn(
                      'bg-card py-1.5 font-semibold text-foreground text-xs',
                      virtualRow.index > 0 && 'pt-3'
                    )}>
                    {row.title}
                  </h3>
                ) : (
                  <EmojiGrid emojis={row.emojis} onPick={handleEmojiPick} />
                )}
              </div>
            )
          })}
        </div>
      </Scrollbar>
    </div>
  )
}

interface EmojiGridProps {
  emojis: EmojiOption[]
  onPick: (emoji: string) => void
}

const EmojiGrid: FC<EmojiGridProps> = ({ emojis, onPick }) => {
  return (
    <div className="grid grid-cols-7 gap-0.5">
      {emojis.map((record) => (
        <button
          key={record.emoji}
          type="button"
          aria-label={record.annotation ?? record.emoji}
          onClick={() => onPick(record.emoji)}
          className={cn(
            'flex aspect-square items-center justify-center rounded-md text-2xl leading-none',
            'transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none'
          )}>
          <EmojiGlyph emoji={record.emoji} />
        </button>
      ))}
    </div>
  )
}

export default EmojiPicker
