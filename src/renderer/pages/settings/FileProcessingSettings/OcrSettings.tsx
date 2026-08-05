import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingsContentColumn } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'

import { ProcessorPanel } from './components/ProcessorPanel'
import { useAvailableFileProcessors } from './hooks/useAvailableFileProcessors'
import { useFileProcessingPreferences } from './hooks/useFileProcessingPreferences'
import { type FileProcessingMenuEntry, getFeatureSections } from './utils/fileProcessingMeta'

const EMPTY_MENU_ENTRIES: FileProcessingMenuEntry[] = []

const OcrSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const { defaultImageProcessor, processors, setApiKeys, setCapabilityField, setDefaultProcessor, setLanguageOptions } =
    useFileProcessingPreferences()

  const availableProcessors = useAvailableFileProcessors()
  const menuEntries = useMemo(
    () =>
      getFeatureSections(processors, availableProcessors.processorIds).find(
        (section) => section.feature === 'image_to_text'
      )?.entries ?? EMPTY_MENU_ENTRIES,
    [availableProcessors.processorIds, processors]
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
      {availableProcessors.status === 'error' ? (
        <div className="flex h-full min-h-55 items-center justify-center text-sm text-foreground-tertiary">
          {t('settings.tool.file_processing.errors.load_processors_failed')}
        </div>
      ) : activeEntry ? (
        <ProcessorPanel
          entry={activeEntry}
          entries={menuEntries}
          onSelectEntry={(entry) => setActiveKey(entry.key)}
          onSetApiKeys={setApiKeys}
          onSetCapabilityField={setCapabilityField}
          onSetDefaultProcessor={setDefaultProcessor}
          onSetLanguageOptions={setLanguageOptions}
        />
      ) : (
        <div className="flex h-full min-h-55 items-center justify-center text-sm text-foreground-tertiary">
          {t('common.no_results')}
        </div>
      )}
    </SettingsContentColumn>
  )
}

export default OcrSettings
