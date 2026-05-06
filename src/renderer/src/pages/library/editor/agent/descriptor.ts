import type { CreateAgentDto, UpdateAgentDto } from '@shared/data/api/schemas/agents'
import type { AgentConfiguration, AgentDetail, AgentType } from '@shared/data/types/agent'
import { FileText, Settings, Shield, SlidersHorizontal, Wrench } from 'lucide-react'

import type { SectionDescriptor } from '../ConfigEditorShell'

// ---------------------------------------------------------------------------
// Section metadata
// ---------------------------------------------------------------------------

export type AgentConfigSection = 'basic' | 'prompt' | 'permission' | 'tools' | 'advanced'

export const AGENT_CONFIG_SECTIONS: readonly SectionDescriptor<AgentConfigSection>[] = [
  {
    id: 'basic',
    icon: Settings,
    labelKey: 'library.config.agent.section.basic.label',
    descKey: 'library.config.agent.section.basic.desc'
  },
  {
    id: 'prompt',
    icon: FileText,
    labelKey: 'library.config.agent.section.prompt.label',
    descKey: 'library.config.agent.section.prompt.desc'
  },
  {
    id: 'permission',
    icon: Shield,
    labelKey: 'library.config.agent.section.permission.label',
    descKey: 'library.config.agent.section.permission.desc'
  },
  {
    id: 'tools',
    icon: Wrench,
    labelKey: 'library.config.agent.section.tools.label',
    descKey: 'library.config.agent.section.tools.desc'
  },
  {
    id: 'advanced',
    icon: SlidersHorizontal,
    labelKey: 'library.config.agent.section.advanced.label',
    descKey: 'library.config.agent.section.advanced.desc'
  }
]

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/**
 * Flat, controlled form-state for the Agent editor.
 *
 * Every editable field (one per `AgentBase` column + the common
 * `configuration.*` sub-keys surfaced by the legacy AgentSettings UI)
 * lives on this object. Section components read / patch it; the page
 * diffs it against the baseline at save time and emits a minimal
 * `UpdateAgentDto`.
 */
export interface AgentFormState {
  // AgentBase primitives
  name: string
  description: string
  model: string
  planModel: string
  smallModel: string
  instructions: string
  accessiblePaths: string[]
  mcps: string[]
  allowedTools: string[]

  // configuration.* derived fields we edit in the library UI.
  avatar: string
  permissionMode: string
  /** 0 disables the explicit cap; any positive integer overrides the default. */
  maxTurns: number
  /** Raw multi-line `KEY=VALUE` text; parsed at save time. */
  envVarsText: string
  soulEnabled: boolean
  heartbeatEnabled: boolean
  heartbeatInterval: number

  /**
   * Tag names bound to the agent. Mirrors `AssistantFormState.tags`:
   * the form stores user-facing names and the page resolves them to ids
   * via `ensureTags` on save (so the user can type a brand-new tag name
   * without paying a network round-trip per keystroke).
   */
  tags: string[]
}

const DEFAULT_AGENT_MAX_TURNS = 100

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asFormMaxTurns(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0
  }
  if (value <= 0 || value === DEFAULT_AGENT_MAX_TURNS) {
    return 0
  }
  return value
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
    accessiblePaths: [...(agent?.accessiblePaths ?? [])],
    mcps: [...(agent?.mcps ?? [])],
    allowedTools: [...(agent?.allowedTools ?? [])],
    avatar: asString(cfg.avatar),
    permissionMode: asString(cfg.permission_mode),
    maxTurns: asFormMaxTurns(cfg.max_turns),
    envVarsText: envVarsToText(cfg.env_vars),
    soulEnabled: asBoolean(cfg.soul_enabled),
    heartbeatEnabled: asBoolean(cfg.heartbeat_enabled),
    heartbeatInterval: asNumber(cfg.heartbeat_interval),
    tags: (agent?.tags ?? []).map((t) => t.name)
  }
}

/**
 * Build the `configuration` object for a create / full-update payload by
 * collapsing the flat form keys back into their canonical snake_case nested
 * shape. Only keys with non-default values land in the output so the row
 * stays lean; later PATCHes can add more keys via `diffAgentUpdate`.
 */
function buildConfigurationPayload(form: AgentFormState): AgentConfiguration | undefined {
  const cfg: Record<string, unknown> = {}
  if (form.avatar) cfg.avatar = form.avatar
  if (form.permissionMode) cfg.permission_mode = form.permissionMode
  if (form.maxTurns > 0) cfg.max_turns = form.maxTurns
  if (form.envVarsText.trim()) cfg.env_vars = envVarsFromText(form.envVarsText)
  if (form.soulEnabled) cfg.soul_enabled = true
  if (form.heartbeatEnabled) {
    cfg.heartbeat_enabled = true
    if (form.heartbeatInterval > 0) cfg.heartbeat_interval = form.heartbeatInterval
  }
  return Object.keys(cfg).length > 0 ? cfg : undefined
}

/**
 * Convert the full form state into a `CreateAgentDto`. Used on the library's
 * "新建智能体 → 配置 → 保存" flow: the row is only POSTed once the user clicks
 * save from the config page, not on entry. Empty optional fields are omitted
 * so the backend can apply its own defaults.
 */
export function buildCreateAgentPayload(form: AgentFormState, type: AgentType = 'claude-code'): CreateAgentDto {
  return {
    type,
    name: form.name.trim(),
    model: form.model.trim(),
    accessiblePaths: form.accessiblePaths,
    description: form.description || undefined,
    instructions: form.instructions || undefined,
    planModel: form.planModel || undefined,
    smallModel: form.smallModel || undefined,
    mcps: form.mcps.length > 0 ? form.mcps : undefined,
    allowedTools: form.allowedTools.length > 0 ? form.allowedTools : undefined,
    configuration: buildConfigurationPayload(form)
  }
}

export interface AgentCreateValidation {
  nameMissing: boolean
  modelMissing: boolean
  isValid: boolean
}

export function validateAgentCreateForm(form: AgentFormState): AgentCreateValidation {
  const nameMissing = form.name.trim() === ''
  const modelMissing = form.model.trim() === ''
  return {
    nameMissing,
    modelMissing,
    isValid: !nameMissing && !modelMissing
  }
}

/**
 * Minimum requirements for a valid create payload: name + model. Matches the
 * backend `requireFields(['type', 'name', 'model'])` guard in
 * `src/main/data/api/handlers/agents.ts`.
 */
export function isCreatePayloadValid(form: AgentFormState): boolean {
  return validateAgentCreateForm(form).isValid
}

/**
 * Result of {@link diffAgentUpdate}. Mirrors `AssistantDiffResult`:
 *
 * - `dto` is the PATCH body sans `tagIds` — tag resolution is a side effect
 *   (`ensureTags` may POST new rows) so it stays at the page level.
 * - `tagsChanged` + `tagNames` tell the page whether to call `ensureTags`
 *   and what to resolve.
 */
export interface AgentDiffResult {
  dto: UpdateAgentDto
  tagsChanged: boolean
  tagNames: string[]
}

/**
 * Compute a minimal `UpdateAgentDto` by comparing `next` to `baseline`. Returns
 * `null` when nothing — including tag bindings — changed.
 *
 * `configuration` is merged onto the existing `agent.configuration` so unrelated
 * keys that we don't surface in the form (plugin-specific settings, etc.) are
 * preserved. Only the configuration keys we actually edit participate in the
 * diff. Tags follow the same name→id resolution flow as assistants: not placed
 * on the dto here, surfaced via `tagsChanged` so the page can `ensureTags` and
 * attach `tagIds` itself.
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
    dto.model = next.model
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
  if (!arraysEqual(baseline.accessiblePaths, next.accessiblePaths)) {
    dto.accessiblePaths = next.accessiblePaths
    dirty = true
  }
  if (!arraysEqual(baseline.mcps, next.mcps)) {
    dto.mcps = next.mcps
    dirty = true
  }
  if (!arraysEqual(baseline.allowedTools, next.allowedTools)) {
    dto.allowedTools = next.allowedTools
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
  if (baseline.maxTurns !== next.maxTurns) {
    cfgPatch.max_turns = next.maxTurns > 0 ? next.maxTurns : DEFAULT_AGENT_MAX_TURNS
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
    cfgPatch.heartbeat_interval = next.heartbeatInterval
    cfgDirty = true
  }

  if (cfgDirty) {
    dto.configuration = { ...agent.configuration, ...cfgPatch }
    dirty = true
  }

  const tagsChanged = !sameStringSet(baseline.tags, next.tags)

  if (!dirty && !tagsChanged) return null

  return { dto, tagsChanged, tagNames: next.tags }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** Order-insensitive string-set equality; mirrors assistant tag-set diff. */
function sameStringSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every((v) => set.has(v))
}

// ---------------------------------------------------------------------------
// Unified save intent
// ---------------------------------------------------------------------------

/**
 * Single "what should save do next?" value consumed by
 * `useResourceEditorState`. Encodes the Agent create-vs-update branch
 * so the shell / state hook stay generic — the page only has to match
 * on `kind` inside its `onCommit` closure.
 */
export type AgentSaveIntent =
  | { kind: 'create'; payload: CreateAgentDto; tagNames: string[] }
  | { kind: 'update'; payload: UpdateAgentDto; tagNames: string[]; tagsChanged: boolean }

/**
 * Resolve the current form into a save intent. Returns `null` when
 * there's nothing to do:
 * - Create mode (`agent === null`): form must satisfy the backend's
 *   required fields.
 * - Edit mode: at least one column or the tag binding must differ from
 *   the baseline. Tag-only changes also trigger an update intent.
 */
export function diffAgentSaveIntent(
  form: AgentFormState,
  baseline: AgentFormState,
  agent: AgentDetail | null
): AgentSaveIntent | null {
  if (!agent) {
    if (!isCreatePayloadValid(form)) return null
    return {
      kind: 'create',
      payload: buildCreateAgentPayload(form),
      tagNames: form.tags
    }
  }
  const result = diffAgentUpdate(baseline, form, agent)
  if (!result) return null
  return {
    kind: 'update',
    payload: result.dto,
    tagNames: result.tagNames,
    tagsChanged: result.tagsChanged
  }
}
