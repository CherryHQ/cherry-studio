import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { type RefCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { useCache } from '@data/hooks/useCache'

import type { PaintingData } from '../model/types/paintingData'
import { getPaintingFileUrl } from '../utils/paintingFileUrl'

function Step({
  item,
  items,
  selected,
  onSelect,
  onCancel,
  cardRef
}: {
  cardRef: RefCallback<HTMLDivElement>
  item: PaintingData
  items: PaintingData[]
  selected: PaintingData
  onSelect: (item: PaintingData, fileId?: string) => void
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation()
  const [live] = useCache(`painting.generation.${item.id}`)
  const running = live?.status === 'running' || item.stepStatus === 'running'
  const parent = items.find((step) => step.id === item.parentId)
  const status =
    item.stepStatus && item.stepStatus !== 'completed' ? t(`paintings.steps.${item.stepStatus}`) : undefined
  return (
    <div ref={cardRef} className="space-y-2 rounded-lg border border-border-subtle p-2">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{t('paintings.steps.version', { number: item.stepNumber ?? 1 })}</span>
        <span>{status ?? t(`paintings.steps.${item.operation ?? 'generate'}`)}</span>
      </div>
      {item.files.length ? (
        item.files.map((file, index) => (
          <Button
            key={file.id}
            variant="ghost"
            aria-label={t('paintings.steps.select', { number: item.stepNumber ?? 1, image: index + 1 })}
            aria-pressed={selected.id === item.id && (selected.selectedFileId ?? selected.files[0]?.id) === file.id}
            className="h-auto w-full overflow-hidden rounded-md p-0 aria-pressed:ring-2 aria-pressed:ring-primary"
            onClick={() => onSelect(item, file.id)}>
            <img src={getPaintingFileUrl(file)} alt="" className="aspect-square w-full object-contain" />
          </Button>
        ))
      ) : (
        <Button variant="ghost" className="h-20 w-full text-xs" onClick={() => onSelect(item)}>
          {running ? (
            <Loader2 className="size-5 animate-spin" />
          ) : (
            t(`paintings.steps.${item.stepStatus ?? 'completed'}`)
          )}
        </Button>
      )}
      {item.parentId && (
        <div className="text-xs text-muted-foreground">
          {t('paintings.steps.based_on', { number: parent?.stepNumber ?? '…' })}
        </div>
      )}
      {item.operationPrompt && (
        <details className="text-xs">
          <summary className="line-clamp-2 cursor-pointer">{item.operationPrompt}</summary>
          <p className="mt-1 whitespace-pre-wrap">{item.operationPrompt}</p>
        </details>
      )}
      {item.stepError && (
        <p className="line-clamp-3 text-xs text-destructive" title={item.stepError}>
          {item.stepError}
        </p>
      )}
      {running && (
        <Button variant="ghost" size="sm" onClick={() => onCancel(item.id)}>
          {t('common.cancel')}
        </Button>
      )}
    </div>
  )
}

export default function PaintingSteps({
  items,
  selected,
  locateRequest,
  hasMore,
  loadMore,
  onSelect,
  onCancel
}: {
  items: PaintingData[]
  selected: PaintingData
  locateRequest?: { stepId: string; sequence: number }
  hasMore: boolean
  loadMore: () => void
  onSelect: (item: PaintingData, fileId?: string) => void
  onCancel: (id: string) => void
}) {
  const { t } = useTranslation()
  const [collapsed, setCollapsed] = useState(false)
  const cards = useRef(new Map<string, HTMLDivElement>())
  const located = useRef<typeof locateRequest>(undefined)
  const requestedPage = useRef('')
  useEffect(() => {
    if (!locateRequest || located.current === locateRequest) return
    if (collapsed) {
      setCollapsed(false)
      return
    }
    const card = cards.current.get(locateRequest.stepId)
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      card.querySelector('button')?.focus({ preventScroll: true })
      located.current = locateRequest
    } else if (hasMore) {
      const page = `${locateRequest.sequence}:${items.length}`
      if (requestedPage.current !== page) {
        requestedPage.current = page
        loadMore()
      }
    }
  }, [locateRequest, collapsed, items, hasMore, loadMore])
  return (
    <aside
      aria-label={t('paintings.steps.history')}
      className={`flex min-h-0 shrink-0 flex-col border-l border-border-subtle ${collapsed ? 'w-10' : 'w-48'}`}>
      <div className="flex items-center justify-between p-2">
        {!collapsed && <span className="text-sm font-medium">{t('paintings.steps.history')}</span>}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('paintings.steps.toggle')}
          onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
      </div>
      {!collapsed && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
          {items.map((item) => (
            <Step
              key={item.id}
              item={item}
              items={items}
              selected={selected}
              onSelect={onSelect}
              onCancel={onCancel}
              cardRef={(node) => {
                if (node) cards.current.set(item.id, node)
                else cards.current.delete(item.id)
              }}
            />
          ))}
          {hasMore && (
            <Button variant="ghost" onClick={loadMore}>
              {t('paintings.steps.more')}
            </Button>
          )}
        </div>
      )}
    </aside>
  )
}
