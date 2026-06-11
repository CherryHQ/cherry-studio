import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import { useTranslation } from 'react-i18next'

import { RagFieldLabel, RagSelectField } from './panelPrimitives'

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
    <div>
      <RagFieldLabel label={t('knowledge.rag.file_processing')} hint={t('knowledge.rag.file_processing_hint')} />
      <RagSelectField
        value={fileProcessorId ?? EMPTY_OPTION_VALUE}
        options={[{ value: EMPTY_OPTION_VALUE, label: t('knowledge.not_set') }, ...fileProcessorOptions]}
        onValueChange={(value) => onFileProcessorChange(value === EMPTY_OPTION_VALUE ? null : value)}
      />
    </div>
  )
}

export default FileProcessingSection
