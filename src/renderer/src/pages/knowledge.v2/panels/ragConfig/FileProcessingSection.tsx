import type { KnowledgeSelectOption } from '@renderer/pages/knowledge.v2/types'
import { Bot } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { RagFieldLabel, RagHintText, RagSectionTitle, RagSelectField } from './panelPrimitives'

const EMPTY_OPTION_VALUE = '__none__'

interface FileProcessingSectionProps {
  fileProcessorId: string | null
  fileProcessorOptions: KnowledgeSelectOption[]
  onFileProcessorChange: (value: string | null) => void
}

const FileProcessingSection = ({
  fileProcessorId,
  fileProcessorOptions,
  onFileProcessorChange
}: FileProcessingSectionProps) => {
  const { t } = useTranslation()

  return (
    <section className="space-y-2.5">
      <RagSectionTitle title={t('knowledge_v2.rag.file_processing')} icon={Bot} />

      <div>
        <RagFieldLabel label={t('knowledge_v2.rag.processor')} />
        <RagSelectField
          value={fileProcessorId ?? EMPTY_OPTION_VALUE}
          options={[{ value: EMPTY_OPTION_VALUE, label: t('knowledge.not_set') }, ...fileProcessorOptions]}
          onValueChange={(value) => onFileProcessorChange(value === EMPTY_OPTION_VALUE ? null : value)}
        />
      </div>

      <RagHintText>{t('knowledge_v2.rag.file_processing_hint')}</RagHintText>
    </section>
  )
}

export default FileProcessingSection
