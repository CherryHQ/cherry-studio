import * as z from 'zod'

import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { AgentType } from '@shared/data/types/agent'
import { toAvatarEmoji } from '@shared/utils/emoji'

export type AutoConfigKind = 'assistant' | 'agent'

export type AutoConfigCatalogItem = { id: string; name: string; description?: string | null }

export type AutoConfigCatalogs = {
  /** Installed non-builtin skills; builtins are always enabled for new agents. */
  skills: AutoConfigCatalogItem[]
  knowledgeBases: AutoConfigCatalogItem[]
  /** Installed servers, plus uninstalled configuration-free featured servers under {@link toFeaturedMcpId}. */
  mcpServers: AutoConfigCatalogItem[]
}

const FEATURED_MCP_ID_PREFIX = 'preset:'

/** Stable ID for a featured marketplace MCP server that is not installed yet. */
export const toFeaturedMcpId = (presetName: string) => `${FEATURED_MCP_ID_PREFIX}${presetName}`

/** The preset name behind a {@link toFeaturedMcpId} ID, or `undefined` for an installed server's ID. */
export const getFeaturedMcpName = (id: string) =>
  id.startsWith(FEATURED_MCP_ID_PREFIX) ? id.slice(FEATURED_MCP_ID_PREFIX.length) : undefined

/** A validated configuration that only references resources present in the supplied catalogs. */
export type AutoConfigDraft = {
  name: string
  /** `undefined` when the model's choice was not a single non-flag emoji. */
  emoji?: string
  description: string
  prompt: string
  knowledgeBaseIds: string[]
  mcpServerIds: string[]
  skillIds: string[]
  /** Agent only; always one of the runtime's modes and never `bypassPermissions`. */
  permissionMode?: AgentPermissionMode
  /** Assistant only. */
  enableWebSearch: boolean
}

/**
 * The creator skill: turns a stated purpose into a complete Agent / Assistant
 * configuration. The reply is parsed by {@link parseAutoConfigDraft}.
 */
export const RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT = [
  'You configure a new AI assistant or agent in Cherry Studio from the purpose the user describes.',
  'Reply with exactly one JSON object and nothing else — no Markdown, no code fences, no commentary.',
  '',
  'Fields:',
  '- "name": a short display name (2-24 characters). If the user gave a preferred name, use it unchanged.',
  '- "emoji": exactly one emoji that represents the role. Never use a flag or 🤖.',
  '- "description": one sentence that tells the user what it does.',
  '- "prompt": a complete system prompt in Markdown: role, goals, working style, and boundaries.',
  '- "knowledgeBaseIds": ids of listed knowledge bases that clearly match the purpose, otherwise [].',
  '- "mcpServerIds": ids of listed MCP servers that the purpose clearly needs, otherwise [].',
  '- Agent only — "skillIds": ids of listed skills that clearly help with the purpose, otherwise [].',
  '- Agent only — "permissionMode": one of the listed permission modes. Prefer "default" when the purpose only reads or advises.',
  '- Assistant only — "enableWebSearch": true only when the purpose needs current or online information.',
  '',
  'Rules:',
  '- Only use ids that appear in the lists; never invent ids.',
  '- Write "name", "description" and "prompt" in the same language as the purpose.'
].join('\n')

const NONE = '(none)'

function formatCatalog(items: AutoConfigCatalogItem[]): string {
  if (items.length === 0) return NONE
  return items.map((item) => `- ${item.id}: ${item.name}${item.description ? ` — ${item.description}` : ''}`).join('\n')
}

/** Permission modes auto create may choose; `bypassPermissions` is never offered or accepted. */
export function getAutoConfigPermissionModes(agentType: AgentType): AgentPermissionMode[] {
  return AGENT_RUNTIME_CAPABILITIES[agentType].permissionModes.filter((mode) => mode !== 'bypassPermissions')
}

export function buildAutoConfigInput({
  kind,
  agentType,
  purpose,
  name,
  catalogs
}: {
  kind: AutoConfigKind
  agentType: AgentType
  purpose: string
  name?: string
  catalogs: AutoConfigCatalogs
}): string {
  const sections = [
    `Kind: ${kind}`,
    `Purpose: ${purpose.trim()}`,
    `Preferred name: ${name?.trim() || NONE}`,
    `Knowledge bases:\n${formatCatalog(catalogs.knowledgeBases)}`,
    `MCP servers:\n${formatCatalog(catalogs.mcpServers)}`
  ]
  if (kind === 'agent') {
    sections.push(
      `Skills:\n${formatCatalog(catalogs.skills)}`,
      `Permission modes: ${getAutoConfigPermissionModes(agentType).join(', ')}`
    )
  }
  return sections.join('\n\n')
}

const IdListSchema = z.array(z.string()).catch([])
const DraftSchema = z.object({
  name: z.string(),
  emoji: z.string().optional().catch(undefined),
  description: z.string().catch(''),
  prompt: z.string(),
  knowledgeBaseIds: IdListSchema,
  mcpServerIds: IdListSchema,
  skillIds: IdListSchema,
  permissionMode: z.string().optional().catch(undefined),
  enableWebSearch: z.boolean().catch(false)
})

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

function keepKnown(ids: string[], catalog: AutoConfigCatalogItem[]): string[] {
  const known = new Set(catalog.map((item) => item.id))
  return Array.from(new Set(ids.filter((id) => known.has(id))))
}

/** Returns `null` when the reply is not a usable configuration (no JSON, or no name / prompt). */
export function parseAutoConfigDraft(
  text: string,
  { kind, agentType, catalogs }: { kind: AutoConfigKind; agentType: AgentType; catalogs: AutoConfigCatalogs }
): AutoConfigDraft | null {
  const parsed = DraftSchema.safeParse(extractJsonObject(text))
  if (!parsed.success) return null

  const raw = parsed.data
  const name = raw.name.trim()
  const prompt = raw.prompt.trim()
  if (!name || !prompt) return null

  const isAgent = kind === 'agent'
  const permissionModes = getAutoConfigPermissionModes(agentType)
  const permissionMode = permissionModes.find((mode) => mode === raw.permissionMode)

  return {
    name,
    emoji: toAvatarEmoji(raw.emoji),
    description: raw.description.trim(),
    prompt,
    knowledgeBaseIds: keepKnown(raw.knowledgeBaseIds, catalogs.knowledgeBases),
    mcpServerIds: keepKnown(raw.mcpServerIds, catalogs.mcpServers),
    skillIds: isAgent ? keepKnown(raw.skillIds, catalogs.skills) : [],
    permissionMode: isAgent
      ? (permissionMode ?? AGENT_RUNTIME_CAPABILITIES[agentType].createDefaults.permissionMode)
      : undefined,
    enableWebSearch: !isAgent && raw.enableWebSearch
  }
}
