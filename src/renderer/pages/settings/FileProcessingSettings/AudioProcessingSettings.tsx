import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useAvailableFileProcessors } from '@renderer/hooks/useAvailableFileProcessors'
import { useTheme } from '@renderer/hooks/useTheme'

import { ProcessorPanel } from './components/ProcessorPanel'
import { VideoVisionModelSettings } from './components/VideoVisionModelSettings'
import { useFileProcessingPreferences } from './hooks/useFileProcessingPreferences'
import { type FileProcessingMenuEntry, getFeatureSections } from './utils/fileProcessingMeta'

const EMPTY_MENU_ENTRIES: FileProcessingMenuEntry[] = []

const AudioProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const { defaultAudioProcessor, processors, setApiKeys, setCapabilityField, setDefaultProcessor, setLanguageOptions } =
    useFileProcessingPreferences()

  const availableProcessors = useAvailableFileProcessors()
  const visibleProcessorIds = useMemo(
    () =>
      availableProcessors.status === 'ready' || !defaultAudioProcessor
        ? availableProcessors.processorIds
        : new Set([defaultAudioProcessor]),
    [availableProcessors.processorIds, availableProcessors.status, defaultAudioProcessor]
  )
  const menuEntries = useMemo(
    () =>
      getFeatureSections(processors, visibleProcessorIds).find((section) => section.feature === 'audio_to_text')
        ?.entries ?? EMPTY_MENU_ENTRIES,
    [processors, visibleProcessorIds]
  )

  const [activeKey, setActiveKey] = useState(
    () => menuEntries.find((entry) => entry.processor.id === defaultAudioProcessor)?.key ?? menuEntries[0]?.key ?? ''
  )

  useEffect(() => {
    setActiveKey(
      menuEntries.find((entry) => entry.processor.id === defaultAudioProcessor)?.key ?? menuEntries[0]?.key ?? ''
    )
  }, [defaultAudioProcessor, menuEntries])

  const activeEntry = menuEntries.find((entry) => entry.key === activeKey) ?? menuEntries[0]

  return (
    <SettingsContentColumn theme={themeMode}>
      <div className="flex flex-col gap-6">
        {activeEntry ? (
          <ProcessorPanel
            entry={activeEntry}
            entries={menuEntries}
            selectionDisabled={availableProcessors.status !== 'ready'}
            onSelectEntry={(entry) => setActiveKey(entry.key)}
            onSetApiKeys={setApiKeys}
            onSetCapabilityField={setCapabilityField}
            onSetDefaultProcessor={setDefaultProcessor}
            onSetLanguageOptions={setLanguageOptions}
          />
        ) : availableProcessors.status === 'error' ? (
          <div className="flex h-full min-h-55 items-center justify-center text-foreground-tertiary text-sm">
            {t('settings.tool.file_processing.errors.load_processors_failed')}
          </div>
        ) : (
          <div className="flex h-full min-h-55 items-center justify-center text-foreground-tertiary text-sm">
            {t('common.no_results')}
          </div>
        )}
        <VideoVisionModelSettings />
        <p className="text-foreground-tertiary text-sm leading-5">
          {t('settings.tool.file_processing.video_ocr_hint')}
        </p>
      </div>
    </SettingsContentColumn>
  )
}

export default AudioProcessingSettings
