import type { PermissionModeCard } from '@renderer/types/agent'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentConfiguration, AgentType } from '@shared/data/types/agent'
import type { ModelSnapshot } from '@shared/data/types/message'
import { isUniqueModelId, parseUniqueModelId } from '@shared/data/types/model'
import type { TFunction } from 'i18next'

export const DEFAULT_AGENT_AVATAR = '🤖'

export function getAgentAvatar(avatar?: unknown) {
  return typeof avatar === 'string' ? avatar.trim() || DEFAULT_AGENT_AVATAR : DEFAULT_AGENT_AVATAR
}

export function getAgentAvatarFromConfiguration(configuration?: Pick<AgentConfiguration, 'avatar'> | null) {
  return getAgentAvatar(configuration?.avatar)
}

export function getAgentDescriptionForDisplay(
  agent: { description?: string | null; configuration?: AgentConfiguration | null },
  t: TFunction
): string {
  if (agent.description) return agent.description
  // Builtin contract: an empty DB description means the bundle/UI owns the localized
  // default. A non-empty user edit is user-owned and is never overwritten.
  if (agent.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT) {
    return t('agent.builtin.cherry_assistant.description')
  }
  if (agent.configuration?.builtin_role === BUILTIN_AGENT_ROLE.SUPPORT) {
    return t('agent.builtin.cherry_support.description')
  }
  return ''
}

export function getAgentModelFallbackSnapshot(agent?: {
  model?: string | null
  modelName?: string | null
}): ModelSnapshot | undefined {
  const modelString = agent?.model
  if (!isUniqueModelId(modelString)) return undefined

  const { providerId, modelId } = parseUniqueModelId(modelString)
  if (!providerId || !modelId) return undefined

  return { id: modelId, name: agent?.modelName ?? modelId, provider: providerId }
}

export const permissionModeCards: PermissionModeCard[] = [
  {
    mode: 'default',
    // t('agent.settings.tooling.permissionMode.default.title')
    titleKey: 'agent.settings.tooling.permissionMode.default.title',
    titleFallback: 'Ask Before Acting',
    descriptionKey: 'agent.settings.tooling.permissionMode.default.description',
    descriptionFallback: 'Asks before editing files or running commands.'
  },
  {
    mode: 'plan',
    // t('agent.settings.tooling.permissionMode.plan.title')
    titleKey: 'agent.settings.tooling.permissionMode.plan.title',
    titleFallback: 'Plan Only',
    descriptionKey: 'agent.settings.tooling.permissionMode.plan.description',
    descriptionFallback: 'Plans without editing files. Only read-only or vetted commands run.'
  },
  {
    mode: 'acceptEdits',
    // t('agent.settings.tooling.permissionMode.acceptEdits.title')
    titleKey: 'agent.settings.tooling.permissionMode.acceptEdits.title',
    titleFallback: 'Auto-accept Edits',
    descriptionKey: 'agent.settings.tooling.permissionMode.acceptEdits.description',
    descriptionFallback: 'Edits files freely. Asks before commands.'
  },
  {
    mode: 'auto',
    // t('agent.settings.tooling.permissionMode.auto.title')
    titleKey: 'agent.settings.tooling.permissionMode.auto.title',
    titleFallback: 'Approve for Me',
    descriptionKey: 'agent.settings.tooling.permissionMode.auto.description',
    descriptionFallback: 'Runs without routine prompts. A safety check blocks risky actions.',
    // The safety check is a model-side classifier, so the mode is only as good as the
    // model behind it — hence the caveat rather than making this the creation default.
    // t('agent.settings.tooling.permissionMode.auto.warning')
    warningKey: 'agent.settings.tooling.permissionMode.auto.warning',
    warningFallback: 'Needs a model that supports it; others may ignore it or keep asking.'
  },
  {
    mode: 'bypassPermissions',
    // t('agent.settings.tooling.permissionMode.bypassPermissions.title')
    titleKey: 'agent.settings.tooling.permissionMode.bypassPermissions.title',
    titleFallback: 'Full Access',
    descriptionKey: 'agent.settings.tooling.permissionMode.bypassPermissions.description',
    descriptionFallback: 'Skips permission checks. Can delete files and use the network.',
    // t('agent.settings.tooling.permissionMode.bypassPermissions.warning')
    warningKey: 'agent.settings.tooling.permissionMode.bypassPermissions.warning',
    warningFallback: 'Use with caution — most tools run without approval; explicit safety blocks still apply.',
    dangerous: true
  }
]

/**
 * Two modes mean something different on pi, so their copy has to differ too: `auto` is Cherry's own
 * deterministic gate rather than Claude's model-side classifier (no "depends on the model" caveat),
 * and `bypassPermissions` really does bypass everything but disabled tools.
 */
const PI_CARD_OVERRIDES: Partial<Record<AgentPermissionMode, Partial<PermissionModeCard>>> = {
  auto: {
    // t('agent.settings.tooling.permissionMode.auto.description_pi')
    descriptionKey: 'agent.settings.tooling.permissionMode.auto.description_pi',
    descriptionFallback: 'Works on its own. Asks when it recognizes a risky action.',
    // File tools are held to the workspace, but a shell command is only pattern-matched — the copy
    // must not imply the agent is contained.
    // t('agent.settings.tooling.permissionMode.auto.warning_pi')
    warningKey: 'agent.settings.tooling.permissionMode.auto.warning_pi',
    warningFallback: 'Recognition is best-effort; an unusual command can still slip through.'
  },
  bypassPermissions: {
    // t('agent.settings.tooling.permissionMode.bypassPermissions.warning_pi')
    warningKey: 'agent.settings.tooling.permissionMode.bypassPermissions.warning_pi',
    warningFallback:
      'Dangerous — nothing is ever asked except for disabled tools, including file deletion and network access.'
  }
}

/** Permission-mode cards offered for an agent type. Unknown types keep the full set. */
export function getPermissionModeCards(agentType: AgentType | string | undefined): PermissionModeCard[] {
  if (!agentType || !(agentType in AGENT_RUNTIME_CAPABILITIES)) return permissionModeCards
  const modes = new Set<AgentPermissionMode>(AGENT_RUNTIME_CAPABILITIES[agentType as AgentType].permissionModes)
  return permissionModeCards
    .filter((card) => modes.has(card.mode))
    .map((card) => (agentType === 'pi' ? { ...card, ...PI_CARD_OVERRIDES[card.mode] } : card))
}
