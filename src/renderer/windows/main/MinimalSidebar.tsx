import { ChevronDown, Settings } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Tooltip,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { HelpMenu } from '@renderer/components/layout/HelpMenu'
import { UserAvatar } from '@renderer/components/Sidebar'
import UserPopup from '@renderer/components/UserPopup'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMinimalMode } from '@renderer/hooks/useMinimalMode'
import { useNativeFullscreen } from '@renderer/hooks/useNativeFullscreen'
import { isMac } from '@renderer/utils/platform'
import { cn } from '@renderer/utils/style'

const FeedbackDialog = lazy(() => import('@renderer/components/feedback/FeedbackDialog'))

export function MinimalHomeSwitcher() {
  const minimalMode = useMinimalMode()
  const { t } = useTranslation()
  if (!minimalMode) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 gap-1 px-2 text-sm font-medium [-webkit-app-region:no-drag]">
          {t(minimalMode.homeKind === 'assistant' ? 'minimal.chat' : 'minimal.work')}
          <ChevronDown className="size-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-64 max-w-[calc(100vw-24px)]">
        <DropdownMenuRadioGroup
          value={minimalMode.homeKind}
          onValueChange={(value) => {
            if (value === 'assistant' || value === 'agent') minimalMode.switchHome(value)
          }}>
          <DropdownMenuRadioItem value="agent" textValue={t('minimal.work')} className="py-2">
            <div className="flex flex-col gap-0.5">
              <span>{t('minimal.work')}</span>
              <span className="text-xs text-muted-foreground">{t('minimal.work_description')}</span>
            </div>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="assistant" textValue={t('minimal.chat')} className="py-2">
            <div className="flex flex-col gap-0.5">
              <span>{t('minimal.chat')}</span>
              <span className="text-xs text-muted-foreground">{t('minimal.chat_description')}</span>
            </div>
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

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
        'absolute top-2 left-2 z-20 [-webkit-app-region:no-drag]',
        isMac && !fullscreen && 'left-[max(80px,env(titlebar-area-x))]'
      )}>
      <ConversationSidebarToggleButton
        sidebarOpen={sidebarOpen}
        onSidebarToggle={onSidebarToggle}
        tooltipPlacement="bottom"
      />
    </div>
  )
}

export function MinimalSidebarHeader() {
  const minimalMode = useMinimalMode()
  const fullscreen = useNativeFullscreen()
  return (
    <>
      {minimalMode?.enabled && (
        <div
          className={cn(
            'flex h-11.5 shrink-0 items-center px-2 [-webkit-app-region:drag]',
            isMac && !fullscreen && 'h-9.5 items-start pt-2 pl-[max(80px,env(titlebar-area-x))]'
          )}>
          <div className="size-[30px] shrink-0 [-webkit-app-region:no-drag]" />
          <div className="flex-1" />
          <div className="flex shrink-0 items-center gap-0.5 [-webkit-app-region:no-drag]">
            {minimalMode.sidebarToolbarActions}
          </div>
        </div>
      )}
      <div className="flex shrink-0 items-center px-2 pt-1">
        <MinimalHomeSwitcher />
      </div>
    </>
  )
}

export function MinimalSidebarFooter() {
  const minimalMode = useMinimalMode()
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const { t } = useTranslation()
  const avatar = useAvatar()
  const [userName] = usePreference('app.user.name')
  const name = userName || t('chat.user')
  return (
    <>
      {minimalMode?.enabled && (
        <div className="flex shrink-0 items-center gap-1 border-t-[0.5px] border-border px-2 py-1">
          <Tooltip content={name}>
            <Button variant="ghost" size="icon" aria-label={name} onClick={() => UserPopup.show()}>
              <UserAvatar user={{ name, avatar }} className="size-6" ring={false} />
            </Button>
          </Tooltip>
          <Button
            variant="ghost"
            className="group flex-1 justify-start"
            onClick={() => minimalMode.openFeature('/settings/labs')}>
            <Settings className="size-4 text-muted-foreground! group-hover:text-foreground!" />
            {t('settings.title')}
          </Button>
          <HelpMenu
            layout="icon"
            onFeedbackClick={() => {
              setFeedbackDialogMounted(true)
              setFeedbackOpen(true)
            }}
          />
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
