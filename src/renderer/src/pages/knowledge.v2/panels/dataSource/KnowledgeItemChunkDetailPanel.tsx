import { Button, ConfirmDialog, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { formatFileSize } from '@renderer/utils'
import type { KnowledgeItem, KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { ArrowLeft, ChevronDown, Pencil, Trash2 } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toKnowledgeItemRowViewModel } from './utils/selectors'

interface KnowledgeItemChunkDetailPanelProps {
  item: KnowledgeItem
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
        <span className="flex size-4 shrink-0 items-center justify-center rounded bg-accent/50 text-[0.5rem] text-muted-foreground/40 leading-3">
          {chunk.metadata.chunkIndex}
        </span>
        <span className="flex-1 text-[0.5625rem] text-muted-foreground/30 leading-3.375">
          {chunk.metadata.tokenCount} {t('knowledge_v2.rag.tokens_unit')}
        </span>
        <div className="flex items-center gap-0.5 opacity-0 transition-all group-hover/ck:opacity-100">
          <KnowledgeItemChunkActionButton label={t('common.edit')}>
            <Pencil className="size-2" />
          </KnowledgeItemChunkActionButton>
          <KnowledgeItemChunkActionButton
            label={t('common.delete')}
            className="hover:bg-red-500/10 hover:text-red-500"
            disabled={isDeleting}
            onClick={() => onDelete(chunk)}>
            <Trash2 className="size-2" />
          </KnowledgeItemChunkActionButton>
          <KnowledgeItemChunkActionButton label={t('common.expand')}>
            <ChevronDown className="size-2.25" />
          </KnowledgeItemChunkActionButton>
        </div>
      </div>
      <div className="px-2.5 pb-2">
        <p className="line-clamp-2 text-[0.6875rem] text-foreground/70 leading-relaxed">{chunk.content}</p>
      </div>
    </div>
  )
}

const KnowledgeItemChunkState = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full items-center justify-center px-4 py-10 text-center text-[0.6875rem] text-muted-foreground/35 leading-4.125">
    {children}
  </div>
)

const KnowledgeItemChunkDetailPanel = ({ item, onBack }: KnowledgeItemChunkDetailPanelProps) => {
  const {
    t,
    i18n: { language }
  } = useTranslation()
  const [chunks, setChunks] = useState<KnowledgeItemChunk[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)
  const [deletingChunkId, setDeletingChunkId] = useState<string | null>(null)
  const [pendingDeleteChunk, setPendingDeleteChunk] = useState<KnowledgeItemChunk | null>(null)
  const { icon, suffix, title } = toKnowledgeItemRowViewModel(item, language)
  const Icon = icon.icon
  const sizeMeta = getKnowledgeItemSizeMeta(item)
  const typeMeta = suffix || t(`knowledge_v2.data_source.filters.${item.type}`)
  const chunksCountMeta = t('knowledge_v2.data_source.chunks_count', { count: chunks.length })
  const metaParts = [typeMeta, sizeMeta, chunksCountMeta].filter((part): part is string => Boolean(part))

  useEffect(() => {
    let isActive = true

    const loadChunks = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const itemChunks = await window.api.knowledgeRuntime.listItemChunks(item.baseId, item.id)
        if (isActive) {
          setChunks(itemChunks)
        }
      } catch (chunkError) {
        if (isActive) {
          setChunks([])
          setError(chunkError instanceof Error ? chunkError : new Error(String(chunkError)))
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
  }, [item.baseId, item.id])

  const handleRequestDeleteChunk = (chunk: KnowledgeItemChunk) => {
    setPendingDeleteChunk(chunk)
  }

  const handleConfirmDeleteChunk = async () => {
    const chunk = pendingDeleteChunk
    if (!chunk) {
      return
    }

    setDeletingChunkId(chunk.id)
    setError(null)

    try {
      await window.api.knowledgeRuntime.deleteItemChunk(item.baseId, item.id, chunk.id)
      setChunks((currentChunks) => currentChunks.filter((currentChunk) => currentChunk.id !== chunk.id))
      setPendingDeleteChunk(null)
    } catch (chunkError) {
      setError(chunkError instanceof Error ? chunkError : new Error(String(chunkError)))
    } finally {
      setDeletingChunkId(null)
      setPendingDeleteChunk(null)
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
        <div
          className={cn('flex size-5 shrink-0 items-center justify-center rounded bg-accent/50', icon.iconClassName)}>
          <Icon className="size-2.5" strokeWidth={1.6} />
        </div>
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[0.6875rem] text-foreground leading-4.125">{title}</span>
          <div className="flex items-center gap-2 text-[0.5625rem] text-muted-foreground/35 leading-3.375">
            {metaParts.map((part) => (
              <span key={part} className={part === typeMeta && suffix ? 'uppercase' : undefined}>
                {part}
              </span>
            ))}
          </div>
        </div>
      </div>

      <Scrollbar className="min-h-0 flex-1 px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isLoading ? <KnowledgeItemChunkState>{t('common.loading')}</KnowledgeItemChunkState> : null}
        {!isLoading && error ? <KnowledgeItemChunkState>{error.message}</KnowledgeItemChunkState> : null}
        {!isLoading && !error && chunks.length === 0 ? (
          <KnowledgeItemChunkState>{t('knowledge_v2.data_source.empty_description')}</KnowledgeItemChunkState>
        ) : null}
        {!isLoading && chunks.length > 0 ? (
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
            setPendingDeleteChunk(null)
          }
        }}
        title={t('knowledge_v2.data_source.chunk_delete_confirm_title')}
        description={t('knowledge_v2.data_source.chunk_delete_confirm_description')}
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
