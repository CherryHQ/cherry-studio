import { Badge, InfoTooltip, MenuDivider, MenuItem, MenuList, PageHeader } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { useTheme } from '@renderer/context/ThemeProvider'
import type { FC } from 'react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  SettingsContentBody,
  settingsContentScrollClassName,
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
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
  getFileProcessingFeatureTooltipKey,
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
    setActiveKey((currentActiveKey) =>
      menuEntries.some((entry) => entry.key === currentActiveKey) ? currentActiveKey : (menuEntries[0]?.key ?? '')
    )
  }, [menuEntries])

  const activeEntry = menuEntries.find((entry) => entry.key === activeKey) ?? menuEntries[0]
  const activeEntryKey = activeEntry?.key ?? ''

  const isDefaultEntry = (entry: FileProcessingMenuEntry) =>
    entry.feature === 'image_to_text'
      ? defaultImageProcessor === entry.processor.id
      : defaultDocumentProcessor === entry.processor.id

  return (
    <div className="flex flex-1" data-theme-mode={themeMode}>
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <div className={`flex flex-col ${settingsSubmenuScrollClassName}`}>
          <PageHeader title={t('settings.tool.file_processing.title')} />
          <Scrollbar className="min-h-0 flex-1">
            <MenuList className={settingsSubmenuListClassName}>
              {featureSections.map((section, index) => (
                <Fragment key={section.feature}>
                  {index > 0 ? <MenuDivider className={settingsSubmenuDividerClassName} /> : null}
                  <div className={`${settingsSubmenuSectionTitleClassName} flex items-center gap-1.5`}>
                    <span>{t(getFileProcessingFeatureTitleKey(section.feature))}</span>
                    <InfoTooltip
                      content={t(getFileProcessingFeatureTooltipKey(section.feature))}
                      placement="right"
                      iconProps={{ size: 13, color: 'currentColor', className: 'opacity-80' }}
                    />
                  </div>
                  {section.entries.map((entry) => (
                    <MenuItem
                      key={entry.key}
                      label={t(getProcessorNameKey(entry.processor.id))}
                      active={activeEntryKey === entry.key}
                      onClick={() => setActiveKey(entry.key)}
                      icon={
                        <ProcessorAvatar
                          processorId={entry.processor.id}
                          size="md"
                          className="shrink-0 rounded-lg border border-border/30"
                        />
                      }
                      className={settingsSubmenuItemClassName}
                      labelClassName={settingsSubmenuItemLabelClassName}
                      suffix={
                        isDefaultEntry(entry) ? (
                          <Badge className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                            {t('common.default')}
                          </Badge>
                        ) : undefined
                      }
                    />
                  ))}
                </Fragment>
              ))}
            </MenuList>
          </Scrollbar>
        </div>

        <Scrollbar className={settingsContentScrollClassName}>
          <SettingsContentBody>
            {availableProcessors.status === 'error' ? (
              <div className="flex h-full min-h-55 items-center justify-center text-foreground-muted text-sm">
                {t('settings.tool.file_processing.errors.load_processors_failed')}
              </div>
            ) : activeEntry ? (
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
          </SettingsContentBody>
        </Scrollbar>
      </div>
    </div>
  )
}

export default FileProcessingSettings
