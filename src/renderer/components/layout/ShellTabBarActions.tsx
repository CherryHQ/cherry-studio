import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import type { SidebarVisibleLayout } from '@renderer/components/Sidebar'
import { ipcApi } from '@renderer/ipc'
import { PictureInPicture2, Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useHasWindowControls, WindowControls } from '../WindowControls'

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const [quickAssistantEnabled] = usePreference('feature.quick_assistant.enabled')
  const [showQuickAssistantInTabBar] = usePreference('feature.quick_assistant.show_in_tab_bar')
  const hasWindowControls = useHasWindowControls()

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  const handleQuickAssistantClick = () => {
    void ipcApi.request('quick_assistant.show')
  }

  return (
    <div data-testid="shell-tab-bar-actions" className="flex h-full shrink-0 items-stretch">
      <div data-testid="shell-tab-bar-drag-gap" className="w-4 shrink-0 [-webkit-app-region:drag]" />
      <div className="mr-2 flex items-center [-webkit-app-region:no-drag]">
        <div className="flex items-center gap-1 rounded-[10px] px-1 py-1">
          {quickAssistantEnabled && showQuickAssistantInTabBar ? (
            <Tooltip placement="bottom" content={t('quickAssistant.tooltip.open')} delay={800}>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t('quickAssistant.tooltip.open')}
                onClick={handleQuickAssistantClick}
                className="h-8 w-8 rounded-[8px] text-foreground/80">
                <PictureInPicture2 size={16} strokeWidth={1.8} />
              </Button>
            </Tooltip>
          ) : null}
          <CommandTooltip command="app.search" label={t('globalSearch.open')} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('globalSearch.open')}
              onClick={handleSearchClick}
              className="mr-1 flex h-8 w-8 items-center justify-center rounded-[8px] text-foreground/80 transition-colors hover:bg-[rgba(107,114,128,0.12)] hover:text-foreground">
              <Search size={16} strokeWidth={1.8} />
            </Button>
          </CommandTooltip>
        </div>
      </div>

      {hasWindowControls && <WindowControls />}
    </div>
  )
}

export function SidebarShellActions({
  layout,
  onSettingsClick
}: {
  layout: SidebarVisibleLayout
  onSettingsClick: () => void
}) {
  const { t } = useTranslation()

  if (layout === 'icon') {
    return (
      <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="right" delay={800}>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('settings.title')}
          onClick={onSettingsClick}
          className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground">
          <Settings size={18} strokeWidth={1.6} />
        </Button>
      </CommandTooltip>
    )
  }

  return (
    <Button
      type="button"
      variant="ghost"
      aria-label={t('settings.title')}
      onClick={onSettingsClick}
      className="flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-foreground transition-colors hover:bg-accent/60 dark:text-foreground">
      <Settings size={16} strokeWidth={1.6} />
      <span>{t('settings.title')}</span>
    </Button>
  )
}
