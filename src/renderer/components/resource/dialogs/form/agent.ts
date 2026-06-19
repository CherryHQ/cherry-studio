import {
  DEFAULT_HEARTBEAT_ENABLED,
  DEFAULT_HEARTBEAT_INTERVAL,
  normalizePermissionMode
} from '@renderer/hooks/agents/permissionMode'
import type { AgentDetail } from '@renderer/pages/library/types'
import type { UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentConfiguration } from '@shared/data/types/agent'
import type { UniqueModelId } from '@shared/data/types/model'

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/**
 * Flat, controlled form-state for the Agent create/edit dialogs.
 *
 * Every editable field (one per `AgentBase` column + the common
 * `configuration.*` sub-keys surfaced by the dialog) lives on this object.
 * The dialog diffs it against the baseline at save time and emits a minimal
 * `UpdateAgentDto`.
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
  /** Opt-out list of disabled tool names (empty = all enabled). */
  disabledTools: string[]

  // configuration.* derived fields we edit in the library UI.
  avatar: string
  permissionMode: string
  /** Raw multi-line `KEY=VALUE` text; parsed at save time. */
  envVarsText: string
  soulEnabled: boolean
  heartbeatEnabled: boolean
  heartbeatInterval: number
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asBoolean(value: unknown): boolean {
  return value === true
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
function envVarsFromText(text: string): Record<string, string> {
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

export function buildInitialAgentFormState(agent?: AgentDetail | null): AgentFormState {
  const cfg: AgentConfiguration = agent?.configuration ?? {}
  return {
    name: agent?.name ?? '',
    description: agent?.description ?? '',
    model: agent?.model ?? '',
    planModel: agent?.planModel ?? '',
    smallModel: agent?.smallModel ?? '',
    instructions: agent?.instructions ?? '',
    mcps: [...(agent?.mcps ?? [])],
    disabledTools: [...(agent?.disabledTools ?? [])],
    avatar: asString(cfg.avatar),
    permissionMode: asString(cfg.permission_mode),
    envVarsText: envVarsToText(cfg.env_vars),
    soulEnabled: asBoolean(cfg.soul_enabled),
    heartbeatEnabled: cfg.heartbeat_enabled ?? DEFAULT_HEARTBEAT_ENABLED,
    heartbeatInterval: asNumber(cfg.heartbeat_interval) || DEFAULT_HEARTBEAT_INTERVAL
  }
}

export function applyAgentFormPatch(current: AgentFormState, patch: Partial<AgentFormState>): AgentFormState {
  const next: AgentFormState = { ...current, ...patch }

  if (Object.prototype.hasOwnProperty.call(patch, 'permissionMode')) {
    const nextMode = normalizePermissionMode(patch.permissionMode)
    next.permissionMode = nextMode
    if (
      nextMode !== 'bypassPermissions' &&
      current.soulEnabled &&
      !Object.prototype.hasOwnProperty.call(patch, 'soulEnabled')
    ) {
      next.soulEnabled = false
    }
  }

  if (patch.soulEnabled === true && !current.soulEnabled) {
    next.permissionMode = 'bypassPermissions'
  }

  return next
}

/** Result of {@link diffAgentUpdate}. */
export interface AgentDiffResult {
  dto: UpdateAgentDto
}

/**
 * Compute a minimal `UpdateAgentDto` by comparing `next` to `baseline`. Returns
 * `null` when no editable agent field changed.
 *
 * `configuration` is merged onto the existing `agent.configuration` so unrelated
 * keys that we don't surface in the form (plugin-specific settings, etc.) are
 * preserved. Only the configuration keys we actually edit participate in the
 * diff.
 */
export function diffAgentUpdate(
  baseline: AgentFormState,
  next: AgentFormState,
  agent: AgentDetail
): AgentDiffResult | null {
  const dto: UpdateAgentDto = {}
  let dirty = false

  if (baseline.name !== next.name) {
    dto.name = next.name
    dirty = true
  }
  if (baseline.description !== next.description) {
    dto.description = next.description
    dirty = true
  }
  if (baseline.model !== next.model) {
    if (next.model) dto.model = next.model
    dirty = true
  }
  if (baseline.planModel !== next.planModel) {
    dto.planModel = next.planModel || undefined
    dirty = true
  }
  if (baseline.smallModel !== next.smallModel) {
    dto.smallModel = next.smallModel || undefined
    dirty = true
  }
  if (baseline.instructions !== next.instructions) {
    dto.instructions = next.instructions
    dirty = true
  }
  if (!arraysEqual(baseline.mcps, next.mcps)) {
    dto.mcps = next.mcps
    dirty = true
  }
  if (!arraysEqual(baseline.disabledTools, next.disabledTools)) {
    dto.disabledTools = next.disabledTools
    dirty = true
  }

  const cfgPatch: Record<string, unknown> = {}
  let cfgDirty = false

  if (baseline.avatar !== next.avatar) {
    cfgPatch.avatar = next.avatar
    cfgDirty = true
  }
  if (baseline.permissionMode !== next.permissionMode) {
    cfgPatch.permission_mode = next.permissionMode || 'default'
    cfgDirty = true
  }
  if (baseline.envVarsText !== next.envVarsText) {
    cfgPatch.env_vars = envVarsFromText(next.envVarsText)
    cfgDirty = true
  }
  if (baseline.soulEnabled !== next.soulEnabled) {
    cfgPatch.soul_enabled = next.soulEnabled
    cfgDirty = true
  }
  if (baseline.heartbeatEnabled !== next.heartbeatEnabled) {
    cfgPatch.heartbeat_enabled = next.heartbeatEnabled
    cfgDirty = true
  }
  if (baseline.heartbeatInterval !== next.heartbeatInterval) {
    if (next.heartbeatEnabled) {
      cfgPatch.heartbeat_enabled = true
    }
    cfgPatch.heartbeat_interval = next.heartbeatInterval
    cfgDirty = true
  }

  if (cfgDirty) {
    dto.configuration = { ...configurationWithoutMaxTurns(agent.configuration), ...cfgPatch }
    dirty = true
  }

  if (!dirty) return null

  return { dto }
}

function configurationWithoutMaxTurns(configuration: AgentDetail['configuration']): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...configuration }
  delete rest.max_turns
  return rest
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

// ---------------------------------------------------------------------------
// Unified save intent
// ---------------------------------------------------------------------------

/**
 * Single "what should save do next?" value consumed by edit dialog save
 * handlers.
 */
export type AgentSaveIntent = { kind: 'update'; payload: UpdateAgentDto }

/**
 * Resolve the current form into a save intent. Returns `null` when
 * there's nothing to do.
 */
export function diffAgentSaveIntent(
  form: AgentFormState,
  baseline: AgentFormState,
  agent: AgentDetail
): AgentSaveIntent | null {
  const result = diffAgentUpdate(baseline, form, agent)
  if (!result) return null
  return {
    kind: 'update',
    payload: result.dto
  }
}
