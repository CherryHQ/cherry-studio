import { House, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { OpenInNewWindowIcon } from '@renderer/components/icons/WindowIcons'
import { AppShell } from '@renderer/components/layout/AppShell'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { WindowControls } from '@renderer/components/WindowControls'
import { useTabs } from '@renderer/hooks/tab'
import { MinimalModeContext } from '@renderer/hooks/useMinimalMode'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

import { useMinimalNavigation } from './hooks/useMinimalNavigation'
import { MiniLaunchpad } from './MiniLaunchpad'
import { MinimalSidebarHeader, MinimalSidebarFooter, MinimalSidebarToggle } from './MinimalSidebar'

export function MainWindowShell() {
  const navigation = useMinimalNavigation()
  const { t } = useTranslation()
  const { activeTab } = useTabs()
  const fullscreen = useNativeFullscreen()
  const sidebarToolbarActions = (
    <>
      <CommandTooltip command="app.search" label={t('globalSearch.open')} placement="bottom">
        <NavbarIcon
          tone="conversation"
          className="[&_svg]:!size-4"
          aria-label={t('globalSearch.open')}
          onClick={() => void GlobalSearchPopup.show()}>
          <Search strokeWidth={1.7} />
        </NavbarIcon>
      </CommandTooltip>
      <MiniLaunchpad onOpen={navigation.openFeature} />
    </>
  )
  const renderToolbar = (sidebarOpen = false, topBar?: ReactNode, onDetach?: () => void) => (
    <header
      className={cn(
        'flex shrink-0 items-center gap-2 border-b-[0.5px] border-border px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]',
        navigation.isHome ? 'h-11.5' : 'h-11',
        navigation.isHome && 'gap-0 transition-[padding-left] duration-300 ease-in-out motion-reduce:transition-none',
        navigation.isHome && sidebarOpen && 'pl-0',
        isMac && !fullscreen && !sidebarOpen && 'pl-[max(80px,env(titlebar-area-x))]'
      )}>
      {!navigation.isHome && (
        <div className="[-webkit-app-region:no-drag]">
          <NavbarIcon
            tone="conversation"
            className="[&_svg]:!size-4"
            aria-label={t('minimal.return_home')}
            onClick={navigation.returnHome}>
            <House strokeWidth={1.7} />
          </NavbarIcon>
        </div>
      )}
      {!navigation.isHome && <span className="min-w-0 truncate text-sm text-muted-foreground">{activeTab?.title}</span>}
      {navigation.isHome && (
        <div
          aria-hidden
          className={cn(
            'shrink-0 transition-[width] duration-300 ease-in-out [-webkit-app-region:no-drag] motion-reduce:transition-none',
            sidebarOpen ? 'w-0' : 'w-[34px]'
          )}
        />
      )}
      <div className="min-w-0 flex-1">{topBar}</div>
      {onDetach && (
        <Tooltip content={t('tab.open_in_new_window')} placement="bottom" delay={800}>
          <Button
            type="button"
            variant="ghost"
            aria-label={t('tab.open_in_new_window')}
            onClick={onDetach}
            className="group size-8 cursor-pointer rounded-[8px] p-0">
            <OpenInNewWindowIcon
              className="text-foreground-tertiary transition-colors group-hover:text-foreground"
              size={16}
            />
          </Button>
        </Tooltip>
      )}
      <WindowControls />
    </header>
  )
  return (
    <MinimalModeContext
      value={{
        ...navigation,
        renderHomeToolbar: renderToolbar,
        sidebarToolbarActions,
        sidebarHeader: <MinimalSidebarHeader />,
        renderSidebarToggle: (sidebarOpen, onSidebarToggle) => (
          <MinimalSidebarToggle sidebarOpen={sidebarOpen} onSidebarToggle={onSidebarToggle} />
        ),
        sidebarFooter: <MinimalSidebarFooter />
      }}>
      <AppShell
        minimalToolbar={(detachTab) =>
          navigation.isHome
            ? null
            : renderToolbar(
                false,
                undefined,
                activeTab
                  ? () => {
                      detachTab(activeTab.id)
                      navigation.returnHome()
                    }
                  : undefined
              )
        }
      />
    </MinimalModeContext>
  )
}
