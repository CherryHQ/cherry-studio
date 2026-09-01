import { MenuDivider, MenuItem, MenuList } from '@cherrystudio/ui'
import Scrollbar from '@renderer/components/Scrollbar'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { settingsMenu } from '@renderer/pages/settings/settingsMenu'
import SettingsFocusScroll from '@renderer/pages/settings/settingsSearch/SettingsFocusScroll'
import SettingsSearchBox from '@renderer/pages/settings/settingsSearch/SettingsSearchBox'
import { SettingsSearchDomIdsProvider } from '@renderer/pages/settings/settingsSearch/SettingsSearchDomIds'
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
import { Fragment, useRef } from 'react'
import { useTranslation } from 'react-i18next'

const SettingsPage: FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { pathname } = location
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()
  // Anchor-lookup scope for SettingsFocusScroll (this tab's content column)
  const contentRef = useRef<HTMLDivElement>(null)

  const isActive = (path: string) => pathname === path || pathname.startsWith(`${path}/`)
  const go = (path: string) => navigate({ to: path })

  return (
    <SettingsSearchDomIdsProvider>
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
            <SettingsSearchBox />
            <Scrollbar className="min-h-0 flex-1 select-none">
              <MenuList className={settingsSubmenuListClassName}>
                {settingsMenu.map((item, index) => {
                  const startsNewGroup = index > 0 && item.groupKey !== settingsMenu[index - 1].groupKey
                  return (
                    <Fragment key={item.route}>
                      {startsNewGroup && (
                        <>
                          <MenuDivider className={settingsSubmenuDividerClassName} />
                          {item.groupKey && (
                            <div className={settingsSubmenuSectionTitleClassName}>{t(item.groupKey)}</div>
                          )}
                        </>
                      )}
                      <MenuItem
                        className={settingsSubmenuItemClassName}
                        labelClassName={settingsSubmenuItemLabelClassName}
                        icon={item.icon}
                        label={t(item.titleKey)}
                        active={isActive(item.route)}
                        onClick={() => go(item.route)}
                      />
                    </Fragment>
                  )
                })}
              </MenuList>
            </Scrollbar>
          </div>
          <div className="flex h-full min-h-0 min-w-0 flex-1">
            <div
              ref={contentRef}
              data-ui="settings.content"
              className="flex min-h-0 min-w-0 flex-1 overflow-hidden text-foreground">
              <Outlet />
              <SettingsFocusScroll scopeRef={contentRef} />
            </div>
          </div>
        </div>
      </div>
    </SettingsSearchDomIdsProvider>
  )
}

export default SettingsPage
