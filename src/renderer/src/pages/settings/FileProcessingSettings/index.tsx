import { Badge, MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  settingsContentBodyClassName,
  settingsContentScrollClassName,
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '..'
import { ProcessorAvatar } from './components/ProcessorAvatar'
import { ProcessorPanel } from './components/ProcessorPanel'
import { useAvailableFileProcessors } from './hooks/useAvailableFileProcessors'
import { useFileProcessingPreferences } from './hooks/useFileProcessingPreferences'
import {
  type FileProcessingMenuEntry,
  flattenFeatureSections,
  getFeatureSections,
  getFileProcessingFeatureTitleKey,
  getProcessorNameKey
} from './utils/fileProcessingMeta'

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

  const isDefaultEntry = (entry: FileProcessingMenuEntry) =>
    entry.feature === 'image_to_text'
      ? defaultImageProcessor === entry.processor.id
      : defaultDocumentProcessor === entry.processor.id

  return (
    <div className="flex flex-1" data-theme-mode={themeMode}>
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            {featureSections.map((section, index) => (
              <div key={section.feature}>
                {index > 0 ? <MenuDivider className={settingsSubmenuDividerClassName} /> : null}
                <div className={settingsSubmenuSectionTitleClassName}>
                  {t(getFileProcessingFeatureTitleKey(section.feature))}
                </div>
                {section.entries.map((entry) => (
                  <MenuItem
                    key={entry.key}
                    label={t(getProcessorNameKey(entry.processor.id))}
                    active={activeKey === entry.key}
                    onClick={() => setActiveKey(entry.key)}
                    icon={<ProcessorAvatar processorId={entry.processor.id} />}
                    className={settingsSubmenuItemClassName}
                    suffix={
                      isDefaultEntry(entry) ? (
                        <Badge className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                          {t('common.default')}
                        </Badge>
                      ) : undefined
                    }
                  />
                ))}
              </div>
            ))}
          </MenuList>
        </Scrollbar>

        <Scrollbar className={settingsContentScrollClassName}>
          <div className={settingsContentBodyClassName}>
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
              <div className="flex h-full min-h-55 items-center justify-center text-foreground-muted text-sm">
                {t('common.no_results')}
              </div>
            )}
          </div>
        </Scrollbar>
      </div>
    </div>
  )
}

export default FileProcessingSettings
