import { ConfirmDialog, EmptyState, PageSidePanel } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { useLanguages, useTranslateHistories, useTranslateHistory } from '@renderer/hooks/translate'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { cn } from '@renderer/utils/style'
import type { TranslateLangCode } from '@shared/data/preference/preferenceTypes'
import type { FileEntryId } from '@shared/data/types/file'
import type { TranslateHistory, TranslateLanguage } from '@shared/data/types/translate'
import { createFileEntryHandle } from '@shared/utils/file'
import {
  ArrowRight,
  ChevronRight,
  Clock,
  Copy,
  Download,
  FileText,
  FolderOpen,
  Repeat,
  Star,
  Trash2
} from 'lucide-react'
import type { FC, UIEvent } from 'react'
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  isPdfTranslation,
  loadTranslationFiles,
  saveTranslationFileAs,
  type TranslationFiles
} from '../translationFiles'
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
  onHistoryItemClick: (history: TranslateHistory, files?: TranslationFiles) => void
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
    star: showStared || undefined,
    enabled: isOpen
  })
  const { getLanguage, getLabel } = useLanguageLabels(isOpen)
  const { clear: clearHistory, update: updateHistory } = useTranslateHistory()
  const pendingLoadMoreRef = useRef(false)

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
    try {
      await clearHistory()
      setSelectedId(null)
    } catch {
      // `useTranslateHistory` already handles toast/log feedback; swallow to keep ConfirmDialog close flow.
    }
  }, [clearHistory])

  const handleClose = useCallback(() => {
    setSelectedId(null)
    onClose()
  }, [onClose])

  const copyText = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value)
        toast.success(t('translate.copied'))
      } catch (error) {
        logger.error('Failed to copy translate history text', error as Error)
        toast.error(t('common.copy_failed'))
      }
    },
    [t]
  )

  useEffect(() => {
    if (selectedId && !history.some((h) => h.id === selectedId)) {
      setSelectedId(null)
    }
  }, [history, selectedId])

  useEffect(() => {
    pendingLoadMoreRef.current = false
  }, [hasMore, history.length, isLoadingMore])

  const handleReuse = useCallback(
    (item: DisplayedTranslateHistoryItem, files?: TranslationFiles) => {
      setSelectedId(null)
      if (files) {
        onHistoryItemClick(item, files)
      } else {
        onHistoryItemClick(item)
      }
    },
    [onHistoryItemClick]
  )

  const estimateItemSize = useCallback(() => ITEM_HEIGHT, [])

  const handleListScroll = useCallback(
    (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget
      if (
        hasMore &&
        !isLoadingMore &&
        !pendingLoadMoreRef.current &&
        el.scrollHeight - el.scrollTop - el.clientHeight < ITEM_HEIGHT * 2
      ) {
        pendingLoadMoreRef.current = true
        queueMicrotask(loadMore)
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
  const showHistoryActions = showStared || history.length > 0
  const header = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="truncate font-semibold text-base text-foreground">{`${t('translate.history.title')} (${total})`}</span>
      <span className="flex-1" />
      {!selectedItem && showHistoryActions && (
        <div className="flex shrink-0 items-center gap-1">
          <IconButton
            size="md"
            tone="star"
            active={showStared}
            onClick={() => setShowStared((v) => !v)}
            aria-label={t('translate.history.filter.starred')}
            aria-pressed={showStared}>
            <Star size={14} className={cn(showStared && 'fill-amber-500')} />
          </IconButton>
          {history.length > 0 && (
            <IconButton
              size="md"
              tone="destructive"
              onClick={() => setConfirmClearOpen(true)}
              aria-label={t('translate.history.clear')}>
              <Trash2 size={14} />
            </IconButton>
          )}
        </div>
      )}
    </div>
  )

  return (
    <>
      <PageSidePanel
        open={isOpen}
        onClose={handleClose}
        header={header}
        headerClassName="pb-0"
        closeLabel={t('translate.close')}
        bodyClassName="flex min-h-0 flex-col">
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {selectedItem ? (
            <HistoryDetail
              item={selectedItem}
              onBack={() => setSelectedId(null)}
              onCopy={copyText}
              onReuse={handleReuse}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <>
              {deferredHistory.length > 0 ? (
                <div className="min-h-0 flex-1">
                  <DynamicVirtualList
                    list={deferredHistory}
                    estimateSize={estimateItemSize}
                    onScroll={handleListScroll}>
                    {renderHistoryRow}
                  </DynamicVirtualList>
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 items-center justify-center">
                  <EmptyState
                    icon={showStared ? Star : Clock}
                    title={status === 'loading' ? t('common.loading') : t('translate.history.empty')}
                    compact
                  />
                </div>
              )}
            </>
          )}
        </div>
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

const useLanguageLabels = (enabled: boolean) => {
  const { getLanguage: getDataApiLanguage, getLabel: getDataApiLabel } = useLanguages({ enabled })

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
    try {
      await onUpdate(item.id, { star: !item.star })
    } catch {
      // `useTranslateHistory` already reports mutation errors.
    }
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
      className="group relative flex w-full cursor-pointer flex-col gap-1.5 rounded-md p-2.5 text-left transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
      <IconButton
        size="sm"
        tone="star"
        active={!!item.star}
        onClick={(e) => {
          e.stopPropagation()
          void handleStar()
        }}
        aria-label={t('translate.history.star')}
        aria-pressed={!!item.star}
        className={cn(
          'absolute top-2 right-2',
          !item.star && 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
        )}>
        <Star size={10} className={cn(item.star && 'fill-amber-500')} />
      </IconButton>
      <div className="flex items-center gap-1.5 pr-5">
        {item.kind === 'file' && (
          <FileText
            size={12}
            className="shrink-0 text-foreground-tertiary"
            aria-label={t('translate.history.file.badge')}
          />
        )}
        <span className="rounded bg-muted px-1 py-px text-muted-foreground text-sm">
          {item._sourceEmoji} {item._sourceLabel}
        </span>
        <ArrowRight size={8} className="text-foreground-tertiary" />
        <span className="rounded bg-primary/10 px-1 py-px text-primary text-sm">
          {item._targetEmoji} {item._targetLabel}
        </span>
        <span className="ml-auto text-foreground-tertiary text-sm">{item._createdAtLabel}</span>
      </div>
      <p className="line-clamp-1 text-muted-foreground text-sm">{item.sourceText}</p>
      <p className="line-clamp-1 text-foreground text-sm">{item.targetText}</p>
    </div>
  )
}

const HistoryDetail: FC<{
  item: DisplayedTranslateHistoryItem
  onBack: () => void
  onCopy: (value: string) => Promise<void>
  onReuse: (item: DisplayedTranslateHistoryItem, files?: TranslationFiles) => void
  onDeleted: () => void
}> = ({ item, onBack, onCopy, onReuse, onDeleted }) => {
  const { t } = useTranslation()
  const { update: updateHistory, remove: deleteHistory } = useTranslateHistory()
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)

  const handleStar = async () => {
    try {
      await updateHistory(item.id, { star: !item.star })
    } catch {
      // `useTranslateHistory` already reports mutation errors.
    }
  }

  const handleDelete = async () => {
    try {
      await deleteHistory(item.id)
      onDeleted()
    } catch {
      // `useTranslateHistory` already handles toast/log feedback; swallow to keep ConfirmDialog close flow.
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 flex items-center gap-1 rounded-md text-muted-foreground text-sm transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:underline focus-visible:outline-none">
        <ChevronRight size={11} className="rotate-180" />
        <span>{t('translate.history.back')}</span>
      </button>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-sm bg-muted px-1.5 py-0.5 text-muted-foreground text-sm">
            {item._sourceEmoji} {item._sourceLabel}
          </span>
          <ArrowRight size={10} className="text-foreground-tertiary" />
          <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-primary text-sm">
            {item._targetEmoji} {item._targetLabel}
          </span>
          <span className="flex-1" />
          <IconButton
            size="sm"
            tone="destructive"
            onClick={() => setConfirmDeleteOpen(true)}
            aria-label={t('translate.history.delete')}>
            <Trash2 size={11} />
          </IconButton>
          <IconButton
            size="sm"
            tone="star"
            active={!!item.star}
            onClick={() => void handleStar()}
            aria-label={t('translate.history.star')}
            aria-pressed={!!item.star}>
            <Star size={11} className={cn(item.star && 'fill-amber-500')} />
          </IconButton>
          <span className="text-foreground-tertiary text-sm">{item._createdAtLabel}</span>
        </div>
        {item.kind === 'file' ? (
          <FileHistoryBody item={item} onReuse={(files) => onReuse(item, files)} />
        ) : (
          <>
            <div className="rounded-md bg-muted/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-foreground-tertiary text-sm">{t('translate.history.source')}</span>
                <IconButton size="sm" onClick={() => void onCopy(item.sourceText)} aria-label={t('common.copy')}>
                  <Copy size={10} />
                </IconButton>
              </div>
              <p className="wrap-break-word max-h-50 overflow-y-auto whitespace-pre-wrap text-foreground text-sm leading-relaxed">
                {item.sourceText}
              </p>
            </div>
            <div className="rounded-md border border-border bg-accent/40 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-muted-foreground text-sm">{t('translate.history.target')}</span>
                <IconButton size="sm" onClick={() => void onCopy(item.targetText)} aria-label={t('common.copy')}>
                  <Copy size={10} />
                </IconButton>
              </div>
              <p className="wrap-break-word max-h-50 overflow-y-auto whitespace-pre-wrap text-foreground text-sm leading-relaxed">
                {item.targetText}
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onReuse(item)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
                <Repeat size={11} />
                <span>{t('translate.history.reuse')}</span>
              </button>
              <button
                type="button"
                onClick={() => void onCopy(item.targetText)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary py-1.5 text-primary-foreground text-sm transition-colors hover:opacity-90 focus-visible:opacity-90 focus-visible:outline-none">
                <Copy size={11} />
                <span>{t('translate.history.copy_target')}</span>
              </button>
            </div>
          </>
        )}
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

/**
 * Detail body for a `kind='file'` row: the two files plus the actions that only make
 * sense on files. The entry ids are not on `TranslateHistory` (see `loadTranslationFiles`),
 * so they are fetched when the row is opened — until they land, the file actions are
 * hidden rather than shown-and-broken.
 *
 * Everything here is format-agnostic except the side-by-side preview, which needs a
 * viewer and so gates on `isPdfTranslation`.
 */
const FileHistoryBody: FC<{ item: DisplayedTranslateHistoryItem; onReuse: (files: TranslationFiles) => void }> = ({
  item,
  onReuse
}) => {
  const { t } = useTranslation()
  const [files, setFiles] = useState<TranslationFiles | null>(null)

  useEffect(() => {
    let active = true
    loadTranslationFiles(item.id)
      .then((loaded) => {
        if (!active) return
        setFiles(loaded)
        if (!loaded.target?.path) toast.error(t('translate.history.file.unavailable'))
      })
      .catch((error) => {
        logger.error('Failed to load the files of a translate history entry', error as Error)
        if (!active) return
        toast.error(t('translate.history.file.unavailable'))
      })
    return () => {
      active = false
    }
  }, [item.id, t])

  const source = files?.source ?? null
  const target = files?.target ?? null
  const targetPath = target?.path ?? null
  const canPreview = isPdfTranslation(item) && Boolean(source?.path && targetPath)

  const runFileAction = useCallback(
    async (action: () => Promise<void>, failureMessage: string) => {
      try {
        await action()
      } catch (error) {
        logger.error(failureMessage, error as Error)
        toast.error(t('translate.history.file.action_failed'))
      }
    },
    [t]
  )

  const reveal = (entryId: FileEntryId) =>
    void runFileAction(
      () => ipcApi.request('file.show_in_folder', createFileEntryHandle(entryId)),
      'Failed to reveal a translated file'
    )

  return (
    <>
      <TranslationFileCard label={t('translate.history.file.source')} fileName={item.sourceText}>
        {source && (
          <IconButton size="sm" onClick={() => reveal(source.entryId)} aria-label={t('translate.history.file.reveal')}>
            <FolderOpen size={10} />
          </IconButton>
        )}
      </TranslationFileCard>
      <TranslationFileCard label={t('translate.history.file.target')} fileName={item.targetText} highlighted>
        {targetPath && (
          <IconButton
            size="sm"
            onClick={() =>
              void runFileAction(
                () => saveTranslationFileAs(targetPath, item.targetText),
                'Failed to export a translated file'
              )
            }
            aria-label={t('translate.history.file.export')}>
            <Download size={10} />
          </IconButton>
        )}
        {target && (
          <IconButton size="sm" onClick={() => reveal(target.entryId)} aria-label={t('translate.history.file.reveal')}>
            <FolderOpen size={10} />
          </IconButton>
        )}
      </TranslationFileCard>
      <div className="flex items-center gap-2 pt-1">
        {canPreview && (
          <button
            type="button"
            onClick={() => files && onReuse(files)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-accent py-1.5 text-muted-foreground text-sm transition-colors hover:bg-accent hover:text-foreground focus-visible:text-foreground focus-visible:outline-none">
            <Repeat size={11} />
            <span>{t('translate.history.file.preview')}</span>
          </button>
        )}
        <button
          type="button"
          disabled={!target}
          onClick={() =>
            target &&
            void runFileAction(
              () => ipcApi.request('file.open', createFileEntryHandle(target.entryId)),
              'Failed to open a translated file'
            )
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-primary py-1.5 text-primary-foreground text-sm transition-colors hover:opacity-90 focus-visible:opacity-90 focus-visible:outline-none disabled:opacity-50">
          <FileText size={11} />
          <span>{t('translate.history.file.open')}</span>
        </button>
      </div>
    </>
  )
}

const TranslationFileCard: FC<{
  label: string
  fileName: string
  highlighted?: boolean
  children?: React.ReactNode
}> = ({ label, fileName, highlighted, children }) => (
  <div className={cn('rounded-md p-3', highlighted ? 'border border-border bg-accent/40' : 'bg-muted/40')}>
    <div className="mb-2 flex items-center justify-between gap-2">
      <span className="text-foreground-tertiary text-sm">{label}</span>
      <div className="flex shrink-0 items-center gap-1">{children}</div>
    </div>
    <p className="wrap-break-word flex items-center gap-1.5 text-foreground text-sm leading-relaxed">
      <FileText size={12} className="shrink-0 text-foreground-tertiary" />
      <span className="min-w-0 break-all">{fileName}</span>
    </p>
  </div>
)

export default TranslateHistoryList
