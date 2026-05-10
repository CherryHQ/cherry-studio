import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProcessorPanel } from './components/ProcessorPanel'
import { ProcessorSidebar } from './components/ProcessorSidebar'
import { useAvailableFileProcessors } from './hooks/useAvailableFileProcessors'
import { useFileProcessingPreferences } from './hooks/useFileProcessingPreferences'
import { flattenFeatureSections, getFeatureSections } from './utils/fileProcessingMeta'

const FileProcessingSettings: FC = () => {
  const { t } = useTranslation()
  const { theme: themeMode } = useTheme()
  const {
    defaultDocumentProcessor,
    defaultImageProcessor,
    processors,
    setApiKeys,
    setCapabilityField,
    setDefaultProcessor,
    setLanguageOptions
  } = useFileProcessingPreferences()

  const availableProcessors = useAvailableFileProcessors()
  const featureSections = useMemo(
    () => getFeatureSections(processors, availableProcessors.processorIds),
    [availableProcessors.processorIds, processors]
  )
  const menuEntries = useMemo(() => flattenFeatureSections(featureSections), [featureSections])

  const [activeKey, setActiveKey] = useState(() => menuEntries[0]?.key ?? '')

  useEffect(() => {
    if (!menuEntries.some((entry) => entry.key === activeKey)) {
      setActiveKey(menuEntries[0]?.key ?? '')
    }
  }, [activeKey, menuEntries])

  const activeEntry = menuEntries.find((entry) => entry.key === activeKey)

  return (
    <div className="flex flex-1" data-theme-mode={themeMode}>
      <div className="m-2 ml-0 flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02]">
        <div className="flex min-h-0 flex-1">
          <ProcessorSidebar
            featureSections={featureSections}
            activeKey={activeKey}
            defaultDocumentProcessor={defaultDocumentProcessor}
            defaultImageProcessor={defaultImageProcessor}
            onSelect={setActiveKey}
          />
          <div className="flex min-w-0 flex-1 flex-col">
            <Scrollbar className="min-h-0 flex-1 [&::-webkit-scrollbar-thumb]:bg-border/20 [&::-webkit-scrollbar]:w-[3px]">
              {activeEntry ? (
                <ProcessorPanel
                  entry={activeEntry}
                  defaultDocumentProcessor={defaultDocumentProcessor}
                  defaultImageProcessor={defaultImageProcessor}
                  onSetApiKeys={setApiKeys}
                  onSetCapabilityField={setCapabilityField}
                  onSetDefaultProcessor={setDefaultProcessor}
                  onSetLanguageOptions={setLanguageOptions}
                />
              ) : (
                <div className="flex h-full min-h-[220px] items-center justify-center text-foreground-muted text-xs">
                  {t('common.no_results')}
                </div>
              )}
            </Scrollbar>
          </div>
        </div>
      </div>
    </div>
  )
}

export default FileProcessingSettings
