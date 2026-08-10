import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useAvailableFileProcessors } from '@renderer/hooks/useAvailableFileProcessors'
import { useTheme } from '@renderer/hooks/useTheme'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProcessorPanel } from './components/ProcessorPanel'
import { useFileProcessingPreferences } from './hooks/useFileProcessingPreferences'
import { type FileProcessingMenuEntry, getFeatureSections } from './utils/fileProcessingMeta'

const EMPTY_MENU_ENTRIES: FileProcessingMenuEntry[] = []

const OcrSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const { defaultImageProcessor, processors, setApiKeys, setCapabilityField, setDefaultProcessor, setLanguageOptions } =
    useFileProcessingPreferences()

  const availableProcessors = useAvailableFileProcessors()
  const visibleProcessorIds = useMemo(
    () =>
      availableProcessors.status === 'ready' || !defaultImageProcessor
        ? availableProcessors.processorIds
        : new Set([defaultImageProcessor]),
    [availableProcessors.processorIds, availableProcessors.status, defaultImageProcessor]
  )
  const menuEntries = useMemo(
    () =>
      getFeatureSections(processors, visibleProcessorIds).find((section) => section.feature === 'image_to_text')
        ?.entries ?? EMPTY_MENU_ENTRIES,
    [processors, visibleProcessorIds]
  )

  const [activeKey, setActiveKey] = useState(
    () => menuEntries.find((entry) => entry.processor.id === defaultImageProcessor)?.key ?? menuEntries[0]?.key ?? ''
  )

  useEffect(() => {
    setActiveKey(
      menuEntries.find((entry) => entry.processor.id === defaultImageProcessor)?.key ?? menuEntries[0]?.key ?? ''
    )
  }, [defaultImageProcessor, menuEntries])

  const activeEntry = menuEntries.find((entry) => entry.key === activeKey) ?? menuEntries[0]

  return (
    <SettingsContentColumn theme={themeMode}>
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
    </SettingsContentColumn>
  )
}

export default OcrSettings
