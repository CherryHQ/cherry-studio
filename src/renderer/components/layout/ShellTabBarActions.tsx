import { Search, Settings } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { getSidebarLayout } from '@renderer/components/Sidebar'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

import { WindowControls } from '../WindowControls'
import { AppUpdateButton } from './AppUpdateButton'

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const [sidebarWidth] = usePersistCache('ui.sidebar.width')
  const sidebarLayout = getSidebarLayout(sidebarWidth)

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <div className="flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
        {sidebarLayout !== 'full' ? <AppUpdateButton /> : null}
        <CommandTooltip command="app.search" label={t('globalSearch.open')} placement="bottom" delay={800}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('globalSearch.open')}
            onClick={handleSearchClick}
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
            <Search size={16} strokeWidth={1.8} />
          </Button>
        </CommandTooltip>
        {sidebarLayout === 'hidden' && (
          <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('settings.title')}
              onClick={() => openSettingsTab()}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground dark:text-muted-foreground">
              <Settings size={16} strokeWidth={1.8} />
            </Button>
          </CommandTooltip>
        )}
      </div>

      <WindowControls />
    </div>
  )
}
