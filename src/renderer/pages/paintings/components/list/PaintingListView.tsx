import { Button } from '@cherrystudio/ui'
import { type FC, type ReactNode, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { groupPaintings } from '../../model/groupPaintings'
import type { PaintingData } from '../../model/types/paintingData'
import PaintingListEntry, { type PaintingListEntryActions } from './PaintingListEntry'

interface PaintingListViewProps extends PaintingListEntryActions {
  items: PaintingData[]
  /** In-flight placeholders (status `generating`), shown as a pending entry at the bottom. */
  inflightCards: PaintingData[]
  hasMore: boolean
  loadMore: () => void
  /** The shared `<PaintingComposer>` element, docked at the bottom. */
  composer: ReactNode
}

/**
 * Chat-style message feed of generations: oldest at top, newest at bottom, a
 * bottom-docked composer. Each generation is one entry (a multi-image group is
 * one row of thumbnails). It reuses the workspace's data + card actions and
 * never touches canvas-only concerns (positions / hull / drag).
 */
const PaintingListView: FC<PaintingListViewProps> = ({
  items,
  inflightCards,
  hasMore,
  loadMore,
  composer,
  ...actions
}) => {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  // History is newest-first → reverse so the newest sits at the bottom.
  const entries = useMemo(() => groupPaintings(items).reverse(), [items])
  const pending = useMemo(() => groupPaintings(inflightCards), [inflightCards])

  // Chat behavior: pin to the newest — scroll to the bottom on send / arrival / page-in.
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [items.length, inflightCards.length])

  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pt-14 pb-4">
          {hasMore && (
            <Button variant="ghost" size="sm" className="self-center text-muted-foreground" onClick={loadMore}>
              {t('paintings.list.load_more')}
            </Button>
          )}
          {entries.map((entry) => (
            <PaintingListEntry key={entry.key} entry={entry} {...actions} />
          ))}
          {pending.map((entry) => (
            <PaintingListEntry key={entry.key} entry={entry} pending {...actions} />
          ))}
        </div>
      </div>

      <div className="shrink-0 border-border-subtle border-t px-4 py-3">
        <div className="mx-auto w-full max-w-3xl">{composer}</div>
      </div>
    </div>
  )
}

export default PaintingListView
