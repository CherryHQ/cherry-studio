import type { AgentDetail } from '@renderer/types/resourceCatalog'
import { DEFAULT_HEARTBEAT_ENABLED, DEFAULT_HEARTBEAT_INTERVAL } from '@renderer/utils/agent/permissionMode'
import type { AgentConfiguration } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/**
 * Flat, controlled form-state for the Agent create/edit dialogs.
 *
 * Every editable field (one per `AgentBase` column + the common
 * `configuration.*` sub-keys surfaced by the dialog) lives on this object. It
 * seeds the dialog's draft; each control then persists its own field.
 */
export interface AgentFormState {
  name: string
  description: string
  /** `''` is the explicit "no model selected yet" draft sentinel; once chosen it is always a valid UniqueModelId. */
  model: UniqueModelId | ''
  planModel: UniqueModelId | ''
  smallModel: UniqueModelId | ''
  instructions: string
  mcps: string[]
  /** Knowledge bases bound to the agent (empty = kb_* tools not exposed). */
  knowledgeBaseIds: string[]
  skillIds: string[]
  /** Opt-out list of disabled tool names (empty = all enabled). */
  disabledTools: string[]

  // configuration.* derived fields we edit in the library UI.
  avatar: string
  permissionMode: string
  /** Raw multi-line `KEY=VALUE` text; parsed at save time. */
  envVarsText: string
  heartbeatEnabled: boolean
  heartbeatInterval: number
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Serialize a `configuration.env_vars` entry into a line-delimited `KEY=VALUE`
 * text block for the textarea control. Accepts either array-of-`{key, value}`
 * pairs (the canonical shape emitted by `envVarsFromText`) or a plain object.
 */
function envVarsToText(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is { key?: unknown; value?: unknown } => typeof item === 'object' && item !== null)
      .map(({ key, value }) => {
        const k = asString(key)
        if (!k) return ''
        return `${k}=${asString(value)}`
      })
      .filter(Boolean)
      .join('\n')
  }
  if (raw && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .map(([k, v]) => `${k}=${asString(v)}`)
      .join('\n')
  }
  return ''
}

/** Reverse of `envVarsToText` — record of `KEY -> VALUE`, empty lines dropped. */
export function agentEnvVarsFromText(text: string): Record<string, string> {
  const entries = text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line): [string, string] | null => {
      const idx = line.indexOf('=')
      if (idx === -1) return [line.trim(), '']
      return [line.slice(0, idx).trim(), line.slice(idx + 1)]
    })
    .filter((entry): entry is [string, string] => entry !== null && entry[0].length > 0)

  return Object.fromEntries(entries)
}

export function buildInitialAgentFormState(agent?: AgentDetail | null, skillIds: string[] = []): AgentFormState {
  const cfg: AgentConfiguration = agent?.configuration ?? {}
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    model: agent?.model ?? '',
    planModel: agent?.planModel ?? '',
    smallModel: agent?.smallModel ?? '',
    instructions: agent?.instructions ?? '',
    mcps: [...(agent?.mcps ?? [])],
    knowledgeBaseIds: [...(agent?.knowledgeBaseIds ?? [])],
    skillIds: [...skillIds],
    disabledTools: [...(agent?.disabledTools ?? [])],
    avatar: asString(cfg.avatar),
    permissionMode: asString(cfg.permission_mode),
    envVarsText: envVarsToText(cfg.env_vars),
    heartbeatEnabled: cfg.heartbeat_enabled ?? DEFAULT_HEARTBEAT_ENABLED,
    heartbeatInterval: asNumber(cfg.heartbeat_interval) || DEFAULT_HEARTBEAT_INTERVAL
  }
}
