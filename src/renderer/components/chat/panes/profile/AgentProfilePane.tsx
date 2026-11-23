import { useTranslation } from 'react-i18next'

import { AgentChannels } from '@renderer/components/channel/AgentChannels'
import { AgentAvatarPicker } from '@renderer/components/resourceCatalog/dialogs/components/AgentAvatarPicker'
import { useAgent } from '@renderer/hooks/agent/useAgent'
import { getAgentAvatar } from '@renderer/utils/agent'
import { normalizePermissionMode } from '@shared/ai/agentPermissionMode'
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
  model,
  onModelChange
}: {
  agentId: string
  sessionId?: string
  workspace?: AgentProfileWorkspace
  /** Opens a reported file in the Files pane; absent when that pane cannot show it. */
  onOpenOutput?: (path: string) => void
  /** The conversation's model; defaults to the Agent's own. */
  model?: Model
  /** Switches the conversation's model, asking first when it already has messages. */
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
            <AgentProfileSettings agent={agent} sessionId={sessionId} model={model} onModelChange={onModelChange} />
          </>
        }
        outputs={<AgentOutputs agentId={agent.id} onOpen={onOpenOutput} />}
        channels={
          <AgentChannels
            key={agent.id}
            agentId={agent.id}
            agentType={agent.type}
            permissionMode={normalizePermissionMode(agent.configuration?.permission_mode)}
            portalContainer={null}
            presentation="profile"
          />
        }
      />
    </ProfilePaneFrame>
  )
}
