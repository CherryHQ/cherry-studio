/**
 * Create and configure Agents from a conversation. The one validate-and-apply path behind Cherry
 * Assistant's `create_agent` / `update_agent` and every user-created Agent's `agent_create` /
 * `config_update`, so each entry point accepts the same fields and refuses the same values.
 */

import * as z from 'zod'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { mcpServerService } from '@data/services/McpServerService'
import { modelService } from '@data/services/ModelService'
import { providerService } from '@data/services/ProviderService'
import { t } from '@main/i18n'
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
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'
import { normalizePiDisabledToolId } from '@shared/ai/piBuiltinTools'
import {
  type AgentEntity,
  type AgentPermissionMode,
  AgentPermissionModeSchema,
  type AgentType
} from '@shared/data/api/schemas/agents'
import { AgentLanguageSchema } from '@shared/data/types/agentLanguage'
import { parseUniqueModelId, type UniqueModelId, UniqueModelIdSchema } from '@shared/data/types/model'
import { toAvatarEmoji } from '@shared/utils/emoji'
import { isBrowserMcpServer } from '@shared/utils/mcp'

import { createAgent } from './createAgent'

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
    'default asks before acting, acceptEdits accepts file edits, auto approves routine actions. bypassPermissions is never accepted here.'
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

export const AgentConfigToolOutputSchema = z.object({
  ok: z.literal(true),
  agentId: z.string(),
  name: z.string(),
  emoji: z.string(),
  description: z.string(),
  /** What was set (create) or `field: current → new` (update), in the app language. */
  summary: z.array(z.string())
})
export type AgentConfigToolOutput = z.infer<typeof AgentConfigToolOutputSchema>

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

function resolveModel(raw: string, agentType: AgentType): UniqueModelId {
  const parsed = UniqueModelIdSchema.safeParse(raw.trim())
  if (!parsed.success) throw new Error(`'model' must be in the form "providerId::modelId" (got "${raw}").`)
  const { providerId, modelId } = parseUniqueModelId(parsed.data)
  let model: ReturnType<typeof modelService.getByKey>
  let provider: ReturnType<typeof providerService.getByProviderId>
  try {
    model = modelService.getByKey(providerId, modelId)
    provider = providerService.getByProviderId(providerId)
  } catch {
    throw new Error(`Model is not configured in Cherry Studio: ${parsed.data}`)
  }
  if (!model.isEnabled || !provider.isEnabled) throw new Error(`Model is disabled in Cherry Studio: ${parsed.data}`)
  const isCompatible = AGENT_RUNTIME_CAPABILITIES[agentType].isModelCompatible
  if (isCompatible && !isCompatible(provider, model)) {
    throw new Error(`Model ${parsed.data} cannot run a ${agentType} Agent. Choose another model.`)
  }
  return parsed.data
}

function tryResolveModel(raw: string | null | undefined, agentType: AgentType): UniqueModelId | undefined {
  if (!raw) return undefined
  try {
    return resolveModel(raw, agentType)
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
    const value = input.language.trim()
    if (value === 'inherit' || value === 'off') {
      patch.languageMode = value
      patch.languageCustom = ''
    } else {
      const parsed = AgentLanguageSchema.safeParse(value)
      if (!parsed.success)
        throw new Error(`'language' must be "inherit", "off", or a single-line label of up to 50 characters.`)
      patch.languageMode = 'custom'
      patch.languageCustom = parsed.data
    }
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
  | 'permissionMode'
  | 'skills'
  | 'knowledgeBases'
  | 'mcpServers'
  | 'disabledTools'
  | 'language'
  | 'heartbeat'

const SUMMARY_FIELDS: readonly SummaryField[] = [
  'avatar',
  'name',
  'description',
  'instructions',
  'model',
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
  permissionMode: () => t('agent.config_tool.field.permission_mode'),
  skills: () => t('agent.config_tool.field.skills'),
  knowledgeBases: () => t('agent.config_tool.field.knowledge_bases'),
  mcpServers: () => t('agent.config_tool.field.mcp_servers'),
  disabledTools: () => t('agent.config_tool.field.disabled_tools'),
  language: () => t('agent.config_tool.field.language'),
  heartbeat: () => t('agent.config_tool.field.heartbeat')
}

const PERMISSION_LABEL: Record<AgentPermissionMode, () => string> = {
  default: () => t('agent.config_tool.permission.default'),
  acceptEdits: () => t('agent.config_tool.permission.accept_edits'),
  plan: () => t('agent.config_tool.permission.plan'),
  auto: () => t('agent.config_tool.permission.auto'),
  bypassPermissions: () => t('agent.config_tool.permission.bypass_permissions')
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
      return form.heartbeatEnabled ? [form.heartbeatInterval, form.heartbeatTimeoutMinutes] : false
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

function displayValue(field: SummaryField, form: AgentFormState): string {
  switch (field) {
    case 'avatar':
      return form.avatar || t('agent.config_tool.value.none')
    case 'name':
    case 'description':
    case 'instructions':
      return shortText(form[field])
    case 'model': {
      if (!form.model) return t('agent.config_tool.value.none')
      const { providerId, modelId } = parseUniqueModelId(form.model)
      return safeName(() => modelService.getByKey(providerId, modelId)) ?? form.model
    }
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
    case 'heartbeat':
      return form.heartbeatEnabled
        ? t('agent.config_tool.value.heartbeat_on', {
            minutes: form.heartbeatInterval,
            timeout: form.heartbeatTimeoutMinutes
          })
        : t('agent.config_tool.value.heartbeat_off')
  }
}

function isChanged(field: SummaryField, before: AgentFormState, after: AgentFormState): boolean {
  return JSON.stringify(rawValue(field, before)) !== JSON.stringify(rawValue(field, after))
}

function describeChanges(before: AgentFormState, after: AgentFormState): string[] {
  return SUMMARY_FIELDS.filter((field) => isChanged(field, before, after)).map((field) =>
    t('agent.config_tool.summary.change', {
      field: FIELD_LABEL[field](),
      from: displayValue(field, before),
      to: displayValue(field, after)
    })
  )
}

/** The card already shows the avatar, name and description; model and permission always matter. */
function describeCreated(blank: AgentFormState, created: AgentFormState): string[] {
  return SUMMARY_FIELDS.filter(
    (field) =>
      field === 'model' ||
      field === 'permissionMode' ||
      (field !== 'avatar' && field !== 'name' && field !== 'description' && isChanged(field, blank, created))
  ).map((field) =>
    t('agent.config_tool.summary.set', { field: FIELD_LABEL[field](), value: displayValue(field, created) })
  )
}

function toOutput(agent: AgentEntity, summary: string[]): AgentConfigToolOutput {
  return {
    ok: true,
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

function resolveDefaultModel(fallbackModel: string | undefined): UniqueModelId {
  const preferred = application.get('PreferenceService').get('chat.default_model_id')
  const model = tryResolveModel(preferred, NEW_AGENT_TYPE) ?? tryResolveModel(fallbackModel, NEW_AGENT_TYPE)
  if (!model) throw new Error(`No default model can run a ${NEW_AGENT_TYPE} Agent. Pass 'model' explicitly.`)
  return model
}

/**
 * Create a Pi Durable Agent from tool input.
 * @param fallbackModel the calling Agent's model, used when the default model cannot run the new Agent
 */
export async function createAgentFromTool(
  input: z.infer<typeof CreateAgentToolInputSchema>,
  { fallbackModel }: { fallbackModel?: string } = {}
): Promise<AgentConfigToolOutput> {
  const caps = AGENT_RUNTIME_CAPABILITIES[NEW_AGENT_TYPE]
  const blank = buildInitialAgentFormState()
  const form = applySettingsInput(blank, input, NEW_AGENT_TYPE, { creating: true })
  const model = form.model || resolveDefaultModel(fallbackModel)
  const created: AgentFormState = {
    ...form,
    model,
    permissionMode: form.permissionMode || caps.createDefaults.permissionMode,
    avatar: form.avatar || DEFAULT_AGENT_CREATE_AVATAR
  }

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
  return toOutput(agent, describeCreated(blank, created))
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
  const baseline = buildInitialAgentFormState(agent, skillIds)
  const next = applySettingsInput(baseline, input, agent.type, { creating: false })
  const diff = diffAgentUpdate(baseline, next)
  if (!diff) throw new Error('Nothing to change: every given value matches the current setting.')
  return { dto: diff.dto, summary: describeChanges(baseline, next) }
}

/** The `field: current → new` lines a pending update would apply, for its approval card. Writes nothing. */
export function previewAgentConfigUpdate(
  request: { tool: 'update_agent'; input: unknown } | { tool: 'config_update'; sessionId: string; input: unknown }
): { ok: true; summary: string[] } | { ok: false; error: string } {
  try {
    if (request.tool === 'update_agent') {
      const { agentId, ...settings } = UpdateAgentToolInputSchema.parse(request.input)
      return { ok: true, summary: planAgentUpdate(agentId, settings, { self: false }).summary }
    }
    const { agentId } = agentSessionService.getById(request.sessionId)
    if (!agentId) throw new Error(`Session has no Agent: ${request.sessionId}`)
    const settings = SelfUpdateToolInputSchema.parse(request.input)
    return { ok: true, summary: planAgentUpdate(agentId, settings, { self: true }).summary }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Apply a partial settings update to a user-created Agent; built-in Agents are refused. */
export function updateAgentFromTool(
  agentId: string,
  input: SettingsInput,
  options: { self: boolean }
): AgentConfigToolOutput {
  const { dto, summary } = planAgentUpdate(agentId, input, options)
  const updated = agentService.updateAgent(agentId, dto)
  if (!updated) throw new Error(`Agent not found: ${agentId}`)
  return toOutput(updated, summary)
}

/** Structured tool result: the text copy is what a model without structured output reads. */
export function toolOutput(output: AgentConfigToolOutput) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(output) }], structuredContent: output }
}
