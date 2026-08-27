import LocalModelDownloadPopup from '@renderer/components/popups/LocalModelDownloadPopup'
import { useLocalModel } from '@renderer/hooks/useLocalModel'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import type { FileProcessorId } from '@shared/data/preference/preferenceTypes'
import { FILE_PROCESSOR_LOCAL_MODEL } from '@shared/data/presets/fileProcessing'
import { LOCAL_MODEL_BUNDLE_BY_CAPABILITY } from '@shared/data/presets/localModel'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useOpenMineruConnectivity } from '../../hooks/useOpenMineruConnectivity'
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
  initialFileProcessorId: string | null
  fileProcessorOptions: FileProcessorSelectorOption[]
  onFileProcessorChange: (value: string | null) => void
}

const FileProcessingSection = ({
  fileProcessorId,
  initialFileProcessorId,
  fileProcessorOptions,
  onFileProcessorChange
}: FileProcessingSectionProps) => {
  const { t } = useTranslation()
  const { status, isStatusResolved } = useLocalModel(LOCAL_MODEL_BUNDLE_BY_CAPABILITY.ocr)
  // Open MinerU is the only self-hosted processor, so one unconditional probe
  // covers it. Probing every API processor instead would
  // fire requests at third-party SaaS hosts the user never asked us to contact.
  const { reachable, isResolved: isConnectivityResolved } = useOpenMineruConnectivity()

  const options = useMemo(
    () =>
      fileProcessorOptions.flatMap((option) => {
        if (option.value === 'open-mineru') {
          const unreachable = isConnectivityResolved && !reachable
          const isPersistedSelection = option.value === initialFileProcessorId

          // Starting the server is something only the user can do, outside the app,
          // so a dead row offers nothing to act on — drop it rather than grey it out.
          // Unless this base is already saved with it: the trigger reads its label
          // from this list, so hiding it would show "not in use" for a base that is
          // still configured to use it.
          if (unreachable && !isPersistedSelection) {
            return []
          }

          return [
            {
              ...option,
              disabled: option.disabled || !isConnectivityResolved || unreachable,
              statusLabel: unreachable ? t('knowledge.rag.processor_unreachable') : option.statusLabel
            }
          ]
        }

        if (!requiresLocalOcrModel(option.value)) {
          return [option]
        }

        // The support-list layer removes unsupported processors once its request
        // resolves. Before that (or after a request failure), only a persisted
        // processor can reach here, and it must remain visible but disabled.
        if (status === 'unsupported') {
          return option.value === initialFileProcessorId ? [{ ...option, disabled: true }] : []
        }

        // `useLocalModel` starts at `not_downloaded` before the probe answers;
        // labelling a ready model "not downloaded" for that first frame would be
        // a worse lie than showing no label at all.
        const needsDownload = isStatusResolved && status !== 'ready' && status !== 'downloading'

        return [
          {
            ...option,
            disabled: option.disabled || !isStatusResolved || status === 'downloading',
            statusLabel: needsDownload ? t('knowledge.rag.processor_not_downloaded') : option.statusLabel
          }
        ]
      }),
    [fileProcessorOptions, initialFileProcessorId, isConnectivityResolved, isStatusResolved, reachable, status, t]
  )

  const handleChange = async (value: string | null) => {
    if (value === 'open-mineru' && (!isConnectivityResolved || !reachable)) {
      return
    }

    if (value === null || !requiresLocalOcrModel(value)) {
      onFileProcessorChange(value)
      return
    }

    if (!isStatusResolved || status === 'downloading') {
      return
    }

    if (status === 'ready') {
      onFileProcessorChange(value)
      return
    }

    // The dialog owns the whole download and resolves only once the model is on
    // disk. Selecting before that would leave the user with a processor whose job
    // dies on the missing model if they cancel or the download fails.
    const downloaded = await LocalModelDownloadPopup.show({
      id: LOCAL_MODEL_BUNDLE_BY_CAPABILITY.ocr,
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
