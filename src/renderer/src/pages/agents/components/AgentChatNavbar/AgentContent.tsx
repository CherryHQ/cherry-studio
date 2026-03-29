import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useShowAssistants } from '@renderer/hooks/useStore'
import { AgentSettingsPopup, SessionSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import { AgentLabel, SessionLabel } from '@renderer/pages/settings/AgentSettings/shared'
import type { AgentEntity, ApiModel } from '@renderer/types'
import { Tooltip } from 'antd'
import { t } from 'i18next'
import { ChevronRight } from 'lucide-react'
import { Menu, PanelLeftClose, PanelRightClose } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback } from 'react'

import AgentSidePanelDrawer from '../AgentSidePanelDrawer'
import SelectAgentBaseModelButton from '../SelectAgentBaseModelButton'
import OpenExternalAppButton from './OpenExternalAppButton'
import SessionWorkspaceMeta from './SessionWorkspaceMeta'
import Tools from './Tools'

type AgentContentProps = {
  activeAgent: AgentEntity
}

const AgentContent = ({ activeAgent }: AgentContentProps) => {
  const { showAssistants, toggleShowAssistants } = useShowAssistants()
  const { isTopNavbar } = useNavbarPosition()
  const { session: activeSession } = useActiveSession()
  const { updateModel } = useUpdateSession(activeAgent?.id ?? null)

  const handleUpdateModel = useCallback(
    async (model: ApiModel) => {
      if (!activeAgent || !activeSession) return
      return updateModel(activeSession.id, model.id, { showSuccessToast: false })
    },
    [activeAgent, activeSession, updateModel]
  )

  return (
    <div className="flex w-full justify-between pr-2">
      <div className="flex min-w-0 shrink items-center">
        {isTopNavbar && showAssistants && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={toggleShowAssistants}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showAssistants && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8} placement="right">
            <NavbarIcon onClick={() => toggleShowAssistants()} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <AnimatePresence initial={false}>
          {!showAssistants && isTopNavbar && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeInOut' }}>
              <NavbarIcon onClick={() => AgentSidePanelDrawer.show()} style={{ marginRight: 5 }}>
                <Menu size={18} />
              </NavbarIcon>
            </motion.div>
          )}
        </AnimatePresence>
        <HorizontalScrollContainer className="ml-2 min-w-0 flex-initial shrink">
          <div className="flex flex-nowrap items-center gap-2">
            {/* Agent Label */}
            <div
              className="flex h-full cursor-pointer items-center"
              onClick={() => AgentSettingsPopup.show({ agentId: activeAgent.id })}>
              <AgentLabel
                agent={activeAgent}
                classNames={{ name: 'max-w-40 text-xs', avatar: 'h-4.5 w-4.5', container: 'gap-1.5' }}
              />
            </div>

            {activeSession && (
              <>
                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Session Label */}
                <div
                  className="flex h-full cursor-pointer items-center"
                  onClick={() =>
                    SessionSettingsPopup.show({
                      agentId: activeAgent.id,
                      sessionId: activeSession.id
                    })
                  }>
                  <SessionLabel session={activeSession} className="max-w-40 text-xs" />
                </div>

                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Model Button */}
                <SelectAgentBaseModelButton
                  agentBase={activeSession}
                  onSelect={async (model) => {
                    await handleUpdateModel(model)
                  }}
                />

                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Workspace Meta */}
                <SessionWorkspaceMeta agent={activeAgent} session={activeSession} />
              </>
            )}
          </div>
        </HorizontalScrollContainer>
      </div>
      <div className="flex items-center">
        {/* Open External Apps */}
        {activeSession && activeSession.accessible_paths?.[0] && (
          <OpenExternalAppButton workdir={activeSession.accessible_paths[0]} className="mr-2" />
        )}
        <Tools />
      </div>
    </div>
  )
}

export default AgentContent
