import { MenuDivider, MenuItem, MenuList, PageHeader, SearchInput } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import {
  settingsSubmenuDividerClassName,
  settingsSubmenuItemClassName,
  settingsSubmenuItemLabelClassName,
  settingsSubmenuListClassName,
  settingsSubmenuSectionTitleClassName
} from '@renderer/pages/settings/settingsStyles'
import { cn } from '@renderer/utils/style'
import { Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import type { CSSProperties, FC } from 'react'
import { Fragment, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { settingsNavigationSections, type SettingsPath } from './settingsNavigation'
import { buildSettingsSearchEntries, filterSettingsSearchEntries } from './settingsSearch'

const SettingsPage: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname } = location
  const { t, i18n } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()
  const [searchText, setSearchText] = useState('')

  const searchEntries = useMemo(
    () =>
      buildSettingsSearchEntries(
        settingsNavigationSections,
        i18n.getResourceBundle('en-US', 'translation') as Record<string, string>,
        t
      ),
    [i18n, t]
  )
  const matchingPaths = useMemo(
    () => new Set(filterSettingsSearchEntries(searchEntries, searchText).map((entry) => entry.path)),
    [searchEntries, searchText]
  )
  const isSearching = searchText.trim().length > 0
  const visibleSections = isSearching
    ? settingsNavigationSections
        .map((section) => ({ ...section, items: section.items.filter((item) => matchingPaths.has(item.path)) }))
        .filter((section) => section.items.length > 0)
    : settingsNavigationSections

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const go = (path: SettingsPath) => {
    setSearchText('')
    void navigate({ to: path })
  }

  return (
    <div
      style={isMacTransparentWindow ? ({ '--settings-group-background': 'transparent' } as CSSProperties) : undefined}
      data-ui="settings.view"
      className={cn(
        'flex min-h-0 flex-1 flex-col dark:[--settings-group-background:var(--background-subtle)]',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-background'
      )}>
      <div className="flex min-h-0 flex-1 flex-row">
        <div
          data-ui="settings.navigation"
          className="flex min-h-0 w-(--settings-width) min-w-(--settings-width) flex-col border-border border-r-[0.5px]">
          <PageHeader title={t('title.settings')} className="mb-1" />
          <div className="px-2.5 pb-2">
            <SearchInput
              size="sm"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              onClear={() => setSearchText('')}
              clearLabel={t('common.clear')}
              placeholder={t('common.search')}
              aria-label={t('common.search')}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && searchText) {
                  event.stopPropagation()
                  setSearchText('')
                }
              }}
            />
          </div>
          <Scrollbar className="min-h-0 flex-1 select-none">
            {visibleSections.length > 0 ? (
              <MenuList className={settingsSubmenuListClassName}>
                {visibleSections.map((section, sectionIndex) => (
                  <Fragment key={section.labelKey ?? 'primary'}>
                    {sectionIndex > 0 && <MenuDivider className={settingsSubmenuDividerClassName} />}
                    {section.labelKey && (
                      <div className={settingsSubmenuSectionTitleClassName}>{t(section.labelKey)}</div>
                    )}
                    {section.items.map((item) => (
                      <MenuItem
                        key={item.path}
                        className={settingsSubmenuItemClassName}
                        labelClassName={settingsSubmenuItemLabelClassName}
                        icon={item.icon}
                        label={t(item.labelKey)}
                        active={isActive(item.path)}
                        onClick={() => go(item.path)}
                      />
                    ))}
                  </Fragment>
                ))}
              </MenuList>
            ) : (
              <div role="status" className="px-5 py-3 text-muted-foreground text-xs">
                {t('common.no_results')}
              </div>
            )}
          </Scrollbar>
        </div>
        <div className="flex h-full min-h-0 min-w-0 flex-1">
          <div data-ui="settings.content" className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-foreground">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
