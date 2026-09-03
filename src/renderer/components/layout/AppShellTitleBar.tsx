import { Button } from '@cherrystudio/ui'
import type { Tab } from '@renderer/hooks/tab'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'
import { ArrowLeft } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { ShellTabBarActions } from './ShellTabBarActions'
import { TabIcon } from './TabIcon'

const MACOS_TITLE_TRAFFIC_LIGHT_RESERVE = 'max(0px, calc(env(titlebar-area-x, 0px) - var(--sidebar-width, 0px)))'

export function AppShellTitleBar({
  activeTab,
  isFocused,
  isFullscreen,
  onBack
}: {
  activeTab?: Tab
  isFocused: boolean
  isFullscreen: boolean
  onBack: () => void
}) {
  const { t } = useTranslation()
  const isMacTransparentWindow = useMacTransparentWindow()

  return (
    <header
      data-ui="app.title-bar"
      className={cn(
        'flex h-11 w-full shrink-0 select-none items-center [-webkit-app-region:drag]',
        isMacTransparentWindow ? 'bg-transparent' : 'bg-sidebar'
      )}>
      <div
        className="flex min-w-0 flex-1 items-center px-2"
        style={isMac && !isFullscreen ? { paddingLeft: MACOS_TITLE_TRAFFIC_LIGHT_RESERVE } : undefined}>
        {isFocused ? (
          <Button
            type="button"
            variant="ghost"
            aria-label={t('common.back')}
            onClick={onBack}
            className="h-8 gap-1.5 rounded-lg px-2.5 text-muted-foreground text-sm [-webkit-app-region:no-drag] hover:text-foreground">
            <ArrowLeft size={16} strokeWidth={1.7} />
            <span>{t('common.back')}</span>
          </Button>
        ) : (
          <div className="flex min-w-0 items-center gap-2 px-1 text-sidebar-foreground text-sm">
            {activeTab && <TabIcon tab={activeTab} size={15} />}
            <span className="truncate">{activeTab?.title}</span>
          </div>
        )}
      </div>
      <ShellTabBarActions />
    </header>
  )
}
