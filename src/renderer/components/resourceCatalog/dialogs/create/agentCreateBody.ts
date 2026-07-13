import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { CreateAgentDto } from '@shared/data/api/schemas/agents'

import type { ResourceCreateWizardValues } from './types'

/**
 * Build the `POST /agents` body from wizard values, applying runtime-specific
 * defaults. Claude agents ship plan/small-model tiers and run full-auto by
 * default; pi agents skip the tiers and start in the gated `default`
 * permission mode since pi tool calls run at host privilege with no sandbox.
 */
export function buildAgentCreateBody(values: ResourceCreateWizardValues): CreateAgentDto {
  const caps = AGENT_RUNTIME_CAPABILITIES[values.agentType]
  if (caps.requiresModel && !values.modelId) throw new Error('A model is required for this runtime')

  return {
    type: values.agentType,
    name: values.name,
    model: values.modelId,
    description: values.description,
    instructions: caps.prompt ? values.prompt : '',
    ...(caps.skills ? { skillIds: values.skillIds } : {}),
    ...(caps.modelTiers && values.modelId ? { planModel: values.modelId, smallModel: values.modelId } : {}),
    configuration: {
      avatar: values.avatar,
      ...(caps.permissions ? { permission_mode: caps.createDefaults.permissionMode } : {}),
      ...(caps.remoteAgentSelection ? { stella_remote_agent_id: values.stellaRemoteAgentId ?? '' } : {})
    }
  }
}
