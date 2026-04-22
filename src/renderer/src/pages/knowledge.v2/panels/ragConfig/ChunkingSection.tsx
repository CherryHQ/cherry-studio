import { Layers3 } from 'lucide-react'

import { RagHintText, RagNumericField, RagSectionTitle } from './panelPrimitives'

interface ChunkingSectionProps {
  title: string
  chunkSizeLabel: string
  chunkOverlapLabel: string
  tokensUnitLabel: string
  warningText: string
  chunkSize: string
  chunkOverlap: string
  chunkSizeError?: string
  chunkOverlapError?: string
  onChunkSizeChange: (value: string) => void
  onChunkOverlapChange: (value: string) => void
}

const ChunkingSection = ({
  title,
  chunkSizeLabel,
  chunkOverlapLabel,
  tokensUnitLabel,
  warningText,
  chunkSize,
  chunkOverlap,
  chunkSizeError,
  chunkOverlapError,
  onChunkSizeChange,
  onChunkOverlapChange
}: ChunkingSectionProps) => {
  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={title} icon={Layers3} />

      <div className="grid grid-cols-2 gap-2">
        <RagNumericField
          label={chunkSizeLabel}
          value={chunkSize}
          suffix={tokensUnitLabel}
          onChange={onChunkSizeChange}
        />
        <RagNumericField
          label={chunkOverlapLabel}
          value={chunkOverlap}
          suffix={tokensUnitLabel}
          onChange={onChunkOverlapChange}
        />
      </div>

      {chunkSizeError ? <RagHintText tone="error">{chunkSizeError}</RagHintText> : null}
      {chunkOverlapError ? <RagHintText tone="error">{chunkOverlapError}</RagHintText> : null}
      <RagHintText tone="warning">{warningText}</RagHintText>
    </section>
  )
}

export default ChunkingSection
