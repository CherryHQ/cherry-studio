import LocalModelDownloadPopup from '@renderer/components/popups/LocalModelDownloadPopup'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_LOCAL_MODEL, SELF_HOSTED_FILE_PROCESSORS } from '@shared/data/presets/fileProcessing'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useFileProcessorConnectivity } from '../../hooks/useFileProcessorConnectivity'
import { FileProcessorSelector, type FileProcessorSelectorOption } from './FileProcessorSelector'
import { RagFieldLabel } from './panelPrimitives'

const openFileProcessingSettings = () => openSettingsTab('/settings/file-processing')

/**
 * Every processor with a local-model prerequisite is OCR-backed today, and
 * `useLocalModel` takes exactly one kind. A future processor needing a different
 * model falls through this check untouched — it stays selectable without a
 * download prompt, which is what happened before this existed, rather than
 * quietly downloading the wrong model.
 */
const requiresLocalOcrModel = (processorId: string) =>
  FILE_PROCESSOR_LOCAL_MODEL[processorId as FileProcessorId] === 'ocr'

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
  const { status, isStatusResolved } = useLocalModel('ocr')
  // Open MinerU is the only self-hosted processor, and it is always in this list,
  // so one unconditional probe covers it. Probing every API processor instead would
  // fire requests at third-party SaaS hosts the user never asked us to contact.
  const { reachable, isResolved: isConnectivityResolved } = useFileProcessorConnectivity(
    'open-mineru',
    'document_to_markdown'
  )

  const options = useMemo(
    () =>
      fileProcessorOptions.flatMap((option) => {
        if (SELF_HOSTED_FILE_PROCESSORS.has(option.value as FileProcessorId)) {
          const unreachable = isConnectivityResolved && !reachable

          // Starting the server is something only the user can do, outside the app,
          // so a dead row offers nothing to act on — drop it rather than grey it out.
          // Unless this base is already saved with it: the trigger reads its label
          // from this list, so hiding it would show "not in use" for a base that is
          // still configured to use it.
          if (unreachable && option.value !== fileProcessorId) {
            return []
          }

          return [
            {
              ...option,
              disabled: option.disabled || unreachable,
              statusLabel: unreachable ? t('knowledge.rag.processor_unreachable') : option.statusLabel
            }
          ]
        }

        if (!requiresLocalOcrModel(option.value)) {
          return [option]
        }

        // Only `unsupported` hides the row: it means this machine can never run
        // the model, so there is nothing to offer. Not-downloaded stays listed —
        // picking it is how the user gets the download prompt.
        if (status === 'unsupported') {
          return []
        }

        // `useLocalModel` starts at `not_downloaded` before the probe answers;
        // labelling a ready model "not downloaded" for that first frame would be
        // a worse lie than showing no label at all.
        const needsDownload = isStatusResolved && status !== 'ready' && status !== 'downloading'

        return [
          {
            ...option,
            statusLabel: needsDownload ? t('knowledge.rag.processor_not_downloaded') : option.statusLabel
          }
        ]
      }),
    [fileProcessorId, fileProcessorOptions, isConnectivityResolved, isStatusResolved, reachable, status, t]
  )

  const handleChange = async (value: string | null) => {
    if (value === null || !requiresLocalOcrModel(value) || status === 'ready' || status === 'downloading') {
      onFileProcessorChange(value)
      return
    }

    // The dialog owns the whole download and resolves only once the model is on
    // disk. Selecting before that would leave the user with a processor whose job
    // dies on the missing model if they cancel or the download fails.
    const downloaded = await LocalModelDownloadPopup.show({
      model: 'ocr',
      description: t('settings.dependencies.localModels.ocr.subtitle')
    })
    if (!downloaded) {
      return
    }

    onFileProcessorChange(value)
  }

  return (
    <div>
      <RagFieldLabel label={t('knowledge.rag.file_processing')} hint={t('knowledge.rag.file_processing_hint')} />
      <FileProcessorSelector
        aria-label={t('knowledge.rag.file_processing')}
        value={fileProcessorId}
        options={options}
        placeholder={t('knowledge.rag.file_processing_none')}
        settingsLabel={t('common.go_to_settings')}
        onChange={(value) => void handleChange(value)}
        onSettingsNavigate={openFileProcessingSettings}
      />
    </div>
  )
}

export default FileProcessingSection
