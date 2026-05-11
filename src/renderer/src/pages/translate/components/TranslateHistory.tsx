import { ConfirmDialog, EmptyState, PageSidePanel } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useLanguages, useTranslateHistories, useTranslateHistory } from '@renderer/hooks/translate'
import { cn } from '@renderer/utils'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { TranslateHistory, TranslateLanguage } from '@shared/data/types/translate'
import { ArrowRight, ChevronRight, Clock, Copy, Repeat, Star, Trash2 } from 'lucide-react'
import type { FC, UIEvent } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './IconButton'

const logger = loggerService.withContext('TranslateHistory')

type DisplayedTranslateHistoryItem = TranslateHistory & {
  _sourceLabel: string
  _targetLabel: string
  _sourceEmoji: string
  _targetEmoji: string
  _createdAtLabel: string
}

type Props = {
  isOpen: boolean
  onHistoryItemClick: (history: TranslateHistory) => void
  onClose: () => void
}

const ITEM_HEIGHT = 104
const UNKNOWN_LANGUAGE = { value: 'Unknown', langCode: 'unknown' as TranslateLangCode, emoji: '🏳️' }
type DisplayLanguage = TranslateLanguage | typeof UNKNOWN_LANGUAGE

const formatCreatedAt = (value: unknown, locale: string): string => {
  if (value == null) return ''
  const d =
    value instanceof Date ? value : typeof value === 'string' || typeof value === 'number' ? new Date(value) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  const now = new Date()
  const isSameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
  if (isSameDay) return time
  const date = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(d)
  return `${date} ${time}`
}

const TranslateHistoryList: FC<Props> = ({ isOpen, onHistoryItemClick, onClose }) => {
  const { t, i18n } = useTranslation()
  const [showStared, setShowStared] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const { items, total, hasMore, isLoadingMore, loadMore, status } = useTranslateHistories({
    star: showStared || undefined
  })
  const { getLanguage, getLabel } = useLanguageLabels()
  const { clear: clearHistory, update: updateHistory } = useTranslateHistory()

  const history: DisplayedTranslateHistoryItem[] = useMemo(
    () =>
      items.map((item) => {
        const source = getLanguage(item.sourceLanguage)
        const target = getLanguage(item.targetLanguage)
        return {
          ...item,
          _sourceLabel: getLabel(source),
          _targetLabel: getLabel(target),
          _sourceEmoji: source.emoji,
          _targetEmoji: target.emoji,
          _createdAtLabel: formatCreatedAt(item.createdAt, i18n.language)
        }
      }),
    [getLabel, getLanguage, i18n.language, items]
  )

  const deferredHistory = useDeferredValue(history)

  const selectedItem = useMemo(
    () => (selectedId ? (history.find((item) => item.id === selectedId) ?? null) : null),
    [history, selectedId]
  )

  const handleClear = useCallback(async () => {
    await clearHistory()
    setSelectedId(null)
  }, [clearHistory])

  const handleClose = useCallback(() => {
    setSelectedId(null)
    onClose()
  }, [onClose])

  const copyText = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        window.toast.success(t('translate.copied'))
      } catch (error) {
        logger.error('Failed to copy translate history text', error as Error)
        window.toast.error(t('common.copy_failed'))
      }
    },
    [t]
  )

  useEffect(() => {
    if (selectedId && !history.some((h) => h.id === selectedId)) {
      setSelectedId(null)
    }
  }, [history, selectedId])

  const handleReuse = useCallback(
    (item: DisplayedTranslateHistoryItem) => {
      setSelectedId(null)
      onHistoryItemClick(item)
    },
    [onHistoryItemClick]
  )

  const estimateItemSize = useCallback(() => ITEM_HEIGHT, [])

  const handleListScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (hasMore && !isLoadingMore && el.scrollHeight - el.scrollTop - el.clientHeight < ITEM_HEIGHT * 2) {
        loadMore()
      }
    },
    [hasMore, isLoadingMore, loadMore]
  )

  const renderHistoryRow = useCallback(
    (item: DisplayedTranslateHistoryItem) => (
      <HistoryRow item={item} onSelect={setSelectedId} onUpdate={updateHistory} />
    ),
    [updateHistory]
  )

  const header = (
    <>
      <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
        <Clock size={12} className="text-muted-foreground" />
        <span>{t('translate.history.title')}</span>
        <span className="ml-0.5 text-foreground-muted">({total})</span>
      </span>
      <span className="flex-1" />
      <IconButton
        size="md"
        tone="star"
        active={showStared}
        onClick={() => setShowStared((v) => !v)}
        aria-label={t('translate.history.filter.starred')}>
        <Star size={12} className={cn(showStared && 'fill-amber-500')} />
      </IconButton>
      {history.length > 0 && (
        <IconButton
          size="md"
          tone="destructive"
          onClick={() => setConfirmClearOpen(true)}
          aria-label={t('translate.history.clear')}>
          <Trash2 size={12} />
        </IconButton>
      )}
    </>
  )

  return (
    <>
      <PageSidePanel
        open={isOpen}
        onClose={handleClose}
        header={header}
        closeLabel={t('translate.close')}
        bodyClassName="flex min-h-0 flex-col space-y-0 p-0">
        {selectedItem ? (
          <HistoryDetail
            item={selectedItem}
            onBack={() => setSelectedId(null)}
            onCopy={copyText}
            onReuse={handleReuse}
            onDeleted={() => setSelectedId(null)}
          />
        ) : deferredHistory.length > 0 ? (
          <div className="min-h-0 flex-1 p-2">
            <DynamicVirtualList list={deferredHistory} estimateSize={estimateItemSize} onScroll={handleListScroll}>
              {renderHistoryRow}
            </DynamicVirtualList>
          </div>
        ) : (
          <EmptyState
            icon={showStared ? Star : Clock}
            title={status === 'loading' ? t('common.loading') : t('translate.history.empty')}
            compact
          />
        )}
      </PageSidePanel>
      <ConfirmDialog
        open={confirmClearOpen}
        onOpenChange={setConfirmClearOpen}
        title={t('translate.history.clear')}
        description={t('translate.history.clear_description')}
        confirmText={t('translate.history.clear')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleClear}
      />
    </>
  )
}

const useLanguageLabels = () => {
  const { getLanguage: getDataApiLanguage, getLabel: getDataApiLabel } = useLanguages()

  const getLanguage = useCallback(
    (langCode: TranslateLangCode | null) =>
      langCode ? (getDataApiLanguage(langCode) ?? UNKNOWN_LANGUAGE) : UNKNOWN_LANGUAGE,
    [getDataApiLanguage]
  )

  const getLabel = useCallback(
    (language: DisplayLanguage) =>
      'createdAt' in language
        ? (getDataApiLabel(language, false) ?? language.value)
        : (getDataApiLabel(null, false) ?? language.value),
    [getDataApiLabel]
  )

  return { getLanguage, getLabel }
}

const HistoryRow: FC<{
  item: DisplayedTranslateHistoryItem
  onSelect: (id: string) => void
  onUpdate: (id: string, data: { star: boolean }) => Promise<unknown>
}> = ({ item, onSelect, onUpdate }) => {
  const { t } = useTranslation()

  const handleStar = async () => {
    await onUpdate(item.id, { star: !item.star })
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(item.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(item.id)
        }
      }}
      className="group relative flex w-full cursor-pointer flex-col gap-1.5 rounded-md p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
      <IconButton
        size="sm"
        tone="star"
        active={!!item.star}
        onClick={(e) => {
          e.stopPropagation()
          void handleStar()
        }}
        aria-label={t('translate.history.filter.starred')}
        aria-pressed={!!item.star}
        className={cn(
          'absolute top-2 right-2',
          !item.star && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
        )}>
        <Star size={10} className={cn(item.star && 'fill-amber-500')} />
      </IconButton>
      <div className="flex items-center gap-1.5 pr-5">
        <span className="rounded bg-muted px-1 py-[1px] text-[10px] text-muted-foreground">
          {item._sourceEmoji} {item._sourceLabel}
        </span>
        <ArrowRight size={8} className="text-foreground-muted" />
        <span className="rounded bg-primary/10 px-1 py-[1px] text-[10px] text-primary">
          {item._targetEmoji} {item._targetLabel}
        </span>
        <span className="ml-auto text-[10px] text-foreground-muted">{item._createdAtLabel}</span>
      </div>
      <p className="line-clamp-1 text-muted-foreground text-xs">{item.sourceText}</p>
      <p className="line-clamp-1 text-foreground text-xs">{item.targetText}</p>
    </div>
  )
}

const HistoryDetail: FC<{
  item: DisplayedTranslateHistoryItem
  onBack: () => void
  onCopy: (value: string) => Promise<void>
  onReuse: (item: DisplayedTranslateHistoryItem) => void
  onDeleted: () => void
}> = ({ item, onBack, onCopy, onReuse, onDeleted }) => {
  const { t } = useTranslation()
  const { update: updateHistory, remove: deleteHistory } = useTranslateHistory()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const handleStar = async () => {
    await updateHistory(item.id, { star: !item.star })
  }

  const handleDelete = async () => {
    await deleteHistory(item.id)
    onDeleted()
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1 rounded-md text-foreground-secondary text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <ChevronRight size={11} className="rotate-180" />
        <span>{t('translate.history.back')}</span>
      </button>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {item._sourceEmoji} {item._sourceLabel}
          </span>
          <ArrowRight size={10} className="text-foreground-muted" />
          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
            {item._targetEmoji} {item._targetLabel}
          </span>
          <span className="flex-1" />
          <IconButton
            size="sm"
            tone="star"
            active={!!item.star}
            onClick={() => void handleStar()}
            aria-label={t('translate.history.filter.starred')}
            aria-pressed={!!item.star}>
            <Star size={11} className={cn(item.star && 'fill-amber-500')} />
          </IconButton>
          <span className="text-[10px] text-foreground-muted">{item._createdAtLabel}</span>
        </div>
        <div className="rounded-md bg-muted/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] text-foreground-muted">{t('translate.history.source')}</span>
            <IconButton size="sm" onClick={() => void onCopy(item.sourceText)} aria-label={t('common.copy')}>
              <Copy size={10} />
            </IconButton>
          </div>
          <p className="wrap-break-word max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[12px] text-foreground leading-relaxed">
            {item.sourceText}
          </p>
        </div>
        <div className="rounded-md border border-border/60 bg-accent/40 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] text-foreground-secondary">{t('translate.history.target')}</span>
            <IconButton size="sm" onClick={() => void onCopy(item.targetText)} aria-label={t('common.copy')}>
              <Copy size={10} />
            </IconButton>
          </div>
          <p className="wrap-break-word max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[12px] text-foreground leading-relaxed">
            {item.targetText}
          </p>
        </div>
        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => onReuse(item)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent py-[6px] text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <Repeat size={11} />
            <span>{t('translate.history.reuse')}</span>
          </button>
          <button
            type="button"
            onClick={() => void onCopy(item.targetText)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary py-[6px] text-primary-foreground text-xs transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <Copy size={11} />
            <span>{t('translate.history.copy_target')}</span>
          </button>
          <IconButton
            size="md"
            tone="destructive"
            onClick={() => setConfirmDeleteOpen(true)}
            aria-label={t('translate.history.delete')}>
            <Trash2 size={12} />
          </IconButton>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDeleteOpen}
        onOpenChange={setConfirmDeleteOpen}
        title={t('translate.history.delete')}
        description={t('translate.history.delete_description')}
        confirmText={t('translate.history.delete')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={handleDelete}
      />
    </div>
  )
}

export default TranslateHistoryList
