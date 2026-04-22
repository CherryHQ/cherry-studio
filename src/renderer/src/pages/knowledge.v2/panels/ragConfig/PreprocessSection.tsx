import type { KnowledgeV2SelectOption } from '@renderer/pages/knowledge.v2/types'
import { Bot } from 'lucide-react'

import { RagFieldLabel, RagHintText, RagSectionTitle, RagSelectField } from './panelPrimitives'

const EMPTY_OPTION_VALUE = '__none__'

interface PreprocessSectionProps {
  title: string
  fileProcessorId: string | null
  fileProcessorOptions: KnowledgeV2SelectOption[]
  notSetLabel: string
  processorLabel: string
  preprocessingHint: string
  onFileProcessorChange: (value: string | null) => void
}

const PreprocessSection = ({
  title,
  fileProcessorId,
  fileProcessorOptions,
  notSetLabel,
  processorLabel,
  preprocessingHint,
  onFileProcessorChange
}: PreprocessSectionProps) => {
  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={title} icon={Bot} />

      <div>
        <RagFieldLabel label={processorLabel} />
        <RagSelectField
          value={fileProcessorId ?? EMPTY_OPTION_VALUE}
          options={[{ value: EMPTY_OPTION_VALUE, label: notSetLabel }, ...fileProcessorOptions]}
          onValueChange={(value) => onFileProcessorChange(value === EMPTY_OPTION_VALUE ? null : value)}
        />
      </div>

      <RagHintText>{preprocessingHint}</RagHintText>
    </section>
  )
}

export default PreprocessSection
