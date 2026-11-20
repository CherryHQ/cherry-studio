/**
 * Create Agents and Assistants and configure Agents from a conversation. The one validate-and-apply
 * path behind Cherry Assistant's `create_agent` / `create_assistant` / `update_agent` and every
 * user-created Agent's `agent_create` / `assistant_create` / `config_update`, so each entry point
 * accepts the same fields and refuses the same values.
 */

import * as z from 'zod'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { assistantDataService } from '@data/services/AssistantService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { loggerService } from '@logger'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { t } from '@main/i18n'
import { getAgentConfigToolKind } from '@shared/ai/agentConfigToolKind'
import type {
  AgentConfigChangePreview,
  AgentConfigToolOutput,
  AssistantCreateToolOutput
} from '@shared/ai/agentConfigToolOutput'
import { buildCreateAgentCommand, DEFAULT_AGENT_CREATE_AVATAR } from '@shared/ai/agentCreateCommand'
import {
  type AgentFormState,
  applyAgentFormPatch,
  buildInitialAgentFormState,
  diffAgentUpdate
} from '@shared/ai/agentForm'
import { clampHeartbeatIntervalMinutes, normalizeHeartbeatTimeoutMinutes } from '@shared/ai/agentHeartbeat'
import { normalizePermissionMode } from '@shared/ai/agentPermissionMode'
import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import { buildCreateAssistantDto, DEFAULT_ASSISTANT_CREATE_AVATAR } from '@shared/ai/assistantCreateDto'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import { resolveReasoningEffortForModel } from '@shared/ai/reasoning'
import { parseFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import { ErrorCode, isDataApiError } from '@shared/data/api/errors'
import {
  type AgentEntity,
  type AgentPermissionMode,
  AgentPermissionModeSchema,
  type AgentType
} from '@shared/data/api/schemas/agents'
import { AgentLanguageSchema } from '@shared/data/types/agentLanguage'
import type { AssistantReplyLanguage } from '@shared/data/types/assistant'
import { type Model, parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import type { ReasoningEffortOption } from '@shared/types/aiSdk'
import { toAvatarEmoji } from '@shared/utils/emoji'
import { isBrowserMcpServer } from '@shared/utils/mcp'
import { isNonChatModel } from '@shared/utils/model'

import { createAgent } from './createAgent'

const logger = loggerService.withContext('AgentConfigTool')

/** Every create entry point builds the runtime the create wizard defaults to. */
const NEW_AGENT_TYPE: AgentType = 'pi-durable'
const SUMMARY_TEXT_MAX_LENGTH = 60

const settingsShape = {
  emoji: z.string().optional().describe('One emoji for the avatar.'),
  description: z.string().optional().describe('One line shown in the Agent list.'),
  instructions: z
    .string()
    .optional()
    .describe("The Agent's system prompt: role, behavior, output format. Write it in the user's language."),
  model: z.string().optional().describe('Model id in the form "providerId::modelId".'),
  permissionMode: AgentPermissionModeSchema.optional().describe(
    // Users name modes by their UI labels; Kimi K2.6 read "逐次确认" as acceptEdits without them.
    'default ("Ask Before Acting" / "逐次确认") asks before acting; acceptEdits ("Auto-accept Edits" / "自动接受编辑") accepts file edits; auto ("Approve for Me" / "智能批准") approves routine actions. bypassPermissions ("Full Access" / "完全访问") is never accepted here.'
  ),
  skillIds: z
    .array(z.string())
    .optional()
    .describe('Installed skills to enable. Replaces the current set; built-in skills keep their state.'),
  knowledgeBaseIds: z.array(z.string()).optional().describe('Knowledge bases to bind. Replaces the current set.'),
  mcpServerIds: z.array(z.string()).optional().describe('Installed MCP servers to bind. Replaces the current set.'),
  disabledTools: z
    .array(z.string())
    .optional()
    .describe('Built-in tools to switch off. Replaces the current list; an empty list enables all.'),
  language: z
    .string()
    .optional()
    .describe(
      'Reply language: "inherit" follows the global setting, "off" removes the constraint, anything else is a language label such as "English" or "中文".'
    ),
  heartbeat: z
    .strictObject({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().int().positive().optional(),
      timeoutMinutes: z.number().int().positive().optional()
    })
    .optional()
    .describe('Periodic heartbeat check.')
}

export const CREATE_AGENT_TOOL_DESCRIPTION =
  'Create a new Agent (an autonomous worker with its own tools, skills and workspace) only when the user explicitly asks for a new Agent, e.g. "建一个 Agent". Never use it to carry out or schedule a task yourself; scheduled or recurring work goes to cron. Propose the configuration first; the user approves every call. Omit model to use the default model.'

export const CREATE_ASSISTANT_TOOL_DESCRIPTION =
  'Create a new Assistant (a chat persona with a prompt, a model and optional knowledge bases, MCP servers and web search) only when the user explicitly asks for a new Assistant, e.g. "建一个助手". Never use it to carry out or schedule a task yourself. Propose the configuration first; the user approves every call. Omit model to use the default model.'

export const CreateAgentToolInputSchema = z.strictObject({
  ...settingsShape,
  name: z.string().trim().min(1).describe('Short display name, e.g. "Python Reviewer" or "周报助手".'),
  instructions: z
    .string()
    .trim()
    .min(1)
    .describe("The Agent's system prompt: role, behavior, output format. Write it in the user's language.")
})

export const UpdateAgentToolInputSchema = z.strictObject({
  agentId: z.string().min(1).describe('ID of the Agent to change, from agent_list.'),
  name: z.string().trim().min(1).optional().describe('New display name.'),
  ...settingsShape
})

/** The calling Agent's own fields; renaming stays on the approval-free `config` rename action. */
export const SelfUpdateToolInputSchema = z.strictObject(settingsShape)

export const CreateAssistantToolInputSchema = z.strictObject({
  name: z.string().trim().min(1).describe('Short display name, e.g. "Translator" or "周报助手".'),
  emoji: settingsShape.emoji,
  description: z.string().optional().describe('One line shown in the Assistant list.'),
  prompt: z
    .string()
    .trim()
    .min(1)
    .describe("The Assistant's system prompt: role, behavior, output format. Write it in the user's language."),
  model: settingsShape.model,
  knowledgeBaseIds: z.array(z.string()).optional().describe('Knowledge bases to bind.'),
  mcpServerIds: z.array(z.string()).optional().describe('Installed MCP servers the Assistant may use.'),
  webSearch: z.boolean().optional().describe('Let the Assistant search and read the web.'),
  language: settingsShape.language
})

type SettingsInput = z.infer<typeof SelfUpdateToolInputSchema> & { name?: string }

type CatalogItem = { id: string; name: string }

function assertKnownIds(kind: string, ids: readonly string[], catalog: readonly CatalogItem[]): void {
  const known = new Set(catalog.map((item) => item.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length === 0) return
  const available =
    catalog.map((item) => (item.name === item.id ? item.id : `${item.id} (${item.name})`)).join(', ') || 'none'
  throw new Error(`Unknown ${kind} ID: ${unknown.join(', ')}. Installed ${kind}s: ${available}.`)
}

function requireCapability(supported: boolean, field: string, agentType: AgentType): void {
  if (!supported) throw new Error(`'${field}' is not supported by ${agentType} Agents.`)
}

/** What the model has to drive: an Agent runtime, or a chat Assistant. */
type ModelTarget = AgentType | 'assistant'

function isModelUsableFor(target: ModelTarget, provider: Provider, model: Model): boolean {
  if (target === 'assistant') return !isNonChatModel(model)
  const isCompatible = AGENT_RUNTIME_CAPABILITIES[target].isModelCompatible
  return !isCompatible || isCompatible(provider, model)
}

function resolveModel(raw: string, target: ModelTarget): UniqueModelId {
  const parsed = UniqueModelIdSchema.safeParse(raw.trim())
  if (!parsed.success) throw new Error(`'model' must be in the form "providerId::modelId" (got "${raw}").`)
  const { providerId, modelId } = parseUniqueModelId(parsed.data)
  let model: ReturnType<typeof modelService.getByKey>
  let provider: ReturnType<typeof providerService.getByProviderId>
  try {
    model = modelService.getByKey(providerId, modelId)
    provider = providerService.getByProviderId(providerId)
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      throw new Error(`Model is not configured in Cherry Studio: ${parsed.data}`)
    }
    throw error
  }
  if (!model.isEnabled || !provider.isEnabled) throw new Error(`Model is disabled in Cherry Studio: ${parsed.data}`)
  if (!isModelUsableFor(target, provider, model)) {
    throw new Error(
      `Model ${parsed.data} cannot run ${target === 'assistant' ? 'an Assistant' : `a ${target} Agent`}. Choose another model.`
    )
  }
  return parsed.data
}

function tryResolveModel(raw: string | null | undefined, target: ModelTarget): UniqueModelId | undefined {
  if (!raw) return undefined
  try {
    return resolveModel(raw, target)
  } catch {
    return undefined
  }
}

function resolvePermissionMode(mode: AgentPermissionMode, agentType: AgentType): AgentPermissionMode {
  if (mode === 'bypassPermissions') {
    throw new Error(
      'bypassPermissions (Full Access) cannot be set from a conversation. The user can choose it in the Agent settings.'
    )
  }
  const allowed = AGENT_RUNTIME_CAPABILITIES[agentType].permissionModes.filter((m) => m !== 'bypassPermissions')
  if (!allowed.includes(mode)) {
    throw new Error(
      `Permission mode '${mode}' is not available for ${agentType} Agents. Use one of: ${allowed.join(', ')}.`
    )
  }
  return mode
}

function listSkillCatalog(): CatalogItem[] {
  return agentGlobalSkillService
    .listAll()
    .filter((skill) => skill.source !== 'builtin' && skill.isGlobalEnabled)
    .map(({ id, name }) => ({ id, name }))
}

function listKnowledgeBaseCatalog(): CatalogItem[] {
  return [...knowledgeBaseService.listAllIds()].map((id) => ({ id, name: knowledgeBaseService.getById(id).name }))
}

function listMcpServerCatalog(current: readonly string[]): CatalogItem[] {
  return mcpServerService
    .list({})
    .items.filter((server) => (server.isActive && !isBrowserMcpServer(server)) || current.includes(server.id))
    .map(({ id, name }) => ({ id, name }))
}

function builtinToolIds(agentType: AgentType): Set<string> {
  return new Set(AGENT_RUNTIME_CAPABILITIES[agentType].builtinTools(process.platform).map((tool) => tool.id))
}

function unique(ids: readonly string[]): string[] {
  return Array.from(new Set(ids))
}

function parseLanguage(raw: string): AssistantReplyLanguage {
  const value = raw.trim()
  if (value === 'inherit' || value === 'off') return { mode: value }
  const parsed = AgentLanguageSchema.safeParse(value)
  if (!parsed.success) {
    throw new Error(`'language' must be "inherit", "off", or a single-line label of up to 50 characters.`)
  }
  return { mode: 'custom', language: parsed.data }
}

/** Validate tool input against the installed catalogs and fold it into the edit form's state. */
function applySettingsInput(
  base: AgentFormState,
  input: SettingsInput,
  agentType: AgentType,
  { creating }: { creating: boolean }
): AgentFormState {
  const caps = AGENT_RUNTIME_CAPABILITIES[agentType]
  const patch: Partial<AgentFormState> = {}

  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.description !== undefined) patch.description = input.description.trim()
  if (input.instructions !== undefined) patch.instructions = input.instructions.trim()
  if (input.emoji !== undefined) {
    const emoji = toAvatarEmoji(input.emoji)
    if (!emoji && !creating) throw new Error(`'emoji' must be a single emoji (got "${input.emoji}").`)
    patch.avatar = emoji ?? DEFAULT_AGENT_CREATE_AVATAR
  }
  if (input.model !== undefined) patch.model = resolveModel(input.model, agentType)
  if (input.permissionMode !== undefined) patch.permissionMode = resolvePermissionMode(input.permissionMode, agentType)
  if (input.skillIds !== undefined) {
    requireCapability(caps.skills, 'skillIds', agentType)
    assertKnownIds('skill', input.skillIds, listSkillCatalog())
    const builtinSkillIds = new Set(
      agentGlobalSkillService
        .listAll()
        .filter((skill) => skill.source === 'builtin')
        .map((skill) => skill.id)
    )
    patch.skillIds = unique([...base.skillIds.filter((id) => builtinSkillIds.has(id)), ...input.skillIds])
  }
  if (input.knowledgeBaseIds !== undefined) {
    requireCapability(caps.knowledgeBases, 'knowledgeBaseIds', agentType)
    assertKnownIds('knowledge base', input.knowledgeBaseIds, listKnowledgeBaseCatalog())
    patch.knowledgeBaseIds = unique(input.knowledgeBaseIds)
  }
  if (input.mcpServerIds !== undefined) {
    requireCapability(caps.mcp, 'mcpServerIds', agentType)
    assertKnownIds('MCP server', input.mcpServerIds, listMcpServerCatalog(base.mcps))
    patch.mcps = unique(input.mcpServerIds)
  }
  if (input.disabledTools !== undefined) {
    const isPi = agentType === 'pi' || agentType === 'pi-durable'
    const requested = input.disabledTools.map((id) => (isPi ? normalizePiDisabledToolId(id) : id))
    const catalog = builtinToolIds(agentType)
    assertKnownIds(
      'built-in tool',
      requested,
      [...catalog].map((id) => ({ id, name: id }))
    )
    // Group switches the dialog owns (browser control, computer use) are not built-in tools; keep them.
    patch.disabledTools = unique([...base.disabledTools.filter((id) => !catalog.has(id)), ...requested])
  }
  if (input.language !== undefined) {
    const language = parseLanguage(input.language)
    patch.languageMode = language.mode
    patch.languageCustom = language.mode === 'custom' ? language.language : ''
  }
  if (input.heartbeat !== undefined) {
    requireCapability(caps.heartbeat, 'heartbeat', agentType)
    const { enabled, intervalMinutes, timeoutMinutes } = input.heartbeat
    if (enabled !== undefined) patch.heartbeatEnabled = enabled
    if (intervalMinutes !== undefined) patch.heartbeatInterval = clampHeartbeatIntervalMinutes(intervalMinutes)
    if (timeoutMinutes !== undefined) patch.heartbeatTimeoutMinutes = normalizeHeartbeatTimeoutMinutes(timeoutMinutes)
  }

  return applyAgentFormPatch(base, patch)
}

// ---------------------------------------------------------------------------
// Summary lines: shown to the user on the identity card and the approval card
// ---------------------------------------------------------------------------

type SummaryField =
  | 'avatar'
  | 'name'
  | 'description'
  | 'instructions'
  | 'model'
  | 'planModel'
  | 'smallModel'
  | 'permissionMode'
  | 'skills'
  | 'knowledgeBases'
  | 'mcpServers'
  | 'disabledTools'
  | 'language'
  | 'heartbeat'
  | 'webSearch'

const SUMMARY_FIELDS: readonly SummaryField[] = [
  'avatar',
  'name',
  'description',
  'instructions',
  'model',
  'planModel',
  'smallModel',
  'permissionMode',
  'skills',
  'knowledgeBases',
  'mcpServers',
  'disabledTools',
  'language',
  'heartbeat'
]

const FIELD_LABEL: Record<SummaryField, () => string> = {
  avatar: () => t('agent.config_tool.field.avatar'),
  name: () => t('agent.config_tool.field.name'),
  description: () => t('agent.config_tool.field.description'),
  instructions: () => t('agent.config_tool.field.instructions'),
  model: () => t('agent.config_tool.field.model'),
  planModel: () => t('agent.config_tool.field.plan_model'),
  smallModel: () => t('agent.config_tool.field.small_model'),
  permissionMode: () => t('agent.config_tool.field.permission_mode'),
  skills: () => t('agent.config_tool.field.skills'),
  knowledgeBases: () => t('agent.config_tool.field.knowledge_bases'),
  mcpServers: () => t('agent.config_tool.field.mcp_servers'),
  disabledTools: () => t('agent.config_tool.field.disabled_tools'),
  language: () => t('agent.config_tool.field.language'),
  heartbeat: () => t('agent.config_tool.field.heartbeat'),
  webSearch: () => t('agent.config_tool.field.web_search')
}

const PERMISSION_LABEL: Record<AgentPermissionMode, () => string> = {
  default: () => t('agent.config_tool.permission.default'),
  acceptEdits: () => t('agent.config_tool.permission.accept_edits'),
  plan: () => t('agent.config_tool.permission.plan'),
  auto: () => t('agent.config_tool.permission.auto'),
  bypassPermissions: () => t('agent.config_tool.permission.bypass_permissions')
}

const REASONING_LABEL: Record<ReasoningEffortOption, () => string> = {
  default: () => t('agent.config_tool.reasoning.default'),
  none: () => t('agent.config_tool.reasoning.none'),
  minimal: () => t('agent.config_tool.reasoning.minimal'),
  low: () => t('agent.config_tool.reasoning.low'),
  medium: () => t('agent.config_tool.reasoning.medium'),
  high: () => t('agent.config_tool.reasoning.high'),
  xhigh: () => t('agent.config_tool.reasoning.xhigh'),
  max: () => t('agent.config_tool.reasoning.max'),
  ultra: () => t('agent.config_tool.reasoning.ultra'),
  auto: () => t('agent.config_tool.reasoning.auto')
}

/** What a field compares by: changing the display text alone (a truncated prompt) must still count. */
function rawValue(field: SummaryField, form: AgentFormState): unknown {
  switch (field) {
    case 'avatar':
      return form.avatar
    case 'name':
      return form.name
    case 'description':
      return form.description
    case 'instructions':
      return form.instructions
    case 'model':
      return form.model
    case 'planModel':
      return form.planModel
    case 'smallModel':
      return form.smallModel
    case 'permissionMode':
      return normalizePermissionMode(form.permissionMode)
    case 'skills':
      return [...form.skillIds].sort()
    case 'knowledgeBases':
      return [...form.knowledgeBaseIds].sort()
    case 'mcpServers':
      return form.mcps
    case 'disabledTools':
      return form.disabledTools
    case 'language':
      return form.languageMode === 'custom' ? form.languageCustom : form.languageMode
    case 'heartbeat':
      return [form.heartbeatEnabled, form.heartbeatInterval, form.heartbeatTimeoutMinutes]
    case 'webSearch':
      return false
  }
}

function shortText(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return t('agent.config_tool.value.none')
  return line.length > SUMMARY_TEXT_MAX_LENGTH ? `${line.slice(0, SUMMARY_TEXT_MAX_LENGTH)}…` : line
}

function nameList(ids: readonly string[], nameOf: (id: string) => string | undefined): string {
  if (ids.length === 0) return t('agent.config_tool.value.none')
  return ids.map((id) => nameOf(id) ?? id).join(', ')
}

function safeName(read: () => { name: string }): string | undefined {
  try {
    return read().name
  } catch {
    return undefined
  }
}

function modelName(id: string): string {
  const { providerId, modelId } = parseUniqueModelId(id as UniqueModelId)
  return safeName(() => modelService.getByKey(providerId, modelId)) ?? id
}

/** Around the first difference, for two texts whose shortened forms read the same. */
function differingExcerpts(before: string, after: string): [string, string] {
  const a = before.replace(/\s+/g, ' ').trim()
  const b = after.replace(/\s+/g, ' ').trim()
  let index = 0
  while (index < a.length && a[index] === b[index]) index++
  const start = Math.max(0, index - 20)
  const excerpt = (text: string) => {
    const end = start + SUMMARY_TEXT_MAX_LENGTH
    return `${start > 0 ? '…' : ''}${text.slice(start, end) || t('agent.config_tool.value.none')}${end < text.length ? '…' : ''}`
  }
  return [excerpt(a), excerpt(b)]
}

function displayValue(field: SummaryField, form: AgentFormState): string {
  switch (field) {
    case 'avatar':
      return form.avatar || t('agent.config_tool.value.none')
    case 'name':
    case 'description':
    case 'instructions':
      return shortText(form[field])
    case 'model':
      return form.model ? modelName(form.model) : t('agent.config_tool.value.none')
    case 'planModel':
    case 'smallModel':
      return form[field] ? modelName(form[field]) : t('agent.config_tool.value.follows_model')
    case 'permissionMode':
      return PERMISSION_LABEL[normalizePermissionMode(form.permissionMode)]()
    case 'skills':
      return nameList(form.skillIds, (id) => agentGlobalSkillService.getById(id)?.name)
    case 'knowledgeBases':
      return nameList(form.knowledgeBaseIds, (id) => safeName(() => knowledgeBaseService.getById(id)))
    case 'mcpServers':
      return nameList(form.mcps, (id) => safeName(() => mcpServerService.getById(id)))
    case 'disabledTools':
      return nameList(form.disabledTools, () => undefined)
    case 'language':
      if (form.languageMode === 'inherit') return t('agent.config_tool.value.language_inherit')
      if (form.languageMode === 'off') return t('agent.config_tool.value.language_off')
      return form.languageCustom
    case 'heartbeat': {
      const schedule = t('agent.config_tool.value.heartbeat_on', {
        minutes: form.heartbeatInterval,
        timeout: form.heartbeatTimeoutMinutes
      })
      // The schedule stays visible while off, so a schedule-only change still reads as one.
      return form.heartbeatEnabled ? schedule : `${t('agent.config_tool.value.heartbeat_off')} · ${schedule}`
    }
    case 'webSearch':
      return t('agent.config_tool.value.enabled')
  }
}

function isChanged(field: SummaryField, before: AgentFormState, after: AgentFormState): boolean {
  return JSON.stringify(rawValue(field, before)) !== JSON.stringify(rawValue(field, after))
}

/** Each changed field as `field: current → new`, with both sides distinguishable even when they shorten alike. */
function describeChanges(before: AgentFormState, after: AgentFormState): string[] {
  return SUMMARY_FIELDS.filter((field) => isChanged(field, before, after)).map((field) => {
    let from = displayValue(field, before)
    let to = displayValue(field, after)
    if (from === to && (field === 'name' || field === 'description' || field === 'instructions')) {
      ;[from, to] = differingExcerpts(before[field], after[field])
    } else if (from === to && (field === 'model' || field === 'planModel' || field === 'smallModel')) {
      // Two models can share a display name; their IDs tell them apart.
      from = `${from} (${before[field]})`
      to = `${to} (${after[field]})`
    }
    return t('agent.config_tool.summary.change', { field: FIELD_LABEL[field](), from, to })
  })
}

/** Long texts in full, so an approval can be checked beyond the shortened summary line. */
function fullTextChanges(before: AgentFormState, after: AgentFormState) {
  return (['description', 'instructions'] as const)
    .filter((field) => before[field] !== after[field])
    .filter((field) => Math.max(before[field].length, after[field].length) > SUMMARY_TEXT_MAX_LENGTH)
    .map((field) => ({ field: FIELD_LABEL[field](), from: before[field], to: after[field] }))
}

/** The reasoning effort a model change will make the service store, which no input field shows. */
function reasoningEffortChange(agent: AgentEntity, before: AgentFormState, after: AgentFormState): string[] {
  if (!after.model || after.model === before.model) return []
  const { providerId, modelId } = parseUniqueModelId(after.model)
  let nextModel: Model | undefined
  try {
    nextModel = modelService.getByKey(providerId, modelId)
  } catch {
    return []
  }
  const current = agent.configuration?.reasoning_effort ?? 'default'
  const next = resolveReasoningEffortForModel(nextModel, current) ?? 'default'
  if (next === current) return []
  return [
    t('agent.config_tool.summary.change', {
      field: t('agent.config_tool.field.reasoning_effort'),
      from: REASONING_LABEL[current](),
      to: REASONING_LABEL[next]()
    })
  ]
}

/** The card already shows the avatar, name and description; model and permission always matter. */
function describeCreated(blank: AgentFormState, created: AgentFormState): string[] {
  return SUMMARY_FIELDS.filter(
    (field) =>
      field === 'model' ||
      field === 'permissionMode' ||
      (field !== 'avatar' && field !== 'name' && field !== 'description' && isChanged(field, blank, created))
  ).map((field) => setLine(field, created))
}

function agentHighlights(form: AgentFormState): string[] {
  return [
    displayValue('model', form),
    displayValue('permissionMode', form),
    ...(form.heartbeatEnabled ? [FIELD_LABEL.heartbeat()] : [])
  ]
}

function assistantHighlights(form: AgentFormState, webSearch: boolean | undefined): string[] {
  return [
    displayValue('model', form),
    ...(webSearch ? [FIELD_LABEL.webSearch()] : []),
    ...(form.knowledgeBaseIds.length ? [setLine('knowledgeBases', form)] : []),
    ...(form.mcps.length ? [setLine('mcpServers', form)] : [])
  ].slice(0, 3)
}

function setLine(field: SummaryField, form: AgentFormState): string {
  return t('agent.config_tool.summary.set', { field: FIELD_LABEL[field](), value: displayValue(field, form) })
}

function toOutput(agent: AgentEntity, summary: string[]): AgentConfigToolOutput {
  return {
    ok: true,
    kind: 'agent',
    agentId: agent.id,
    name: agent.name,
    emoji: agent.configuration?.avatar || DEFAULT_AGENT_CREATE_AVATAR,
    description: agent.description ?? '',
    summary
  }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function resolveDefaultModel(fallbackModel: string | undefined, target: ModelTarget): UniqueModelId {
  const preferred = application.get('PreferenceService').get('chat.default_model_id')
  const model = tryResolveModel(preferred, target) ?? tryResolveModel(fallbackModel, target)
  if (!model) throw new Error("Neither the default model nor this Agent's model can be used. Pass 'model' explicitly.")
  return model
}

function planAgentCreate(input: z.infer<typeof CreateAgentToolInputSchema>, fallbackModel: string | undefined) {
  const caps = AGENT_RUNTIME_CAPABILITIES[NEW_AGENT_TYPE]
  const blank = buildInitialAgentFormState()
  const form = applySettingsInput(blank, input, NEW_AGENT_TYPE, { creating: true })
  const model = form.model || resolveDefaultModel(fallbackModel, NEW_AGENT_TYPE)
  const created: AgentFormState = {
    ...form,
    model,
    permissionMode: form.permissionMode || caps.createDefaults.permissionMode,
    avatar: form.avatar || DEFAULT_AGENT_CREATE_AVATAR
  }
  return { blank, created, model }
}

/**
 * Create a Pi Durable Agent from tool input.
 * @param fallbackModel the calling Agent's model, used when the default model cannot run the new Agent
 */
export async function createAgentFromTool(
  input: z.infer<typeof CreateAgentToolInputSchema>,
  { fallbackModel }: { fallbackModel?: string } = {}
): Promise<AgentConfigToolOutput> {
  const { blank, created, model } = planAgentCreate(input, fallbackModel)

  const agent = await createAgent(
    buildCreateAgentCommand({
      agentType: NEW_AGENT_TYPE,
      permissionMode: normalizePermissionMode(created.permissionMode),
      avatar: created.avatar,
      name: created.name,
      modelId: model,
      description: created.description,
      prompt: created.instructions,
      knowledgeBaseIds: created.knowledgeBaseIds,
      skillIds: created.skillIds,
      mcpServerIds: created.mcps,
      disabledTools: created.disabledTools,
      agentSettings: {
        languageMode: created.languageMode,
        languageCustom: created.languageCustom,
        heartbeatEnabled: created.heartbeatEnabled,
        heartbeatInterval: created.heartbeatInterval,
        heartbeatTimeoutMinutes: created.heartbeatTimeoutMinutes,
        envVarsText: ''
      }
    })
  )
  return { ...toOutput(agent, describeCreated(blank, created)), highlights: agentHighlights(created) }
}

/**
 * Create an Assistant from tool input.
 * @param fallbackModel the calling Agent's model, used when the default model cannot chat
 */
function planAssistantCreate(input: z.infer<typeof CreateAssistantToolInputSchema>, fallbackModel: string | undefined) {
  const knowledgeBaseIds = unique(input.knowledgeBaseIds ?? [])
  const mcpServerIds = unique(input.mcpServerIds ?? [])
  assertKnownIds('knowledge base', knowledgeBaseIds, listKnowledgeBaseCatalog())
  assertKnownIds('MCP server', mcpServerIds, listMcpServerCatalog([]))
  const replyLanguage = input.language === undefined ? undefined : parseLanguage(input.language)
  const modelId = input.model ? resolveModel(input.model, 'assistant') : resolveDefaultModel(fallbackModel, 'assistant')
  const emoji = (input.emoji && toAvatarEmoji(input.emoji)) || DEFAULT_ASSISTANT_CREATE_AVATAR
  // Assistant fields shown in the Agent form's shape, so both share one summary formatter.
  const form: AgentFormState = {
    ...buildInitialAgentFormState(),
    model: modelId,
    instructions: input.prompt.trim(),
    knowledgeBaseIds,
    mcps: mcpServerIds,
    languageMode: replyLanguage?.mode ?? 'off',
    languageCustom: replyLanguage?.mode === 'custom' ? replyLanguage.language : ''
  }
  return { knowledgeBaseIds, mcpServerIds, replyLanguage, modelId, emoji, form }
}

export function createAssistantFromTool(
  input: z.infer<typeof CreateAssistantToolInputSchema>,
  { fallbackModel }: { fallbackModel?: string } = {}
): AssistantCreateToolOutput {
  const { knowledgeBaseIds, mcpServerIds, replyLanguage, modelId, emoji, form } = planAssistantCreate(
    input,
    fallbackModel
  )
  const assistant = assistantDataService.create(
    buildCreateAssistantDto({
      avatar: emoji,
      name: input.name.trim(),
      modelId,
      description: input.description?.trim() ?? '',
      prompt: input.prompt.trim(),
      knowledgeBaseIds,
      mcpServerIds,
      enableWebSearch: input.webSearch,
      replyLanguage
    }),
    // A create from a conversation goes to the top of the list, where the user can see it.
    { position: 'first' }
  )
  // The renderer refreshes its own creates; one made in main must announce itself to the lists.
  assistantDataService.notifyReadModelChange([assistant.id], 'membership')

  const summary = [
    setLine('model', form),
    setLine('instructions', form),
    ...(knowledgeBaseIds.length ? [setLine('knowledgeBases', form)] : []),
    ...(mcpServerIds.length ? [setLine('mcpServers', form)] : []),
    ...(input.webSearch ? [setLine('webSearch', form)] : []),
    ...(replyLanguage ? [setLine('language', form)] : [])
  ]
  return {
    ok: true,
    kind: 'assistant',
    assistantId: assistant.id,
    name: assistant.name,
    emoji: assistant.emoji || DEFAULT_ASSISTANT_CREATE_AVATAR,
    description: assistant.description ?? '',
    summary,
    highlights: assistantHighlights(form, input.webSearch)
  }
}

/** The model of the Agent that owns the Session, which a create falls back to like the tool does. */
/** The fallback each server's create tools use: Cherry Assistant's captures the session's model, cherry-tools the Agent's. */
function callerModel(sessionId: string, serverPart: string): string | undefined {
  const session = agentSessionService.getById(sessionId)
  const agentModel = session.agentId ? agentService.getAgent(session.agentId)?.model : undefined
  return (serverPart === 'assistant' ? (session.model ?? agentModel) : agentModel) || undefined
}

function planAgentUpdate(agentId: string, input: SettingsInput, { self }: { self: boolean }) {
  const agent = agentService.getAgent(agentId)
  if (!agent) throw new Error(`Agent not found: ${agentId}`)
  if (isProtectedBuiltinAgentRole(agent.configuration?.builtin_role)) {
    throw new Error(
      self
        ? 'Built-in Agents cannot change these settings from a conversation. Only the status, rename, channel and bootstrap config actions are available.'
        : `"${agent.name}" is a built-in Agent and cannot be changed with this tool.`
    )
  }
  const skillIds = agentGlobalSkillService
    .list({ agentId })
    .filter((skill) => skill.isEnabled)
    .map((skill) => skill.id)
  const loaded = buildInitialAgentFormState(agent, skillIds)
  // An uploaded image is the avatar the user sees; the stored emoji is only its fallback.
  const baseline = agent.avatarFileId ? { ...loaded, avatar: t('agent.config_tool.value.uploaded_image') } : loaded
  const next = applySettingsInput(baseline, input, agent.type, { creating: false })
  const diff = diffAgentUpdate(baseline, next)
  if (!diff) throw new Error('Nothing to change: every given value matches the current setting.')
  return {
    dto: diff.dto,
    summary: [...describeChanges(baseline, next), ...reasoningEffortChange(agent, baseline, next)],
    details: fullTextChanges(baseline, next),
    replaceAvatarImage: Boolean(agent.avatarFileId) && next.avatar !== baseline.avatar
  }
}

/**
 * What a pending create or update would do, for its approval card: the new resource's identity, or
 * `field: current → new` lines. Writes nothing, and reads the call from the approval itself so the
 * preview always matches what approving runs.
 */
export function previewAgentConfigChange(approvalId: string): AgentConfigChangePreview {
  const preview = buildAgentConfigChangePreview(approvalId)
  for (const id of shownUpdatePreviews.keys()) if (!toolApprovalRegistry.peek(id)) shownUpdatePreviews.delete(id)
  if (preview.ok && preview.summary) shownUpdatePreviews.set(approvalId, JSON.stringify(preview))
  return preview
}

/** What each settings-change card showed, keyed by approval, so Allow can be checked against it. */
const shownUpdatePreviews = new Map<string, string>()

/**
 * Turns an Allow into a refusal when the Agent changed after its card was previewed, so the card no longer shows
 * what approving would write; the model is told to ask again with a fresh card.
 */
export function refuseOutdatedAgentConfigApproval<T extends { approvalId: string; approved: boolean; reason?: string }>(
  response: T
): T {
  const shown = shownUpdatePreviews.get(response.approvalId)
  shownUpdatePreviews.delete(response.approvalId)
  if (!response.approved || shown === undefined) return response
  if (JSON.stringify(buildAgentConfigChangePreview(response.approvalId)) === shown) return response
  return {
    ...response,
    approved: false,
    reason:
      'Not applied: the Agent changed after this change was shown for approval. Call the tool again so the user can approve the current change.'
  }
}

function buildAgentConfigChangePreview(approvalId: string): AgentConfigChangePreview {
  const call = toolApprovalRegistry.peekCall(approvalId)
  const name = call && parseFunctionCallToolName(call.toolName)
  const kind = name ? getAgentConfigToolKind(name.serverPart, name.toolPart) : undefined
  if (!call || !name || !kind) return { ok: false }
  try {
    if (kind === 'create_agent' || kind === 'create_assistant') {
      const fallbackModel = callerModel(call.sessionId, name.serverPart)
      if (kind === 'create_agent') {
        const { created } = planAgentCreate(CreateAgentToolInputSchema.parse(call.originalInput), fallbackModel)
        const resource = { kind: 'agent' as const, name: created.name, emoji: created.avatar }
        return {
          ok: true,
          resource: { ...resource, description: created.description, highlights: agentHighlights(created) }
        }
      }
      const input = CreateAssistantToolInputSchema.parse(call.originalInput)
      const { emoji, form } = planAssistantCreate(input, fallbackModel)
      return {
        ok: true,
        resource: {
          kind: 'assistant',
          name: input.name.trim(),
          emoji,
          description: input.description?.trim() ?? '',
          highlights: assistantHighlights(form, input.webSearch)
        }
      }
    }
    if (kind === 'update') {
      const { agentId, ...settings } = UpdateAgentToolInputSchema.parse(call.originalInput)
      const { summary, details } = planAgentUpdate(agentId, settings, { self: false })
      return { ok: true, summary, ...(details.length ? { details } : {}) }
    }
    const { agentId } = agentSessionService.getById(call.sessionId)
    if (!agentId) throw new Error(`Session has no Agent: ${call.sessionId}`)
    const settings = SelfUpdateToolInputSchema.parse(call.originalInput)
    const { summary, details } = planAgentUpdate(agentId, settings, { self: true })
    return { ok: true, summary, ...(details.length ? { details } : {}) }
  } catch (error) {
    // The tool reports the same refusal to the model when it runs; the user sees the raw arguments.
    logger.warn('Agent config preview failed', { approvalId, error })
    return { ok: false }
  }
}

/** Apply a partial settings update to a user-created Agent; built-in Agents are refused. */
export function updateAgentFromTool(
  agentId: string,
  input: SettingsInput,
  options: { self: boolean }
): AgentConfigToolOutput {
  const { dto, summary, replaceAvatarImage } = planAgentUpdate(agentId, input, options)
  const updated = agentService.updateAgent(agentId, dto, { replaceAvatarImage })
  if (!updated) throw new Error(`Agent not found: ${agentId}`)
  return toOutput(updated, summary)
}

/** Structured tool result: the text copy is what a model without structured output reads. */
export function toolOutput(output: AgentConfigToolOutput | AssistantCreateToolOutput) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output }
}
