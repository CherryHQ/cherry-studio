import { Badge, InfoTooltip, MenuItem, MenuList, PageHeader } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import { SettingsContentBody } from '@renderer/components/SettingsPrimitives'
import { useTheme } from '@renderer/hooks/useTheme'
import {
  settingsContentScrollClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName
} from '@renderer/pages/settings/settingsStyles'
import type { FileProcessorFeature } from '@shared/data/preference/preferenceTypes'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ProcessorAvatar } from './components/ProcessorAvatar'
import { ProcessorPanel } from './components/ProcessorPanel'
import { useAvailableFileProcessors } from './hooks/useAvailableFileProcessors'
import { useFileProcessingPreferences } from './hooks/useFileProcessingPreferences'
import {
  type FileProcessingMenuEntry,
  getFeatureSections,
  getFileProcessingFeatureTitleKey,
  getFileProcessingFeatureTooltipKey,
  getProcessorNameKey
} from './utils/fileProcessingMeta'

type FileProcessingSettingsProps = {
  feature: FileProcessorFeature
}

const EMPTY_MENU_ENTRIES: FileProcessingMenuEntry[] = []

const FileProcessingSettings: FC<FileProcessingSettingsProps> = ({ feature }) => {
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
    () =>
      getFeatureSections(processors, availableProcessors.processorIds).filter((section) => section.feature === feature),
    [availableProcessors.processorIds, feature, processors]
  )
  const menuEntries = featureSections[0]?.entries ?? EMPTY_MENU_ENTRIES

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
          <PageHeader
            title={
              <span className="inline-flex max-w-full items-center gap-1.5 align-middle">
                <span className="truncate">{t(getFileProcessingFeatureTitleKey(feature))}</span>
                <InfoTooltip
                  content={t(getFileProcessingFeatureTooltipKey(feature))}
                  placement="right"
                  iconProps={{ size: 13, color: 'currentColor', className: 'shrink-0 opacity-80' }}
                />
              </span>
            }
          />
          <Scrollbar className="min-h-0 flex-1">
            <MenuList className={settingsSubmenuListClassName}>
              {menuEntries.map((entry) => (
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
