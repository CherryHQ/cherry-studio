import { Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { BackButton } from '@renderer/components/BackButton'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
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
  const renderToolbar = (
    sidebarOpen = false,
    topBar?: ReactNode,
    onSidebarToggle?: () => void,
    onDetach?: () => void
  ) => (
    <header
      className={cn(
        'flex shrink-0 items-center gap-2 px-2 [-webkit-app-region:drag] [&_button]:[-webkit-app-region:no-drag]',
        navigation.isHome ? 'h-13' : 'h-11',
        navigation.isHome && sidebarOpen && 'pl-0',
        navigation.isHome && isMac && !fullscreen && 'pb-1.5',
        isMac && !fullscreen && !sidebarOpen && 'pl-[max(80px,env(titlebar-area-x))]'
      )}>
      {!navigation.isHome && (
        <div className="[-webkit-app-region:no-drag]">
          <BackButton aria-label={t('minimal.return_home')} onClick={navigation.returnHome} />
        </div>
      )}
      {!navigation.isHome && <span className="min-w-0 truncate text-sm text-muted-foreground">{activeTab?.title}</span>}
      {navigation.isHome && !sidebarOpen && (
        <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
          <ConversationSidebarToggleButton
            sidebarOpen={false}
            onSidebarToggle={onSidebarToggle}
            tooltipPlacement="bottom"
          />
          {sidebarToolbarActions}
        </div>
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
        sidebarToolbarActions
      }}>
      <AppShell
        minimalToolbar={(detachTab) =>
          navigation.isHome
            ? null
            : renderToolbar(
                false,
                undefined,
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
