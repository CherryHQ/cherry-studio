import HorizontalScrollContainer from '@renderer/components/HorizontalScrollContainer'
import { useActiveSession } from '@renderer/hooks/agents/useActiveSession'
import { useUpdateSession } from '@renderer/hooks/agents/useUpdateSession'
import { AgentSettingsPopup, SessionSettingsPopup } from '@renderer/pages/settings/AgentSettings'
import { AgentLabel, SessionLabel } from '@renderer/pages/settings/AgentSettings/shared'
import type { AgentEntity, ApiModel } from '@renderer/types'
import { ChevronRight } from 'lucide-react'
import { useCallback } from 'react'

import SelectAgentBaseModelButton from '../../SelectAgentBaseModelButton'
import Tools from '../Tools'
import OpenExternalAppButton from './OpenExternalAppButton'
import SessionWorkspaceMeta from './SessionWorkspaceMeta'

type AgentContentProps = {
  activeAgent: AgentEntity
}

const AgentContent = ({ activeAgent }: AgentContentProps) => {
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
    <>
      <div className="min-w-0 shrink overflow-x-auto pr-2">
        <HorizontalScrollContainer className="ml-2 min-w-0 flex-initial">
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
    </>
  )
}

export default AgentContent
