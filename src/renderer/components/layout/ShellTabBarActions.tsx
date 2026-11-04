import { CircleArrowUp, Search, Settings, Stethoscope } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { CommandTooltip } from '@renderer/components/command'
import { DoctorPopup } from '@renderer/components/doctor'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { getSidebarLayout } from '@renderer/components/Sidebar'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

import { WindowControls } from '../WindowControls'

const logger = loggerService.withContext('ShellTabBarActions')

export function AppUpdateButton({ placement = 'bottom' }: { placement?: 'top' | 'right' | 'bottom' | 'left' }) {
  const { t } = useTranslation()
  const { appUpdateState } = useAppUpdateState()
  const hasUpdateAction = Boolean(appUpdateState.available && appUpdateState.downloaded && appUpdateState.info)

  if (!hasUpdateAction) return null

  const handleUpdateClick = () => {
    const releaseInfo = appUpdateState.info
    if (!releaseInfo) return

    void import('@renderer/components/UpdateDialogPopup')
      .then(({ default: UpdateDialogPopup }) => UpdateDialogPopup.show({ releaseInfo }))
      .catch((error) => logger.error('Failed to open update dialog', error as Error))
  }

  const updateLabel = appUpdateState.info
    ? t('settings.about.updateAvailable', { version: appUpdateState.info.version })
    : t('button.update_available')

  return (
    <Tooltip content={updateLabel} placement={placement} delay={800}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={updateLabel}
        onClick={handleUpdateClick}
        className="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-accent">
        <CircleArrowUp className="lucide-custom size-[18px] text-success" strokeWidth={1.8} />
      </Button>
    </Tooltip>
  )
}

export function ShellTabBarActions({ showSettings = false }: { showSettings?: boolean }) {
  const { t } = useTranslation()
  const [sidebarWidth] = usePersistCache('ui.sidebar.width')
  const sidebarLayout = getSidebarLayout(sidebarWidth)

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  const handleDiagnosticsClick = () => {
    void DoctorPopup.show({ initialPanel: 'checks' })
  }

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <div className="flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
        {showSettings || sidebarLayout !== 'full' ? <AppUpdateButton /> : null}
        {sidebarLayout === 'hidden' && (
          <Tooltip content={t('settings.doctor.entry.title')} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('settings.doctor.entry.title')}
              onClick={handleDiagnosticsClick}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
              <Stethoscope size={16} strokeWidth={1.8} />
            </Button>
          </Tooltip>
        )}
        {(showSettings || sidebarLayout === 'hidden') && (
          <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="bottom" delay={800}>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t('settings.title')}
              onClick={() => openSettingsTab()}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
              <Settings size={16} strokeWidth={1.8} />
            </Button>
          </CommandTooltip>
        )}
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
      </div>

      <WindowControls />
    </div>
  )
}
