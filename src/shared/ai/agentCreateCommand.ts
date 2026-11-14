import { type AgentCreateSettings, buildAgentSettingsConfiguration } from '@shared/ai/agentForm'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentChannelDraft } from '@shared/data/api/schemas/agentChannels'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentType } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

/** The avatar a new Agent starts with when none (or no valid emoji) was chosen. */
export const DEFAULT_AGENT_CREATE_AVATAR = '✨'

/** The values every Agent create entry point (wizard, auto create, conversation tools) collects. */
export type AgentCreateValues = {
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

/** Map the shared create values to the Agent create command. */
export function buildCreateAgentCommand(values: AgentCreateValues): CreateAgentCommand {
  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]
  const permissionMode = caps.permissionModes.some((mode) => mode === values.permissionMode)
    ? values.permissionMode
    : caps.createDefaults.permissionMode
  return {
    type: values.agentType,
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
    }
  }
}
