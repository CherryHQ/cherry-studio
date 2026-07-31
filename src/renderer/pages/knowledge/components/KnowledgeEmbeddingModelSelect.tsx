import { Tooltip } from '@cherrystudio/ui'
import { type ModelSelectorModelAction, ModelSelectorRowActionButton } from '@renderer/components/ModelSelector'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { toast } from '@renderer/services/toast'
import { LOCAL_EMBEDDING_PROVIDER_ID, LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { Model } from '@shared/data/types/model'
import { Download, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { isEmbeddingModel, KnowledgeModelSelect, type KnowledgeModelSelectProps } from './KnowledgeModelSelect'

type KnowledgeEmbeddingModelSelectProps = Omit<
  KnowledgeModelSelectProps,
  'filter' | 'modelActions' | 'open' | 'onOpenChange' | 'prioritizedProviderIds'
>

const LOCAL_EMBEDDING_PRIORITIZED_PROVIDER_IDS = [LOCAL_EMBEDDING_PROVIDER_ID] as const
const NOOP = () => {}

export const KnowledgeEmbeddingModelSelect = (props: KnowledgeEmbeddingModelSelectProps) => {
  const { t } = useTranslation()
  const { onChange } = props
  const [open, setOpen] = useState(false)
  const { status, percent, download, cancel } = useLocalModel('embedding')
  const isDownloading = status === 'downloading'

  const handleDownload = useCallback(async () => {
    try {
      const completed = await download()
      if (!completed) {
        return
      }
      onChange(LOCAL_EMBEDDING_UNIQUE_MODEL_ID)
      setOpen(false)
    } catch {
      toast.error(t('knowledge.rag.download_local_embedding_failed'))
    }
  }, [download, onChange, t])

  const handleCancel = useCallback(() => {
    void cancel().catch(() => toast.error(t('common.error')))
  }, [cancel, t])

  const modelActions = useMemo<readonly ModelSelectorModelAction[]>(() => {
    if (status === 'ready' || status === 'unsupported') return []

    const actionLabel = isDownloading ? t('common.cancel') : t('knowledge.rag.download_local_embedding')
    return [
      {
        modelId: LOCAL_EMBEDDING_UNIQUE_MODEL_ID,
        onActivate: isDownloading ? NOOP : () => void handleDownload(),
        content: (
          <>
            {isDownloading ? (
              <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{percent}%</span>
            ) : null}
            <Tooltip content={actionLabel}>
              <ModelSelectorRowActionButton
                aria-label={actionLabel}
                className="opacity-100 group-hover:opacity-100"
                onClick={isDownloading ? handleCancel : () => void handleDownload()}>
                {isDownloading ? <X className="size-3" /> : <Download className="size-3" />}
              </ModelSelectorRowActionButton>
            </Tooltip>
          </>
        )
      }
    ]
  }, [handleCancel, handleDownload, isDownloading, percent, status, t])

  const filter = useCallback(
    (model: Model) =>
      isEmbeddingModel(model) && (status !== 'unsupported' || model.id !== LOCAL_EMBEDDING_UNIQUE_MODEL_ID),
    [status]
  )

  return (
    <KnowledgeModelSelect
      {...props}
      open={open}
      onOpenChange={setOpen}
      filter={filter}
      modelActions={modelActions}
      prioritizedProviderIds={LOCAL_EMBEDDING_PRIORITIZED_PROVIDER_IDS}
    />
  )
}
