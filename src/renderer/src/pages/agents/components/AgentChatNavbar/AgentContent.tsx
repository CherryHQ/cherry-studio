import { usePreference } from '@data/hooks/usePreference'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateAgent } from '@renderer/hooks/agents/useAgentDataApi'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { AgentSettingsPopup } from '@renderer/pages/agents/AgentSettings'
import { AgentLabel, SessionLabel } from '@renderer/pages/agents/AgentSettings/shared'
import type { ApiModel } from '@renderer/types'
import type { AgentEntity } from '@shared/data/types/agent'
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
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { isTopNavbar } = useNavbarPosition()
  const { session: activeSession } = useActiveSession()
  const { updateModel } = useUpdateAgent()

  const handleUpdateModel = useCallback(
    async (model: ApiModel) => {
      if (!activeAgent) return
      return updateModel(activeAgent.id, model.id, { showSuccessToast: false })
    },
    [activeAgent, updateModel]
  )

  return (
    <div className="flex w-full justify-between pr-2">
      <div className="flex min-w-0 shrink items-center">
        {isTopNavbar && showSidebar && (
          <Tooltip title={t('navbar.hide_sidebar')} mouseEnterDelay={0.8}>
            <NavbarIcon onClick={toggleShowSidebar}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showSidebar && (
          <Tooltip title={t('navbar.show_sidebar')} mouseEnterDelay={0.8} placement="right">
            <NavbarIcon onClick={toggleShowSidebar} style={{ marginRight: 8 }}>
              <PanelRightClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        <AnimatePresence initial={false}>
          {!showSidebar && isTopNavbar && (
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
                  onClick={() => AgentSettingsPopup.show({ agentId: activeAgent.id })}>
                  <SessionLabel session={activeSession} className="max-w-40 text-xs" />
                </div>

                {/* Separator */}
                <ChevronRight className="h-4 w-4 text-gray-400" />

                {/* Model Button */}
                <SelectAgentBaseModelButton
                  agentBase={activeAgent}
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
        {activeSession && activeAgent.accessiblePaths?.[0] && (
          <OpenExternalAppButton workdir={activeAgent.accessiblePaths[0]} className="mr-2" />
        )}
        <Tools />
      </div>
    </div>
  )
}

export default AgentContent
