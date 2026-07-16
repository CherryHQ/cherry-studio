import { claudeUserFacingTools } from '@shared/ai/claudecode/toolRegistry'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import { isPiCompatibleModel } from '@shared/ai/piModelCompatibility'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import { isManagedCherryAiDefaultModel } from '@shared/data/presets/cherryai'
import type { AgentType } from '@shared/data/types/agent'
import type { Model } from '@shared/data/types/model'
import { parseUniqueModelId } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { isGatewayRoutableModel } from '@shared/utils/model'

import type { SlashCommand } from './slashCommands'

export interface AgentRuntimeCapabilities {
  /** i18n key for runtime selector option. */
  labelKey: string
  labelFallback: string
  /** i18n key for capability-limit hint under the selector; null = none. */
  hintKey: string | null
  permissionModes: readonly AgentPermissionMode[]
  /** plan/small model fields. */
  modelTiers: boolean
  /** Heartbeat orchestration. */
  heartbeat: boolean
  mcp: boolean
  skills: boolean
  /** Runtime's built-in tools are surfaced in the agent-tools access list (`useAgentTools`) through
   *  the Claude tool-registry pipeline. claude-only today — pi's built-ins come from `builtinTools`
   *  and are not access-controlled ClaudeToolDescriptors, so pi sets this false. */
  claudeRegistryTools: boolean
  slashCommands: readonly SlashCommand[]
  createDefaults: { permissionMode: AgentPermissionMode }
  /** Extra restriction on top of the base agent-friendly filter; null = none. `provider` is
   *  undefined for orphan models — each runtime decides fail-open vs fail-closed there. */
  isModelCompatible: ((provider: Provider | undefined, model: Model) => boolean) | null
  /** providerMetadata.cherry.transport tag stamped by the runtime's stream adapter. */
  transport: string
  /** Edit-dialog catalog rows; i18nKeyBase = 'agent.tools.builtin.<key>'. */
  builtinTools: () => readonly {
    id: string
    i18nKeyBase: string
    labelFallback?: string
    descriptionFallback?: string
    category: string
  }[]
}

const ALL_PERMISSION_MODES = [
  'default',
  'plan',
  'acceptEdits',
  'bypassPermissions'
] as const satisfies readonly AgentPermissionMode[]

// Fallback shown only until the runtime reports the session's real catalog via
// `query.supportedCommands()`. Keep it to current Claude Code built-ins (see
// https://code.claude.com/docs/en/commands).
const CLAUDE_CODE_BUILTIN_COMMANDS = [
  { command: '/clear', description: 'Start a new conversation with empty context' },
  { command: '/compact', description: 'Free up context by summarizing the conversation so far' },
  { command: '/context', description: 'Visualize current context usage as a colored grid' },
  { command: '/usage', description: 'Show session cost, plan usage limits, and activity stats' }
] as const satisfies readonly SlashCommand[]

const PI_BUILTIN_COMMANDS = [
  { command: '/compact', description: 'Compact conversation with optional focus instructions' }
] as const satisfies readonly SlashCommand[]

export const AGENT_RUNTIME_CAPABILITIES = {
  'claude-code': {
    labelKey: 'library.config.agent.field.runtime.option.claude_code',
    labelFallback: 'Claude Code',
    hintKey: null,
    permissionModes: ALL_PERMISSION_MODES,
    modelTiers: true,
    heartbeat: true,
    mcp: true,
    skills: true,
    claudeRegistryTools: true,
    slashCommands: CLAUDE_CODE_BUILTIN_COMMANDS,
    createDefaults: { permissionMode: 'bypassPermissions' },
    // Claude Code reaches non-native providers through the local API Gateway, so its picker must use
    // the same routability rule as the gateway model catalog.
    isModelCompatible: (_provider, model) => isGatewayRoutableModel(model),
    transport: 'claude-agent',
    builtinTools: () =>
      claudeUserFacingTools().map((tool) => ({
        id: tool.name,
        i18nKeyBase: `agent.tools.builtin.${tool.key}`,
        labelFallback: tool.label,
        descriptionFallback: tool.description,
        category: tool.category
      }))
  },
  pi: {
    labelKey: 'library.config.agent.field.runtime.option.pi',
    labelFallback: 'pi',
    hintKey: 'library.config.agent.field.runtime.pi_hint',
    permissionModes: ALL_PERMISSION_MODES.filter((mode) => mode !== 'plan'),
    modelTiers: false,
    heartbeat: true,
    // Selected MCP servers are bridged as approval-gated pi custom tools.
    mcp: true,
    skills: true,
    claudeRegistryTools: false,
    slashCommands: PI_BUILTIN_COMMANDS,
    createDefaults: { permissionMode: 'default' },
    // Orphan models are rejected (pre-descriptor behavior): pi needs the provider's endpoint
    // config to resolve a wire protocol, so no provider ⇒ not drivable. The managed CherryAI
    // free-quota default is barred too — like claude, pi must not drive it directly.
    isModelCompatible: (provider, model) =>
      !!provider &&
      isPiCompatibleModel(provider, model) &&
      !isManagedCherryAiDefaultModel(model.providerId, model.apiModelId ?? parseUniqueModelId(model.id).modelId),
    transport: 'pi-agent',
    builtinTools: () =>
      PI_BUILTIN_TOOLS.map((tool) => ({
        id: tool.name,
        i18nKeyBase: `agent.tools.builtin.${tool.name}`,
        category: tool.category
      }))
  }
} as const satisfies Record<AgentType, AgentRuntimeCapabilities>
