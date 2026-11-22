import { ArrowLeft, CheckSquare, Square } from 'lucide-react'
import type { ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, EmptyState, Input, ScrollArea } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { DynamicVirtualList } from '@renderer/components/VirtualList'
import { ipcApi } from '@renderer/ipc'
import { normalizeKnowledgeError } from '@renderer/pages/knowledge/utils/error'
import type { KnowledgeItem, KnowledgeItemChunk } from '@shared/data/types/knowledge'
import type { KnowledgeChunkBatchAction, KnowledgeChunkBatchInput } from '@shared/data/types/knowledgeChunkGovernance'

import { toKnowledgeItemRowViewModel } from './utils/selectors'

const logger = loggerService.withContext('KnowledgeItemChunkDetailPanel')
const CHUNK_ITEM_CONTAINER_STYLE = { paddingBottom: 8 }
const GOVERNANCE_STATUS_KEYS = {
  active: 'knowledge.governance.active',
  excluded: 'knowledge.governance.excluded',
  pending: 'knowledge.governance.pending',
  'review-needed': 'knowledge.governance.review'
} as const
const estimateChunkSize = () => 140
interface KnowledgeItemChunkDetailPanelProps {
  baseId: string
  itemId: string
  item?: KnowledgeItem
  onBack: () => void
}
const KnowledgeItemChunkState = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full items-center justify-center px-4 py-10 text-center text-sm leading-5 text-foreground-tertiary">
    {children}
  </div>
)

const KnowledgeItemChunkDetailPanel = ({
  baseId,
  itemId,
  item: initialItem,
  onBack
}: KnowledgeItemChunkDetailPanelProps) => {
  const {
    t,
    i18n: { language }
  } = useTranslation()
  const {
    data: fetchedItem,
    isLoading: isItemLoading,
    error: itemError
  } = useQuery('/knowledge-items/:id', {
    params: { id: itemId },
    enabled: Boolean(itemId)
  })
  const [loadedScope, setLoadedScope] = useState<string | null>(null)
  const [chunks, setChunks] = useState<KnowledgeItemChunk[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [selected, setSelected] = useState(new Set<string>())
  const [label, setLabel] = useState('')
  const [preview, setPreview] = useState<KnowledgeChunkBatchInput | null>(null)
  const [isApplying, setIsApplying] = useState(false)
  const version = useRef<symbol | null>(null)
  const scope = `${baseId}:${itemId}`
  const currentScope = useRef({ key: scope })
  if (currentScope.current.key !== scope) currentScope.current = { key: scope }
  const confirmRef = useRef<HTMLButtonElement>(null)
  const item = fetchedItem ?? initialItem
  const viewModel = item ? toKnowledgeItemRowViewModel(item, language) : null
  const Icon = viewModel?.icon.icon
  const getChunkKey = useCallback((index: number) => chunks[index]?.id ?? index, [chunks])

  const loadChunks = useCallback(async () => {
    const request = Symbol()
    version.current = request
    setIsLoading(true)
    setError(null)
    setSelected(new Set())
    setPreview(null)
    try {
      const result = await ipcApi.request('knowledge.list_item_chunks', { baseId, itemId })
      if (request === version.current) {
        setChunks(result)
        setLoadedScope(`${baseId}:${itemId}`)
      }
    } catch (cause) {
      if (request === version.current) {
        const normalized = normalizeKnowledgeError(cause)
        logger.error('Failed to list knowledge item chunks', normalized, { baseId, itemId })
        setChunks([])
        setError(normalized)
      }
    } finally {
      if (request === version.current) setIsLoading(false)
    }
  }, [baseId, itemId])

  useEffect(() => {
    setIsApplying(false)
    setLabel('')
    void loadChunks()
    return () => {
      version.current = null
    }
  }, [loadChunks])
  useEffect(() => {
    if (preview) confirmRef.current?.focus()
  }, [preview])

  const prepare = (action: KnowledgeChunkBatchAction) => {
    if (loadedScope !== scope || isLoading || isApplying || error) return
    const selection = chunks
      .filter((chunk) => selected.has(chunk.id) && chunk.governance && chunk.governance.status !== 'review-needed')
      .map((chunk) => ({
        itemId: chunk.itemId,
        unitId: chunk.id,
        sourceContentHash: chunk.governance!.sourceContentHash,
        expectedRevision: chunk.governance!.revision
      }))
    if (selection.length) setPreview({ baseId, selection, action })
  }
  const apply = async () => {
    if (!preview || isApplying || loadedScope !== scope) return
    const origin = currentScope.current
    setIsApplying(true)
    try {
      await ipcApi.request('knowledge.apply_chunk_governance', preview)
      if (currentScope.current === origin) {
        setPreview(null)
        setSelected(new Set())
        await loadChunks()
      }
    } catch (cause) {
      if (currentScope.current === origin) {
        setError(normalizeKnowledgeError(cause))
        setPreview(null)
        setSelected(new Set())
      }
    } finally {
      if (currentScope.current === origin) setIsApplying(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="relative flex h-11 shrink-0 items-center gap-2 px-3 after:pointer-events-none after:absolute after:right-3 after:bottom-0 after:left-3 after:border-b after:border-border after:content-['']">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.back')}
          className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground shadow-none transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </Button>
        {Icon && viewModel ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background-subtle">
            <Icon className={cn('size-3.5', viewModel.icon.iconClassName)} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm leading-5 text-foreground">
            {viewModel?.title ?? t('common.loading')}
          </span>
          <div className="text-xs leading-4 text-foreground-tertiary">
            {t('knowledge.data_source.chunks_count', { count: chunks.length })}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={isLoading || isApplying}
          onClick={() => void loadChunks()}>
          {t('common.refresh')}
        </Button>
      </div>
      {chunks.some((chunk) => chunk.governance?.status === 'review-needed') ? (
        <p role="status" className="border-b border-border px-4 py-2 text-sm text-warning-subtle-foreground">
          {t('knowledge.governance.review_hint')}
        </p>
      ) : null}
      {selected.size > 0 && !error && loadedScope === scope && !isLoading ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <span className="w-full text-xs text-muted-foreground" aria-live="polite">
            {t('knowledge.governance.selected', { count: selected.size })}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isApplying}
            onClick={() => prepare({ kind: 'exclusion', excluded: true })}>
            {t('knowledge.governance.exclude')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isApplying}
            onClick={() => prepare({ kind: 'exclusion', excluded: false })}>
            {t('knowledge.governance.include')}
          </Button>
          <Input
            aria-label={t('knowledge.governance.label')}
            placeholder={t('knowledge.governance.label')}
            maxLength={80}
            value={label}
            disabled={isApplying}
            onChange={(event) => setLabel(event.target.value)}
            className="min-w-24 flex-1"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!label.trim() || isApplying}
            onClick={() => prepare({ kind: 'label', operation: 'add', label: label.trim() })}>
            {t('knowledge.governance.add_label')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!label.trim() || isApplying}
            onClick={() => prepare({ kind: 'label', operation: 'remove', label: label.trim() })}>
            {t('knowledge.governance.remove_label')}
          </Button>
        </div>
      ) : null}
      {preview ? (
        <section
          aria-label={t('knowledge.governance.review')}
          className="space-y-2 border-b border-border bg-background-subtle px-4 py-3">
          <p className="text-sm text-foreground">
            {t('knowledge.governance.preview', { count: preview.selection.length })}
          </p>
          <p className="text-sm break-words text-muted-foreground">
            {preview.action.kind === 'exclusion'
              ? t(preview.action.excluded ? 'knowledge.governance.exclude' : 'knowledge.governance.include')
              : `${t(preview.action.operation === 'add' ? 'knowledge.governance.add_label' : 'knowledge.governance.remove_label')}: ${preview.action.label}`}
          </p>
          <div className="flex gap-2">
            <Button ref={confirmRef} type="button" size="sm" disabled={isApplying} onClick={() => void apply()}>
              {isApplying ? t('common.loading') : t('common.save')}
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={isApplying} onClick={() => setPreview(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </section>
      ) : null}
      {!isItemLoading && !isLoading && loadedScope === scope && !itemError && !error && chunks.length > 0 ? (
        <DynamicVirtualList
          list={chunks}
          getItemKey={getChunkKey}
          estimateSize={estimateChunkSize}
          itemContainerStyle={CHUNK_ITEM_CONTAINER_STYLE}
          autoHideScrollbar={false}
          className="min-h-0 flex-1"
          contentProps={{ className: 'px-4 py-3' }}>
          {(chunk, index) => (
            <div className="rounded-lg border border-border-subtle transition-all hover:border-border-strong">
              <div className="flex items-center gap-2 px-3 py-2">
                {chunk.governance ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t('common.select')} ${index + 1}`}
                    aria-pressed={selected.has(chunk.id)}
                    disabled={
                      isApplying ||
                      chunk.governance.status === 'review-needed' ||
                      (!selected.has(chunk.id) && selected.size >= 500)
                    }
                    onClick={() => {
                      setPreview(null)
                      setSelected((old) => {
                        const next = new Set(old)
                        if (next.has(chunk.id)) next.delete(chunk.id)
                        else next.add(chunk.id)
                        return next
                      })
                    }}>
                    {selected.has(chunk.id) ? <CheckSquare className="size-4" /> : <Square className="size-4" />}
                  </Button>
                ) : null}
                <span className="flex size-5 shrink-0 items-center justify-center rounded bg-accent text-xs text-foreground-tertiary">
                  {chunk.metadata.chunkIndex + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={chunk.metadata.source}>
                  {chunk.metadata.source}
                </span>
                <span className="shrink-0 text-xs text-foreground-tertiary">
                  {chunk.metadata.tokenCount} {t('knowledge.rag.tokens_unit')}
                </span>
              </div>
              {chunk.governance ? (
                <div className="flex flex-wrap gap-2 px-3 pb-2 text-xs text-muted-foreground">
                  <span>{t(GOVERNANCE_STATUS_KEYS[chunk.governance.status])}</span>
                  {chunk.governance.labels.map((value) => (
                    <span key={value} className="rounded bg-accent px-1 break-all">
                      {value}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="px-3 pb-3">
                <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground">{chunk.content}</p>
              </div>
            </div>
          )}
        </DynamicVirtualList>
      ) : (
        <ScrollArea contentProps={{ className: 'px-4 py-3' }} type="auto" className="min-h-0 flex-1">
          {isItemLoading || isLoading ? <KnowledgeItemChunkState>{t('common.loading')}</KnowledgeItemChunkState> : null}
          {!isItemLoading && itemError ? <KnowledgeItemChunkState>{itemError.message}</KnowledgeItemChunkState> : null}
          {!isItemLoading && !isLoading && !itemError && error ? (
            <KnowledgeItemChunkState>
              <span role="alert">{error.message}</span>
            </KnowledgeItemChunkState>
          ) : null}
          {!isItemLoading && !isLoading && !itemError && !error && chunks.length === 0 ? (
            <EmptyState title={t('knowledge.data_source.empty_description')} compact className="h-full" />
          ) : null}
        </ScrollArea>
      )}
    </div>
  )
}
export default KnowledgeItemChunkDetailPanel
