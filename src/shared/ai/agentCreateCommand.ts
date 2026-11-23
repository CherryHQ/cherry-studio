import { type AgentCreateSettings, buildAgentSettingsConfiguration } from '@shared/ai/agentForm'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentChannelDraft } from '@shared/data/api/schemas/agentChannels'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import type { AgentCreateAnalytics } from '@shared/ipc/schemas/analytics'
import { ANALYTICS_PRESET_ID_PATTERN } from '@shared/utils/analyticsModelSource'

/** The avatar a new Agent starts with when none (or no valid emoji) was chosen. */
export const DEFAULT_AGENT_CREATE_AVATAR = '✨'

/** The values every Agent create entry point (wizard, auto create, conversation tools) collects. */
export type AgentCreateValues = {
  /** A prepared avatar image, bound to the Agent in its create transaction. */
  avatarImage?: Uint8Array<ArrayBuffer>
  agentType: AgentType
  permissionMode: AgentPermissionMode
  avatar: string
  name: string
  modelId: UniqueModelId
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  skillIds: string[]
  mcpServerIds?: string[]
  /** Opt-out list of built-in tools (empty = all enabled). */
  disabledTools?: string[]
  agentSettings?: AgentCreateSettings
  /** Channels created with the Agent. */
  channels?: AgentChannelDraft[]
}

/** Map the shared create values to the Agent create command; `analytics` names the creating UI. */
export function buildCreateAgentCommand(
  values: AgentCreateValues,
  analytics?: { entry: AgentCreateAnalytics['entry']; templateId?: string }
): CreateAgentCommand {
  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]
  const permissionMode = caps.permissionModes.some((mode) => mode === values.permissionMode)
    ? values.permissionMode
    : caps.createDefaults.permissionMode
  return {
    type: values.agentType,
    ...(values.avatarImage ? { avatarImage: values.avatarImage } : {}),
    name: values.name,
    model: values.modelId,
    ...(caps.modelTiers ? { planModel: values.modelId, smallModel: values.modelId } : {}),
    description: values.description,
    instructions: values.prompt,
    ...(caps.knowledgeBases ? { knowledgeBaseIds: values.knowledgeBaseIds } : {}),
    ...(caps.skills ? { skillIds: values.skillIds } : {}),
    ...(caps.mcp && values.mcpServerIds?.length ? { mcps: values.mcpServerIds } : {}),
    ...(values.disabledTools?.length ? { disabledTools: values.disabledTools } : {}),
    ...(values.channels?.length ? { channels: values.channels } : {}),
    configuration: {
      ...(values.agentSettings ? buildAgentSettingsConfiguration(values.agentSettings) : {}),
      avatar: values.avatar,
      permission_mode: permissionMode
    },
    ...(analytics && {
      analytics: {
        entry: analytics.entry,
        // Only static template ids; anything else would fail the create command's schema.
        ...(analytics.templateId &&
          ANALYTICS_PRESET_ID_PATTERN.test(analytics.templateId) && { target: analytics.templateId })
      }
    })
  }
}
