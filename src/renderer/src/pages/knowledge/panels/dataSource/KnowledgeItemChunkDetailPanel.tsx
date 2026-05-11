import { Button, ConfirmDialog, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { formatFileSize } from '@renderer/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { KnowledgeItem, KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { ArrowLeft, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { normalizeKnowledgeError } from '../../utils'
import { toKnowledgeItemRowViewModel } from './utils/selectors'

const logger = loggerService.withContext('KnowledgeItemChunkDetailPanel')

interface KnowledgeItemChunkDetailPanelProps {
  baseId: string
  itemId: string
  item?: KnowledgeItem
  onBack: () => void
}

const getKnowledgeItemSizeMeta = (item: KnowledgeItem) => {
  if (item.type === 'file') {
    return formatFileSize(item.data.file.size)
  }

  return undefined
}

const KnowledgeItemChunkActionButton = ({
  label,
  className,
  children,
  disabled,
  onClick
}: {
  label: string
  className?: string
  children: ReactNode
  disabled?: boolean
  onClick?: () => void
}) => {
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onClick?.()
  }

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={label}
      className={cn(
        'size-4 min-h-4 rounded p-0 text-muted-foreground/25 shadow-none transition-colors hover:bg-accent hover:text-foreground',
        className
      )}
      disabled={disabled}
      onClick={handleClick}>
      {children}
    </Button>
  )
}

const KnowledgeItemChunkCard = ({
  chunk,
  isDeleting,
  onDelete
}: {
  chunk: KnowledgeItemChunk
  isDeleting: boolean
  onDelete: (chunk: KnowledgeItemChunk) => void
}) => {
  const { t } = useTranslation()

  return (
    <div className="group/ck rounded-lg border border-border/20 transition-all hover:border-border/40">
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/50 text-muted-foreground/40 text-xs leading-3">
          {chunk.metadata.chunkIndex}
        </span>
        <span className="flex-1 text-muted-foreground/30 text-xs leading-4">
          {chunk.metadata.tokenCount} {t('knowledge.rag.tokens_unit')}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-all group-hover/ck:opacity-100">
          <KnowledgeItemChunkActionButton
            label={t('common.delete')}
            className="hover:bg-red-500/10 hover:text-red-500"
            disabled={isDeleting}
            onClick={() => onDelete(chunk)}>
            <Trash2 className="size-2" />
          </KnowledgeItemChunkActionButton>
        </div>
      </div>
      <div className="px-2.5 pb-2">
        <p className="line-clamp-2 text-foreground/70 text-sm leading-relaxed">{chunk.content}</p>
      </div>
    </div>
  )
}

const KnowledgeItemChunkState = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full items-center justify-center px-4 py-10 text-center text-muted-foreground/35 text-sm leading-5">
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
  const [chunks, setChunks] = useState<KnowledgeItemChunk[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [deletingChunkId, setDeletingChunkId] = useState<string | null>(null)
  const [pendingDeleteChunk, setPendingDeleteChunk] = useState<KnowledgeItemChunk | null>(null)
  const keepDeleteDialogOpenRef = useRef(false)
  const item = fetchedItem ?? initialItem
  const viewModel = item ? toKnowledgeItemRowViewModel(item, language) : null
  const Icon = viewModel?.icon.icon
  const sizeMeta = item ? getKnowledgeItemSizeMeta(item) : undefined
  const typeMeta = item && viewModel ? viewModel.suffix || t(`knowledge.data_source.filters.${item.type}`) : ''
  const chunksCountMeta = t('knowledge.data_source.chunks_count', { count: chunks.length })
  const metaParts = [typeMeta, sizeMeta, chunksCountMeta].filter((part): part is string => Boolean(part))

  useEffect(() => {
    let isActive = true

    const loadChunks = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const itemChunks = await window.api.knowledgeRuntime.listItemChunks(baseId, itemId)
        if (isActive) {
          setChunks(itemChunks)
        }
      } catch (chunkError) {
        const normalizedError = normalizeKnowledgeError(chunkError)

        if (isActive) {
          logger.error('Failed to list knowledge item chunks', normalizedError, {
            baseId,
            itemId
          })
          setChunks([])
          setError(normalizedError)
        }
      } finally {
        if (isActive) {
          setIsLoading(false)
        }
      }
    }

    void loadChunks()

    return () => {
      isActive = false
    }
  }, [baseId, itemId])

  const handleRequestDeleteChunk = (chunk: KnowledgeItemChunk) => {
    keepDeleteDialogOpenRef.current = false
    setPendingDeleteChunk(chunk)
  }

  const handleConfirmDeleteChunk = async () => {
    const chunk = pendingDeleteChunk
    if (!chunk) {
      return
    }

    setDeletingChunkId(chunk.id)
    setError(null)
    keepDeleteDialogOpenRef.current = false

    try {
      await window.api.knowledgeRuntime.deleteItemChunk(baseId, chunk.itemId, chunk.id)
      setChunks((currentChunks) => currentChunks.filter((currentChunk) => currentChunk.id !== chunk.id))
      setPendingDeleteChunk(null)
    } catch (chunkError) {
      const normalizedError = normalizeKnowledgeError(chunkError)

      logger.error('Failed to delete knowledge item chunk', normalizedError, {
        baseId,
        itemId: chunk.itemId,
        chunkId: chunk.id
      })
      setError(normalizedError)
      window.toast.error(formatErrorMessageWithPrefix(normalizedError, t('knowledge.data_source.delete_failed')))
      keepDeleteDialogOpenRef.current = true
    } finally {
      setDeletingChunkId(null)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border/15 border-b px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.back')}
          className="size-5 min-h-5 min-w-5 rounded p-0 text-muted-foreground/50 shadow-none transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}>
          <ArrowLeft className="size-2.75" />
        </Button>
        {Icon && viewModel ? (
          <div
            className={cn(
              'flex size-5 shrink-0 items-center justify-center rounded bg-accent/50',
              viewModel.icon.iconClassName
            )}>
            <Icon className="size-2.5" strokeWidth={1.6} />
          </div>
        ) : null}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-foreground text-sm leading-5">
            {viewModel?.title ?? t('common.loading')}
          </span>
          <div className="flex items-center gap-2 text-muted-foreground/35 text-xs leading-4">
            {metaParts.map((part) => (
              <span key={part} className={viewModel && part === typeMeta && viewModel.suffix ? 'uppercase' : undefined}>
                {part}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Scrollbar className="min-h-0 flex-1 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isItemLoading || isLoading ? <KnowledgeItemChunkState>{t('common.loading')}</KnowledgeItemChunkState> : null}
        {!isItemLoading && itemError ? <KnowledgeItemChunkState>{itemError.message}</KnowledgeItemChunkState> : null}
        {!isItemLoading && !isLoading && !itemError && error ? (
          <KnowledgeItemChunkState>{error.message}</KnowledgeItemChunkState>
        ) : null}
        {!isItemLoading && !isLoading && !itemError && !error && chunks.length === 0 ? (
          <KnowledgeItemChunkState>{t('knowledge.data_source.empty_description')}</KnowledgeItemChunkState>
        ) : null}
        {!isItemLoading && !isLoading && !itemError && chunks.length > 0 ? (
          <div className="space-y-1.5">
            {chunks.map((chunk) => (
              <KnowledgeItemChunkCard
                key={chunk.id}
                chunk={chunk}
                isDeleting={deletingChunkId === chunk.id}
                onDelete={handleRequestDeleteChunk}
              />
            ))}
          </div>
        ) : null}
      </Scrollbar>
      <ConfirmDialog
        open={Boolean(pendingDeleteChunk)}
        onOpenChange={(open) => {
          if (!open) {
            if (keepDeleteDialogOpenRef.current) {
              keepDeleteDialogOpenRef.current = false
              return
            }
            setPendingDeleteChunk(null)
          }
        }}
        title={t('knowledge.data_source.chunk_delete_confirm_title')}
        description={t('knowledge.data_source.chunk_delete_confirm_description')}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={Boolean(deletingChunkId)}
        onConfirm={handleConfirmDeleteChunk}
      />
    </div>
  )
}

export default KnowledgeItemChunkDetailPanel
