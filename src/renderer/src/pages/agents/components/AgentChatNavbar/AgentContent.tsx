import { Button, Tooltip } from '@cherrystudio/ui'
import { usePreference } from '@data/hooks/usePreference'
import ModelAvatar from '@renderer/components/Avatar/ModelAvatar'
import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { ModelSelector } from '@renderer/components/ModelSelector'
import NavbarIcon from '@renderer/components/NavbarIcon'
import { AgentSelector } from '@renderer/components/ResourceSelector'
import { fromSharedModel } from '@renderer/config/models/_bridge'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateAgent } from '@renderer/hooks/agents/useAgentDataApi'
import { useAgentModelFilter } from '@renderer/hooks/agents/useAgentModelFilter'
import { useUpdateSession } from '@renderer/hooks/agents/useSessionDataApi'
import { useModelById } from '@renderer/hooks/useModels'
import { useNavbarPosition } from '@renderer/hooks/useNavbar'
import { useProviderDisplayName } from '@renderer/hooks/useProviders'
import { AgentLabel } from '@renderer/pages/agents/AgentSettings/shared'
import type { AgentEntity } from '@shared/data/types/agent'
import type { Model as SharedModel, UniqueModelId } from '@shared/data/types/model'
import { Menu, PanelLeftClose, PanelRightClose } from 'lucide-react'
import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import AgentSidePanelDrawer from '../AgentSidePanelDrawer'
import OpenExternalAppButton from './OpenExternalAppButton'
import SessionWorkspaceMeta from './SessionWorkspaceMeta'
import Tools from './Tools'

type AgentContentProps = {
  activeAgent: AgentEntity
}

const AgentContent = ({ activeAgent }: AgentContentProps) => {
  const { t } = useTranslation()
  const [showSidebar, setShowSidebar] = usePreference('topic.tab.show')
  const toggleShowSidebar = () => void setShowSidebar(!showSidebar)
  const { isTopNavbar } = useNavbarPosition()
  const { session: activeSession } = useActiveSession()
  const { updateModel } = useUpdateAgent()
  const { updateSession } = useUpdateSession(activeAgent.id)
  const modelFilter = useAgentModelFilter(activeAgent.type)

  const { model: currentSharedModel } = useModelById((activeAgent.model ?? '') as UniqueModelId)
  const currentRendererModel = useMemo(
    () => (currentSharedModel ? fromSharedModel(currentSharedModel) : undefined),
    [currentSharedModel]
  )
  const providerName = useProviderDisplayName(currentSharedModel?.providerId)

  const handleAgentChange = useCallback(
    async (nextAgentId: string | null) => {
      if (!nextAgentId || !activeSession || nextAgentId === activeAgent.id) return
      await updateSession({ id: activeSession.id, agentId: nextAgentId }, { showSuccessToast: false })
    },
    [activeAgent.id, activeSession, updateSession]
  )

  const handleModelSelect = useCallback(
    (model: SharedModel | undefined) => {
      if (!model) return
      void updateModel(activeAgent.id, model.id, { showSuccessToast: false })
    },
    [activeAgent.id, updateModel]
  )

  return (
    <div className="flex w-full justify-between pr-2">
      <div className="flex min-w-0 shrink items-center">
        {isTopNavbar && showSidebar && (
          <Tooltip title={t('navbar.hide_sidebar')} delay={800}>
            <NavbarIcon onClick={toggleShowSidebar}>
              <PanelLeftClose size={18} />
            </NavbarIcon>
          </Tooltip>
        )}
        {isTopNavbar && !showSidebar && (
          <Tooltip title={t('navbar.show_sidebar')} delay={800} placement="right">
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
            <AgentSelector
              value={activeAgent.id}
              onChange={handleAgentChange}
              trigger={
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full px-2 text-xs">
                  <AgentLabel
                    agent={activeAgent}
                    classNames={{ name: 'max-w-40 text-xs', avatar: 'h-4.5 w-4.5', container: 'gap-1.5' }}
                  />
                  <ChevronDown size={14} className="text-muted-foreground" />
                </Button>
              }
            />

            {activeSession && (
              <>
                <ModelSelector
                  multiple={false}
                  value={currentSharedModel}
                  onSelect={handleModelSelect}
                  filter={modelFilter}
                  trigger={
                    <Button variant="ghost" size="sm" className="h-7 gap-1.5 rounded-full px-2 text-xs">
                      <ModelAvatar model={currentRendererModel} size={20} />
                      <span className="max-w-60 truncate">
                        {currentRendererModel ? currentRendererModel.name : t('button.select_model')}
                        {providerName ? ` | ${providerName}` : ''}
                      </span>
                      <ChevronDown size={14} className="text-muted-foreground" />
                    </Button>
                  }
                />

                <SessionWorkspaceMeta session={activeSession} />
              </>
            )}
          </div>
        </HorizontalScrollContainer>
      </div>
      <div className="flex items-center">
        {activeSession && activeSession.accessiblePaths?.[0] && (
          <OpenExternalAppButton workdir={activeSession.accessiblePaths[0]} className="mr-2" />
        )}
        <Tools />
      </div>
    </div>
  )
}

export default AgentContent
