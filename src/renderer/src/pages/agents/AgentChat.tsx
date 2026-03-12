import { QuickPanelProvider } from '@renderer/components/QuickPanel'
import { useRuntime } from '@renderer/hooks/useRuntime'
import { useNavbarPosition, useSettings } from '@renderer/hooks/useSettings'
import { buildAgentSessionTopicId } from '@renderer/utils/agentSession'
import { Alert } from 'antd'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import AgentSessionInputbar from '../home/Inputbar/AgentSessionInputbar'
import { PinnedTodoPanel } from '../home/Inputbar/components/PinnedTodoPanel'
import AgentSessionMessages from '../home/Messages/AgentSessionMessages'
import ChatNavigation from '../home/Messages/ChatNavigation'
import NarrowLayout from '../home/Messages/NarrowLayout'

const AgentChat: FC = () => {
  const { t } = useTranslation()
  const { apiServer, messageNavigation } = useSettings()
  const { isTopNavbar, isLeftNavbar } = useNavbarPosition()
  const { chat } = useRuntime()
  const { activeAgentId, activeSessionIdMap } = chat
  const activeSessionId = activeAgentId ? activeSessionIdMap[activeAgentId] : null

  const mainHeight = isTopNavbar ? 'calc(100vh - var(--navbar-height) - 6px)' : 'calc(100vh - var(--navbar-height))'

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{
        height: isTopNavbar ? 'calc(100vh - var(--navbar-height) - 6px)' : 'calc(100vh - var(--navbar-height))',
        ...(isTopNavbar && {
          backgroundColor: 'var(--color-background)',
          borderTopLeftRadius: 10,
          borderBottomLeftRadius: 10
        })
      }}>
      <div
        className="relative flex flex-1 flex-col justify-between"
        style={{
          height: isLeftNavbar ? 'calc(100vh - var(--navbar-height))' : mainHeight,
          width: '100%',
          transform: 'translateZ(0)'
        }}>
        <QuickPanelProvider>
          <div className="flex flex-1 flex-col justify-between" style={{ height: mainHeight }}>
            {!activeAgentId && (
              <div className="flex h-full w-full items-center justify-center">
                <Alert type="info" message={t('chat.alerts.select_agent')} style={{ margin: '5px 16px' }} />
              </div>
            )}
            {activeAgentId && !activeSessionId && (
              <div className="flex h-full w-full items-center justify-center">
                <Alert type="warning" message={t('chat.alerts.create_session')} style={{ margin: '5px 16px' }} />
              </div>
            )}
            {activeAgentId && activeSessionId && (
              <>
                {!apiServer.enabled ? (
                  <Alert type="warning" message={t('agent.warning.enable_server')} style={{ margin: '5px 16px' }} />
                ) : (
                  <>
                    <AgentSessionMessages agentId={activeAgentId} sessionId={activeSessionId} />
                    <div className="mt-auto px-4.5 pb-2">
                      <NarrowLayout>
                        <PinnedTodoPanel topicId={buildAgentSessionTopicId(activeSessionId)} />
                      </NarrowLayout>
                    </div>
                  </>
                )}
                {messageNavigation === 'buttons' && <ChatNavigation containerId="messages" />}
                <AgentSessionInputbar agentId={activeAgentId} sessionId={activeSessionId} />
              </>
            )}
          </div>
        </QuickPanelProvider>
      </div>
    </div>
  )
}

export default AgentChat
