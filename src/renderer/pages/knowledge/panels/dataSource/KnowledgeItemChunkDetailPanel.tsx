import { Button, EmptyState, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import { normalizeKnowledgeError } from '@renderer/pages/knowledge/utils'
import type { KnowledgeItem, KnowledgeItemChunk } from '@shared/data/types/knowledge'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { toKnowledgeItemRowViewModel } from './utils/selectors'

const logger = loggerService.withContext('KnowledgeItemChunkDetailPanel')

interface KnowledgeItemChunkDetailPanelProps {
  baseId: string
  itemId: string
  item?: KnowledgeItem
  onBack: () => void
}

const KnowledgeItemChunkCard = ({ chunk }: { chunk: KnowledgeItemChunk }) => {
  const { t } = useTranslation()

  return (
    <div className="rounded-lg border border-border-subtle transition-all hover:border-border-hover">
      <div className="flex items-center gap-2 px-3 py-2">
        <span className="flex size-5 shrink-0 items-center justify-center rounded bg-accent text-foreground-muted text-xs leading-4">
          {chunk.metadata.chunkIndex + 1}
        </span>
        <span className="flex-1 text-foreground-muted text-xs leading-4">
          {chunk.metadata.tokenCount} {t('knowledge.rag.tokens_unit')}
        </span>
      </div>
      <div className="px-3 pb-3">
        <p className="line-clamp-2 text-foreground-secondary text-sm leading-relaxed">{chunk.content}</p>
      </div>
    </div>
  )
}

const KnowledgeItemChunkState = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-full items-center justify-center px-4 py-10 text-center text-foreground-muted text-sm leading-5">
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
  const item = fetchedItem ?? initialItem
  const viewModel = item ? toKnowledgeItemRowViewModel(item, language) : null
  const Icon = viewModel?.icon.icon
  const chunksCountMeta = t('knowledge.data_source.chunks_count', { count: chunks.length })

  useEffect(() => {
    let isActive = true

    const loadChunks = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const itemChunks = await ipcApi.request('knowledge.list_item_chunks', { baseId, itemId })
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-border-muted border-b px-3 py-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.back')}
          className="size-5 min-h-5 min-w-5 rounded p-0 text-foreground-muted shadow-none transition-colors hover:bg-accent hover:text-foreground"
          onClick={onBack}>
          <ArrowLeft className="size-3.5" />
        </Button>
        {Icon && viewModel ? (
          <span className="flex size-6 shrink-0 items-center justify-center rounded bg-background-subtle">
            <Icon className={cn('size-3.5', viewModel.icon.iconClassName)} />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <span className="block truncate text-foreground text-sm leading-5">
            {viewModel?.title ?? t('common.loading')}
          </span>
          <div className="flex items-center gap-2 text-foreground-muted text-xs leading-4">
            <span>{chunksCountMeta}</span>
          </div>
        </div>
      </div>

      <Scrollbar className="min-h-0 flex-1 px-4 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {isItemLoading || isLoading ? <KnowledgeItemChunkState>{t('common.loading')}</KnowledgeItemChunkState> : null}
        {!isItemLoading && itemError ? <KnowledgeItemChunkState>{itemError.message}</KnowledgeItemChunkState> : null}
        {!isItemLoading && !isLoading && !itemError && error ? (
          <KnowledgeItemChunkState>{error.message}</KnowledgeItemChunkState>
        ) : null}
        {!isItemLoading && !isLoading && !itemError && !error && chunks.length === 0 ? (
          <EmptyState
            preset="no-file"
            title={t('knowledge.data_source.empty_description')}
            compact
            className="h-full"
          />
        ) : null}
        {!isItemLoading && !isLoading && !itemError && chunks.length > 0 ? (
          <div className="space-y-2">
            {chunks.map((chunk) => (
              <KnowledgeItemChunkCard key={chunk.id} chunk={chunk} />
            ))}
          </div>
        ) : null}
      </Scrollbar>
    </div>
  )
}

export default KnowledgeItemChunkDetailPanel
