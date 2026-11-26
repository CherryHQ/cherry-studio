import { Plus } from 'lucide-react'
import { lazy, Suspense, type ReactNode, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Popover, PopoverTrigger, PopoverContent, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { AppUpdateButton } from '@renderer/components/layout/AppUpdateButton'
import { HelpMenu } from '@renderer/components/layout/HelpMenu'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { UserAvatar } from '@renderer/components/Sidebar'
import { UserAccountPanel } from '@renderer/components/UserAccountPanel'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

const FeedbackDialog = lazy(() => import('@renderer/components/feedback/FeedbackDialog'))

export function MinimalSidebarToggle({
  sidebarOpen,
  onSidebarToggle
}: {
  sidebarOpen: boolean
  onSidebarToggle?: () => void
}) {
  const fullscreen = useNativeFullscreen()
  return (
    <div
      className={cn(
        'absolute top-7 left-2 z-20 -translate-y-1/2 [-webkit-app-region:no-drag]',
        isMac && !fullscreen && 'top-5.75 left-[max(80px,env(titlebar-area-x))]'
      )}>
      <ConversationSidebarToggleButton
        className="text-foreground"
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
        tooltipPlacement="bottom"
      />
    </div>
  )
}

export function MinimalSidebarHeader({
  children,
  onAddAgent
}: {
  children: ReactNode
  onAddAgent?: () => void | Promise<void>
}) {
  const { t } = useTranslation()
  const fullscreen = useNativeFullscreen()
  return (
    <div
      className={cn(
        'flex h-14 shrink-0 items-center px-3 [-webkit-app-region:drag]',
        isMac && !fullscreen && 'h-11.5 pl-[max(80px,env(titlebar-area-x))]'
      )}>
      <div className="size-[30px] shrink-0 [-webkit-app-region:no-drag]" />
      <div className="flex-1" />
      <div className="flex shrink-0 items-center gap-0.5 [--muted-foreground:var(--foreground)] [-webkit-app-region:no-drag]">
        {onAddAgent && (
          <Tooltip content={t('agent.add.title')} placement="bottom">
            <NavbarIcon tone="conversation" aria-label={t('agent.add.title')} onClick={() => void onAddAgent()}>
              <Plus />
            </NavbarIcon>
          </Tooltip>
        )}
        {children}
      </div>
    </div>
  )
}

export function MinimalSidebarFooter() {
  const minimalMode = useMinimalMode()
  const [userOpen, setUserOpen] = useState(false)
  const openingNotificationsRef = useRef(false)
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const { t } = useTranslation()
  const avatar = useAvatar()
  const [userName] = usePreference('app.user.name')
  const name = userName || t('chat.user')
  return (
    <>
      {minimalMode?.enabled && (
        <div className="flex shrink-0 items-center gap-0.5 px-3 py-3">
          <Popover open={userOpen} onOpenChange={setUserOpen}>
            <PopoverTrigger asChild data-notification-anchor="left">
              <Button variant="ghost" size="lg" className="min-w-0 flex-1 justify-start gap-2 px-2" aria-label={name}>
                <UserAvatar user={{ name, avatar }} className="size-6 shrink-0" />
                <span className="truncate text-sm">{name}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              aria-label={t('sidebar.account_menu')}
              side="top"
              sideOffset={8}
              align="start"
              className="w-56 p-0"
              onCloseAutoFocus={(event) => {
                if (!openingNotificationsRef.current) return
                openingNotificationsRef.current = false
                event.preventDefault()
              }}>
              <UserAccountPanel
                onRequestClose={() => setUserOpen(false)}
                onNotificationsOpen={() => {
                  openingNotificationsRef.current = true
                }}>
                <HelpMenu
                  onRequestClose={() => setUserOpen(false)}
                  onFeedbackClick={() => {
                    setFeedbackDialogMounted(true)
                    setFeedbackOpen(true)
                  }}
                />
              </UserAccountPanel>
            </PopoverContent>
          </Popover>
          <AppUpdateButton className="size-[30px] rounded-md [&_svg]:size-4" placement="top" />
        </div>
      )}
      {feedbackDialogMounted && (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      )}
    </>
  )
}
