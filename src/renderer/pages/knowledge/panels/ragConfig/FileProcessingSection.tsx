import { useTranslation } from 'react-i18next'

import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

import { FileProcessorSelector, type FileProcessorSelectorOption } from './FileProcessorSelector'
import { RagFieldLabel } from './panelPrimitives'

const openFileProcessingSettings = () => openSettingsTab('/settings/file-processing')

interface FileProcessingSectionProps {
  fileProcessorId: string | null
  fileProcessorOptions: FileProcessorSelectorOption[]
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
      <FileProcessorSelector
        aria-label={t('knowledge.rag.file_processing')}
        value={fileProcessorId}
        options={fileProcessorOptions}
        placeholder={t('knowledge.not_set')}
        unavailableLabel={t('knowledge.rag.processor_not_configured')}
        settingsLabel={t('common.go_to_settings')}
        onChange={onFileProcessorChange}
        onSettingsNavigate={openFileProcessingSettings}
      />
    </div>
  )
}

export default FileProcessingSection
