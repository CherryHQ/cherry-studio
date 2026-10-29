import { CircleArrowUp, Search } from 'lucide-react'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { loggerService } from '@logger'
import { CommandTooltip } from '@renderer/components/command'
import GlobalSearchPopup from '@renderer/components/GlobalSearch/GlobalSearchPopup'
import { getSidebarLayout, UserAvatar } from '@renderer/components/Sidebar'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import useAvatar from '@renderer/hooks/useAvatar'

import { UserAccountPanel } from '../UserAccountPanel'
import { WindowControls } from '../WindowControls'
import { HelpMenu } from './HelpMenu'

const logger = loggerService.withContext('ShellTabBarActions')
const FeedbackDialog = lazy(() => import('@renderer/components/feedback/FeedbackDialog'))

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

function TabBarUserMenu({ onFeedbackClick }: { onFeedbackClick: () => void }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const avatar = useAvatar()
  const [open, setOpen] = useState(false)
  const openedByPointerRef = useRef(false)
  const closeMenu = () => setOpen(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={userName || t('chat.user')} placement="bottom" delay={800} isDisabled={open}>
        <PopoverTrigger
          asChild
          onPointerDown={() => (openedByPointerRef.current = true)}
          onKeyDown={() => (openedByPointerRef.current = false)}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('sidebar.account_menu')}
            className="ml-0.5 flex size-8 items-center justify-center rounded-md data-[state=open]:bg-accent">
            <UserAvatar user={{ name: userName || t('chat.user'), avatar }} className="size-5.5" />
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        aria-label={t('sidebar.account_menu')}
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-56 rounded-md p-0"
        onOpenAutoFocus={(event) => {
          if (openedByPointerRef.current) event.preventDefault()
        }}>
        <UserAccountPanel onRequestClose={closeMenu}>
          <HelpMenu onFeedbackClick={onFeedbackClick} onRequestClose={closeMenu} />
        </UserAccountPanel>
      </PopoverContent>
    </Popover>
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

  const handleOpenFeedback = () => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
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
        {isSidebarHidden ? <TabBarUserMenu onFeedbackClick={handleOpenFeedback} /> : null}
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
