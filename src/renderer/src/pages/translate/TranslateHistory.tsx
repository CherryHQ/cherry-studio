import { ConfirmDialog } from '@cherrystudio/ui'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import db from '@renderer/databases'
import useTranslate from '@renderer/hooks/useTranslate'
import { clearHistory, deleteHistory, updateTranslateHistory } from '@renderer/services/TranslateService'
import type { TranslateHistory, TranslateLanguage } from '@renderer/types'
import { cn } from '@renderer/utils'
import { useLiveQuery } from 'dexie-react-hooks'
import { isEmpty } from 'lodash'
import { ArrowRight, ChevronRight, Clock, Copy, Repeat, Star, Trash2, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { FC } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import IconButton from './components/IconButton'
import { useDrawerFocus } from './components/useDrawerFocus'

// TODO(v2/pr-14315): Replace the custom motion.div drawer + useDrawerFocus
// with `<PageSidePanel>` from `@cherrystudio/ui` once this page consumes that
// composite. Also consider `<EmptyState>` for the empty-history fallback.

type DisplayedTranslateHistoryItem = TranslateHistory & {
  _sourceLanguage: TranslateLanguage
  _targetLanguage: TranslateLanguage
  _createdAtLabel: string
}

type Props = {
  isOpen: boolean
  onHistoryItemClick: (history: DisplayedTranslateHistoryItem) => void
  onClose: () => void
}

const ITEM_HEIGHT = 104

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
  const { getLanguageByLangcode } = useTranslate()
  const rawHistory = useLiveQuery(() => db.translate_history.orderBy('createdAt').reverse().toArray(), [])
  const [showStared, setShowStared] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClearOpen, setConfirmClearOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  useDrawerFocus(isOpen, panelRef)

  const history: DisplayedTranslateHistoryItem[] = useMemo(() => {
    if (!rawHistory) return []
    return rawHistory.map((item) => ({
      ...item,
      _sourceLanguage: getLanguageByLangcode(item.sourceLanguage),
      _targetLanguage: getLanguageByLangcode(item.targetLanguage),
      _createdAtLabel: formatCreatedAt(item.createdAt, i18n.language)
    }))
  }, [getLanguageByLangcode, i18n.language, rawHistory])

  const filteredHistory = useMemo(
    () => (showStared ? history.filter((item) => item.star) : history),
    [history, showStared]
  )

  const deferredHistory = useDeferredValue(filteredHistory)

  const selectedItem = useMemo(
    () => (selectedId ? (history.find((item) => item.id === selectedId) ?? null) : null),
    [history, selectedId]
  )

  const handleStar = useCallback(
    async (id: string) => {
      const origin = history.find((item) => item.id === id)
      if (!origin) return
      await updateTranslateHistory(id, { star: !origin.star })
    },
    [history]
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await deleteHistory(id)
        if (selectedId === id) setSelectedId(null)
      } catch {
        window.toast.error(t('translate.history.error.delete'))
      }
    },
    [selectedId, t]
  )

  const handleClear = useCallback(async () => {
    await clearHistory()
    setSelectedId(null)
  }, [])

  const handleClose = useCallback(() => {
    setSelectedId(null)
    onClose()
  }, [onClose])

  const copyText = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        window.toast.success(t('translate.copied'))
      } catch {
        window.toast.error(t('common.copy_failed'))
      }
    },
    [t]
  )

  // Clean up selection if the item gets deleted externally (live query update).
  // This covers the case where an entry disappears while the detail view is open;
  // we can't detect it from a user event, so an effect is the right fit.
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

  const renderHistoryRow = useCallback(
    (item: DisplayedTranslateHistoryItem) => (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setSelectedId(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setSelectedId(item.id)
          }
        }}
        className="group relative flex w-full cursor-pointer flex-col gap-1.5 rounded-xs p-2.5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        <IconButton
          size="sm"
          tone="star"
          active={!!item.star}
          onClick={(e) => {
            e.stopPropagation()
            void handleStar(item.id)
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
            {item._sourceLanguage.label()}
          </span>
          <ArrowRight size={8} className="text-foreground-muted" />
          <span className="rounded bg-primary/10 px-1 py-[1px] text-[10px] text-primary">
            {item._targetLanguage.label()}
          </span>
          <span className="ml-auto text-[10px] text-foreground-muted">{item._createdAtLabel}</span>
        </div>
        <p className="line-clamp-1 text-muted-foreground text-xs">{item.sourceText}</p>
        <p className="line-clamp-1 text-foreground text-xs">{item.targetText}</p>
      </div>
    ),
    [handleStar, t]
  )

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="translate-history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 z-40 bg-black/5"
            onClick={handleClose}
          />
          <motion.div
            ref={panelRef}
            key="translate-history-panel"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            transition={{ type: 'spring', damping: 25, stiffness: 350 }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                handleClose()
              }
            }}
            className="absolute top-2 right-2 bottom-2 z-50 flex w-[280px] flex-col overflow-hidden rounded-xs border border-border/30 bg-popover shadow-lg"
            tabIndex={-1}>
            <div className="flex h-11 shrink-0 items-center justify-between border-border/30 border-b px-3">
              <span className="flex items-center gap-1.5 font-medium text-foreground text-sm">
                <Clock size={12} className="text-muted-foreground" />
                <span>{t('translate.history.title')}</span>
                <span className="ml-0.5 text-foreground-muted">({deferredHistory.length})</span>
              </span>
              <div className="flex items-center gap-0.5">
                <IconButton
                  size="md"
                  tone="star"
                  active={showStared}
                  onClick={() => setShowStared((v) => !v)}
                  aria-label={t('translate.history.filter.starred')}>
                  <Star size={12} className={cn(showStared && 'fill-amber-500')} />
                </IconButton>
                {!isEmpty(history) && (
                  <IconButton
                    size="md"
                    tone="destructive"
                    onClick={() => setConfirmClearOpen(true)}
                    aria-label={t('translate.history.clear')}>
                    <Trash2 size={12} />
                  </IconButton>
                )}
                <IconButton size="md" onClick={handleClose} aria-label={t('translate.close')}>
                  <X size={12} />
                </IconButton>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col">
              {selectedItem ? (
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
                  <button
                    type="button"
                    onClick={() => setSelectedId(null)}
                    className="mb-3 flex items-center gap-1 text-foreground-secondary text-xs transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                    <ChevronRight size={11} className="rotate-180" />
                    <span>{t('translate.history.back')}</span>
                  </button>
                  <div className="flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-3xs bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {selectedItem._sourceLanguage.label()}
                      </span>
                      <ArrowRight size={10} className="text-foreground-muted" />
                      <span className="rounded-3xs bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                        {selectedItem._targetLanguage.label()}
                      </span>
                      <span className="flex-1" />
                      <IconButton
                        size="sm"
                        tone="star"
                        active={!!selectedItem.star}
                        onClick={() => void handleStar(selectedItem.id)}
                        aria-label={t('translate.history.filter.starred')}
                        aria-pressed={!!selectedItem.star}>
                        <Star size={11} className={cn(selectedItem.star && 'fill-amber-500')} />
                      </IconButton>
                      <span className="text-[10px] text-foreground-muted">{selectedItem._createdAtLabel}</span>
                    </div>
                    <div className="rounded-xs bg-muted/40 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] text-foreground-muted">{t('translate.history.source')}</span>
                        <IconButton
                          size="sm"
                          onClick={() => void copyText(selectedItem.sourceText)}
                          aria-label={t('common.copy')}>
                          <Copy size={10} />
                        </IconButton>
                      </div>
                      <p className="wrap-break-word max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[12px] text-foreground leading-relaxed">
                        {selectedItem.sourceText}
                      </p>
                    </div>
                    <div className="rounded-xs border border-border/60 bg-accent/40 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] text-foreground-secondary">{t('translate.history.target')}</span>
                        <IconButton
                          size="sm"
                          onClick={() => void copyText(selectedItem.targetText)}
                          aria-label={t('common.copy')}>
                          <Copy size={10} />
                        </IconButton>
                      </div>
                      <p className="wrap-break-word max-h-[200px] overflow-y-auto whitespace-pre-wrap text-[12px] text-foreground leading-relaxed">
                        {selectedItem.targetText}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleReuse(selectedItem)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-2xs bg-accent py-[6px] text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <Repeat size={11} />
                        <span>{t('translate.history.reuse')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void copyText(selectedItem.targetText)}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded-2xs bg-primary py-[6px] text-primary-foreground text-xs transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
                        <Copy size={11} />
                        <span>{t('translate.history.copy_target')}</span>
                      </button>
                      <IconButton
                        size="md"
                        tone="destructive"
                        onClick={() => void handleDelete(selectedItem.id)}
                        aria-label={t('translate.history.delete')}>
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {deferredHistory.length > 0 ? (
                    <div className="min-h-0 flex-1 p-2">
                      <DynamicVirtualList list={deferredHistory} estimateSize={estimateItemSize}>
                        {renderHistoryRow}
                      </DynamicVirtualList>
                    </div>
                  ) : (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-foreground-muted">
                      {showStared ? <Star size={20} /> : <Clock size={20} />}
                      <span className="text-xs">{t('translate.history.empty')}</span>
                    </div>
                  )}
                </>
              )}
            </div>
          </motion.div>
          <ConfirmDialog
            open={confirmClearOpen}
            onOpenChange={setConfirmClearOpen}
            title={t('translate.history.clear')}
            description={t('translate.history.clear_description')}
            confirmText={t('translate.history.clear')}
            destructive
            onConfirm={handleClear}
          />
        </>
      )}
    </AnimatePresence>
  )
}

export default TranslateHistoryList
