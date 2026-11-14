import { useTranslation } from 'react-i18next'

import { AgentAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/AgentAvatarPicker'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { getAgentAvatar } from '@renderer/utils/agent'
import type { Model } from '@shared/data/types/model'

import { AgentProfileActivity, type AgentProfileWorkspace } from './AgentProfileActivity'
import { AgentOutputs } from './ProfileOutputs'
import { ProfilePaneFrame } from './ProfilePaneFrame'
import { ProfilePaneHeader, ProfilePaneTabs } from './ProfilePaneParts'
import { AgentProfileSettings } from './ProfilePaneSettings'

/** Profile of the conversation's Agent: who it is, its activity, and a few settings. */
export function AgentProfilePane({
  agentId,
  sessionId,
  workspace,
  onOpenOutput,
  onModelChange
}: {
  agentId: string
  sessionId?: string
  workspace?: AgentProfileWorkspace
  /** Opens a reported file in the Files pane; absent when that pane cannot show it. */
  onOpenOutput?: (path: string) => void
  /** Switches the Agent's model, asking first when the conversation already has messages. */
  onModelChange?: (model: Model) => void
}) {
  const { t } = useTranslation()
  const { agent } = useAgent(agentId)

  if (!agent) return <ProfilePaneFrame />

  return (
    <ProfilePaneFrame>
      <ProfilePaneHeader
        avatar={
          <AgentAvatarPicker
            agentId={agent.id}
            emoji={getAgentAvatar(agent.configuration?.avatar)}
            avatarSrc={agent.avatarSrc}
            ariaLabel={t('library.config.dialogs.create.avatar_aria')}
            portalContainer={null}
            size="lg"
          />
        }
        name={agent.name}
        description={agent.description}
      />
      <ProfilePaneTabs
        activity={
          <>
            <AgentProfileActivity agent={agent} sessionId={sessionId} workspace={workspace} />
            <AgentProfileSettings agent={agent} onModelChange={onModelChange} />
          </>
        }
        outputs={<AgentOutputs agentId={agent.id} onOpen={onOpenOutput} />}
      />
    </ProfilePaneFrame>
  )
}
