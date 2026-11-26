import { Search } from 'lucide-react'
import { type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Separator, Tooltip } from '@cherrystudio/ui'
import { BackButton } from '@renderer/components/BackButton'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { OpenInNewWindowIcon } from '@renderer/components/icons/WindowIcons'
import { AppShell } from '@renderer/components/layout/AppShell'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { WindowControls } from '@renderer/components/WindowControls'
import { useTabs } from '@renderer/hooks/tab'
import { MinimalModeContext } from '@renderer/hooks/useMinimalMode'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { SidebarAvailableContext } from '@renderer/hooks/useSidebarAvailable'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

import { useMinimalNavigation } from './hooks/useMinimalNavigation'
import { LaunchpadDialog } from './LaunchpadDialog'
import { MiniLaunchpad } from './MiniLaunchpad'
import { MinimalSidebarHeader, MinimalSidebarFooter, MinimalSidebarToggle } from './MinimalSidebar'

export function MainWindowShell() {
  const navigation = useMinimalNavigation()
  const { t } = useTranslation()
  const { activeTab } = useTabs()
  const launchpadTrigger = useRef<HTMLElement | null>(null)
  const showLaunchpad = () => {
    launchpadTrigger.current = document.activeElement as HTMLElement
    setLaunchpadOpen(true)
  }
  const [launchpadOpen, setLaunchpadOpen] = useState(false)
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
      <MiniLaunchpad onOpen={showLaunchpad} />
    </>
  )
  const renderToolbar = (isHome: boolean, sidebarOpen = false, topBar?: ReactNode, onDetach?: () => void) => (
    <header
      className={cn(
        'flex shrink-0 items-center gap-2 px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]',
        isHome ? (isMac && !fullscreen ? 'h-11.5' : 'h-14') : 'h-11 border-b-[0.5px] border-border',
        isHome &&
          'gap-0 transition-[padding-left] duration-300 ease-in-out [--muted-foreground:var(--foreground)] motion-reduce:transition-none',
        isMac && !fullscreen && !sidebarOpen && 'pl-[max(80px,env(titlebar-area-x))]'
      )}>
      {!isHome && (
        <>
          <BackButton className="pr-0" aria-label={t('minimal.return_home')} onClick={navigation.returnHome} />
          <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-3" />
        </>
      )}
      {!isHome && <span className="min-w-0 truncate text-sm text-muted-foreground">{activeTab?.title}</span>}
      {isHome && (
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
        enabled: navigation.enabled,
        homeTabId: navigation.homeTabId,
        renderHomeToolbar: (sidebarOpen, topBar) => renderToolbar(true, sidebarOpen, topBar),
        renderSidebarHeader: (onAddAgent) => (
          <MinimalSidebarHeader onAddAgent={onAddAgent}>{sidebarToolbarActions}</MinimalSidebarHeader>
        ),
        renderSidebarToggle: (sidebarOpen, onSidebarToggle) => (
          <MinimalSidebarToggle sidebarOpen={sidebarOpen} onSidebarToggle={onSidebarToggle} />
        ),
        sidebarFooter: <MinimalSidebarFooter />
      }}>
      <SidebarAvailableContext value={!navigation.enabled}>
        <AppShell
          minimalMode={navigation.enabled ? navigation : undefined}
          minimalToolbar={(detachTab) =>
            navigation.isHome
              ? null
              : renderToolbar(
                  false,
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
        <LaunchpadDialog
          returnFocusRef={launchpadTrigger}
          open={navigation.enabled && launchpadOpen}
          onOpenChange={setLaunchpadOpen}
          onOpen={navigation.openFeature}
        />
      </SidebarAvailableContext>
    </MinimalModeContext>
  )
}
