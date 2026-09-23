import { CircleArrowUp, Search, Settings } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { getSidebarLayout } from '@renderer/components/Sidebar'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

import { WindowControls } from '../WindowControls'
import { HelpMenu } from './HelpMenu'

const logger = loggerService.withContext('ShellTabBarActions')
const FeedbackDialog = lazy(() => import('@renderer/components/feedback/FeedbackDialog'))

export function SidebarSettingsButton() {
  const { t } = useTranslation()

  return (
    <Tooltip content={t('settings.title')} placement="right" delay={800}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('settings.title')}
        onClick={() => openSettingsTab()}
        className="flex size-7 items-center justify-center rounded-none bg-transparent text-muted-foreground opacity-55 shadow-none transition-opacity hover:bg-transparent hover:text-foreground hover:opacity-100 focus-visible:bg-transparent focus-visible:text-foreground focus-visible:opacity-100 active:bg-transparent dark:text-muted-foreground dark:hover:text-foreground [&_svg]:text-current">
        <Settings size={18} strokeWidth={1.6} />
      </Button>
    </Tooltip>
  )
}

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

export function ShellTabBarActions() {
  const { t } = useTranslation()
  const [sidebarWidth] = usePersistCache('ui.sidebar.width')
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const sidebarLayout = getSidebarLayout(sidebarWidth)
  const isSidebarHidden = sidebarLayout === 'hidden'

  const handleSearchClick = () => {
    void GlobalSearchPopup.show()
  }

  const handleSettingsClick = () => {
    openSettingsTab()
  }

  const handleOpenFeedback = () => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }

  return (
    <div className="flex h-full shrink-0 items-stretch">
      <div className="flex items-center gap-1 pr-2 [-webkit-app-region:no-drag]">
        {sidebarLayout !== 'full' ? <AppUpdateButton /> : null}
        {isSidebarHidden ? (
          <>
            <HelpMenu layout="icon" placement="bottom" onFeedbackClick={handleOpenFeedback} />
            <CommandTooltip command="app.settings.open" label={t('settings.title')} placement="bottom" delay={800}>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={t('settings.title')}
                onClick={handleSettingsClick}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:text-muted-foreground">
                <Settings size={16} strokeWidth={1.8} />
              </Button>
            </CommandTooltip>
          </>
        ) : null}
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
      {feedbackDialogMounted ? (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
