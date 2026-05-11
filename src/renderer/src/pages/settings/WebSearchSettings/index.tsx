import { Badge, MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import type { FC } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  settingsContentScrollClassName,
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuListClassName,
  settingsSubmenuScrollClassName,
  settingsSubmenuSectionTitleClassName
} from '..'
import { WebSearchGeneralSettings } from './components/WebSearchGeneralSettings'
import WebSearchProviderLogo from './components/WebSearchProviderLogo'
import { WebSearchProviderSetting } from './components/WebSearchProviderSetting'
import { useWebSearchProviderLists } from './hooks/useWebSearchProviderLists'
import { getWebSearchCapabilityTitleKey } from './utils/webSearchProviderMeta'

const WebSearchSettings: FC = () => {
  const { t } = useTranslation()
  const { defaultFetchUrlsProvider, defaultSearchKeywordsProvider, featureSections } = useWebSearchProviderLists()
  const [activeKey, setActiveKey] = useState('general')
  const activeEntry = useMemo(
    () => featureSections.flatMap((section) => section.entries).find((entry) => entry.key === activeKey),
    [activeKey, featureSections]
  )

  useEffect(() => {
    if (activeKey !== 'general' && !activeEntry) {
      setActiveKey('general')
    }
  }, [activeEntry, activeKey])

  return (
    <div className="flex flex-1">
      <div className="flex h-[calc(100vh-var(--navbar-height)-6px)] w-full flex-1 flex-row overflow-hidden">
        <Scrollbar className={settingsSubmenuScrollClassName}>
          <MenuList className={settingsSubmenuListClassName}>
            <MenuItem
              label={t('settings.tool.websearch.search_provider')}
              active={activeKey === 'general'}
              onClick={() => setActiveKey('general')}
              className={settingsSubmenuItemClassName}
            />
            <MenuDivider className={settingsSubmenuDividerClassName} />
            {featureSections.map((section) => (
              <div key={section.capability}>
                <div className={settingsSubmenuSectionTitleClassName}>
                  {t(getWebSearchCapabilityTitleKey(section.capability))}
                </div>
                {section.entries.map((entry) => {
                  const isDefault =
                    entry.capability === 'fetchUrls'
                      ? defaultFetchUrlsProvider?.id === entry.provider.id
                      : defaultSearchKeywordsProvider?.id === entry.provider.id

                  return (
                    <MenuItem
                      key={entry.key}
                      label={entry.provider.name}
                      active={activeKey === entry.key}
                      onClick={() => setActiveKey(entry.key)}
                      icon={<WebSearchProviderLogo providerId={entry.provider.id} providerName={entry.provider.name} />}
                      className={settingsSubmenuItemClassName}
                      suffix={
                        isDefault ? (
                          <Badge className="mr-0 ml-auto rounded-full border border-green-500/30 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-600 text-xs dark:text-green-400">
                            {t('common.default')}
                          </Badge>
                        ) : undefined
                      }
                    />
                  )
                })}
              </div>
            ))}
          </MenuList>
        </Scrollbar>
        <div className={`${settingsContentScrollClassName} relative flex`}>
          {activeEntry ? <WebSearchProviderSetting entry={activeEntry} /> : <WebSearchGeneralSettings />}
        </div>
      </div>
    </div>
  )
}

export default WebSearchSettings
