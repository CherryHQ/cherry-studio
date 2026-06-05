import { Button } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import type { Model } from '@shared/data/types/model'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeSelectOption } from '../../types'
import { RagFieldLabel, RagNumericField, RagSelectField } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  embeddingModel?: Model
  embeddingModelOptions: KnowledgeSelectOption[]
  dimensions: string
  dimensionsErrorCode?: 'dimensionsInvalid'
  isFetchingDimensions?: boolean
  onEmbeddingModelChange: (embeddingModelId: string) => void
  onDimensionsChange: (dimensions: string) => void
  onRefreshDimensions: () => void
}

const EmbeddingSection = ({
  embeddingModelId,
  embeddingModel,
  embeddingModelOptions,
  dimensions,
  dimensionsErrorCode,
  isFetchingDimensions = false,
  onEmbeddingModelChange,
  onDimensionsChange,
  onRefreshDimensions
}: EmbeddingSectionProps) => {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-4">
      <div>
        <RagFieldLabel label={t('knowledge.rag.embedding_model')} hint={t('knowledge.rag.hints.embedding_model')} />
        <RagSelectField
          value={embeddingModelId ?? undefined}
          options={embeddingModelOptions}
          placeholder={t('knowledge.not_set')}
          onValueChange={onEmbeddingModelChange}
        />
      </div>

      <div>
        <RagFieldLabel label={t('knowledge.rag.dimensions')} hint={t('knowledge.rag.hints.dimensions')} />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <RagNumericField value={dimensions} onChange={onDimensionsChange} />
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!embeddingModel || isFetchingDimensions}
            aria-label={t('knowledge.rag.refresh_dimensions')}
            onClick={onRefreshDimensions}
            className="shrink-0">
            <RefreshCw className={cn('size-3.5', isFetchingDimensions ? 'animation-rotate' : undefined)} />
          </Button>
        </div>
        {dimensionsErrorCode === 'dimensionsInvalid' ? (
          <div className="mt-1 text-destructive text-xs leading-4">{t('knowledge.dimensions_error_invalid')}</div>
        ) : null}
      </div>
    </div>
  )
}

export default EmbeddingSection
