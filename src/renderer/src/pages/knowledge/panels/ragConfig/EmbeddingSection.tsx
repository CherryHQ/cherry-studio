import { Button } from '@cherrystudio/ui'
import { Cpu, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { KnowledgeSelectOption } from '../../types'
import { RagFieldLabel, RagNumericField, RagSectionTitle, RagSelectField } from './panelPrimitives'

interface EmbeddingSectionProps {
  embeddingModelId: string | null
  embeddingModelOptions: KnowledgeSelectOption[]
  dimensions: string
  dimensionsErrorCode?: 'dimensionsInvalid'
  onEmbeddingModelChange: (embeddingModelId: string) => void
  onDimensionsChange: (dimensions: string) => void
}

const EmbeddingSection = ({
  embeddingModelId,
  embeddingModelOptions,
  dimensions,
  dimensionsErrorCode,
  onEmbeddingModelChange,
  onDimensionsChange
}: EmbeddingSectionProps) => {
  const { t } = useTranslation()

  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={t('knowledge.rag.embedding_model')} icon={Cpu} />

      <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
        <div>
          <RagFieldLabel
            label={t('knowledge.rag.embedding_model_select')}
            hint={t('knowledge.rag.hints.embedding_model')}
          />
          <RagSelectField
            value={embeddingModelId ?? undefined}
            options={embeddingModelOptions}
            placeholder={t('knowledge.not_set')}
            onValueChange={onEmbeddingModelChange}
          />
        </div>

        <div>
          <div>
            <RagFieldLabel label={t('knowledge.rag.dimensions')} hint={t('knowledge.rag.hints.dimensions')} />
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <RagNumericField value={dimensions} onChange={onDimensionsChange} />
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                disabled
                aria-label={t('knowledge.rag.refresh_dimensions')}
                className="size-7.5 min-h-0 shrink-0 rounded-md border-border/40 p-0 text-muted-foreground/40 shadow-none hover:bg-accent hover:text-foreground disabled:opacity-40">
                <RefreshCw className="size-2.5" />
              </Button>
            </div>
          </div>
          {dimensionsErrorCode === 'dimensionsInvalid' ? (
            <div className="mt-1 text-destructive text-xs leading-4">{t('knowledge.dimensions_error_invalid')}</div>
          ) : null}
        </div>
      </div>
    </section>
  )
}

export default EmbeddingSection
