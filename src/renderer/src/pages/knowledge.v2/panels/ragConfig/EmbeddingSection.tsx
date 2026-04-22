import type { KnowledgeV2SelectOption } from '@renderer/pages/knowledge.v2/types'
import { DatabaseZap } from 'lucide-react'

import { RagFieldLabel, RagReadonlyField, RagSectionTitle, RagSelectField } from './panelPrimitives'

interface EmbeddingSectionProps {
  title: string
  embeddingLabel: string
  dimensionsLabel: string
  placeholderLabel: string
  embeddingModelId: string | null
  embeddingModelOptions: KnowledgeV2SelectOption[]
  dimensions: number
  onEmbeddingModelChange: (value: string) => void
}

const EmbeddingSection = ({
  title,
  embeddingLabel,
  dimensionsLabel,
  placeholderLabel,
  embeddingModelId,
  embeddingModelOptions,
  dimensions,
  onEmbeddingModelChange
}: EmbeddingSectionProps) => {
  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={title} icon={DatabaseZap} />

      <div className="grid grid-cols-[minmax(0,1fr)_8.75rem] gap-2">
        <div>
          <RagFieldLabel label={embeddingLabel} />
          <RagSelectField
            value={embeddingModelId ?? undefined}
            options={embeddingModelOptions}
            placeholder={placeholderLabel}
            onValueChange={onEmbeddingModelChange}
          />
        </div>

        <RagReadonlyField label={dimensionsLabel} value={String(dimensions)} />
      </div>
    </section>
  )
}

export default EmbeddingSection
