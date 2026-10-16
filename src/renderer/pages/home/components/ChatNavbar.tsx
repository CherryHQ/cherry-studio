import { EyeOff } from 'lucide-react'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@cherrystudio/ui'
import { dataApiService } from '@data/DataApiService'
import { usePreference } from '@data/hooks/usePreference'
import { ConversationSidebarToggleButton } from '@renderer/components/chat/shell/ConversationSidebarToggleButton'
import { ConversationTopBarPortalHost } from '@renderer/components/chat/shell/ConversationTopBarPortal'
import { CommandTooltip } from '@renderer/components/command'
import { NavbarHeader } from '@renderer/components/Navbar'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'

interface HeaderNavbarProps {
  conversationControls?: ReactNode
  showSidebarControls?: boolean
  sidebarOpen?: boolean
  onSidebarToggle?: () => void
  temporaryTopic?: { id: string; expiresAt?: string }
}

const HeaderNavbar: FC<HeaderNavbarProps> = ({
  conversationControls,
  showSidebarControls = true,
  sidebarOpen,
  onSidebarToggle,
  temporaryTopic
}) => {
  const [preferredShowSidebar] = usePreference('topic.tab.show')
  const { t } = useTranslation()
  const showSidebar = sidebarOpen ?? preferredShowSidebar

  return (
    <NavbarHeader className="home-navbar relative" style={{ height: 'var(--navbar-height)' }}>
      <div className="-mx-1 flex h-full min-w-0 flex-1 items-center justify-between overflow-hidden">
        <div data-navbar-left-occupant className="flex min-w-0 flex-1 items-center overflow-hidden">
          {showSidebarControls && (
            <ConversationSidebarToggleButton
              sidebarOpen={showSidebar}
              onSidebarToggle={onSidebarToggle}
              tooltipPlacement="bottom"
            />
          )}
          <ConversationTopBarPortalHost>{conversationControls}</ConversationTopBarPortalHost>
        </div>
        {temporaryTopic?.expiresAt && (
          <div
            data-ui="chat.temporary-status"
            className="flex items-center gap-2 px-2 text-xs text-muted-foreground [-webkit-app-region:no-drag]">
            <span title={new Date(temporaryTopic.expiresAt).toLocaleString()}>
              {t('quickAssistant.chat.expires_in_24h')}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void dataApiService
                  .post(`/topics/${temporaryTopic.id}/persist`, {})
                  .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
              }}>
              {t('common.save')}
            </Button>
          </div>
        )}
        <CommandTooltip command="chat.temporary.open" label={t('quickAssistant.chat.new_temporary')} placement="bottom">
          <Button
            variant="ghost"
            size="icon-navbar"
            aria-label={t('quickAssistant.chat.new_temporary')}
            onClick={() => {
              void ipcApi
                .request('quick_assistant.chat.open', { prompt: '', temporary: true, submit: false })
                .catch((error) => toast.error(error instanceof Error ? error.message : String(error)))
            }}>
            <EyeOff />
          </Button>
        </CommandTooltip>
      </div>
    </NavbarHeader>
  )
}

export default HeaderNavbar
