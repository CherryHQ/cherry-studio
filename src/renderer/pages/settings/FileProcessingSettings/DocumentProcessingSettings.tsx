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

const documentProcessingFieldClassName =
  '[&_input[data-slot=input]]:h-8 [&_input[data-slot=input]]:rounded-lg [&_input[data-slot=input]]:border-border-subtle ' +
  '[&_input[data-slot=input]]:bg-muted/30 [&_input[data-slot=input]]:px-2.5 [&_input[data-slot=input]]:shadow-none ' +
  '[&_input[data-slot=input]:focus-visible]:ring-[1px] [&_input[data-slot=input]:focus-visible]:ring-ring/35 ' +
  '[&_[data-slot=input-group]]:h-8 [&_[data-slot=input-group]]:rounded-lg [&_[data-slot=input-group]]:border-border-subtle ' +
  '[&_[data-slot=input-group]]:bg-muted/30 [&_[data-slot=input-group]]:shadow-none ' +
  '[&_[data-slot=input-group-control]]:px-2.5'

const DocumentProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const {
    defaultDocumentProcessor,
    processors,
    setApiKeys,
    setCapabilityField,
    setDefaultProcessor,
    setLanguageOptions
  } = useFileProcessingPreferences()

  const availableProcessors = useAvailableFileProcessors()
  const visibleProcessorIds = useMemo(
    () =>
      availableProcessors.status === 'ready' || !defaultDocumentProcessor
        ? availableProcessors.processorIds
        : new Set([defaultDocumentProcessor]),
    [availableProcessors.processorIds, availableProcessors.status, defaultDocumentProcessor]
  )
  const menuEntries = useMemo(
    () =>
      getFeatureSections(processors, visibleProcessorIds).find((section) => section.feature === 'document_to_markdown')
        ?.entries ?? EMPTY_MENU_ENTRIES,
    [processors, visibleProcessorIds]
  )

  const [activeKey, setActiveKey] = useState(
    () => menuEntries.find((entry) => entry.processor.id === defaultDocumentProcessor)?.key ?? menuEntries[0]?.key ?? ''
  )

  useEffect(() => {
    setActiveKey(
      menuEntries.find((entry) => entry.processor.id === defaultDocumentProcessor)?.key ?? menuEntries[0]?.key ?? ''
    )
  }, [defaultDocumentProcessor, menuEntries])

  const activeEntry = menuEntries.find((entry) => entry.key === activeKey) ?? menuEntries[0]

  return (
    <SettingsContentColumn theme={themeMode} innerClassName={documentProcessingFieldClassName}>
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

export default DocumentProcessingSettings
