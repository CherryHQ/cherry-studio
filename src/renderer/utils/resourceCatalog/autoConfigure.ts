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
 * The creator skill: turns a name and an optional purpose into a complete Agent / Assistant
 * configuration. The reply is parsed by {@link parseAutoConfigDraft}.
 */
export const RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT = [
  'You configure a new AI assistant or agent in Cherry Studio from the name the user gave and, when given, the purpose they describe.',
  'Reply with exactly one JSON object and nothing else — no Markdown, no code fences, no commentary.',
  '',
  'Fields:',
  '- "name": a short display name (2-24 characters). If the user gave a preferred name, use it unchanged.',
  '- "emoji": exactly one emoji that represents the role. Never use a flag or 🤖.',
  '- "description": one sentence that tells the user what it does.',
  '- "prompt": a complete system prompt in Markdown: role, goals, working style, and boundaries.',
  '- "knowledgeBaseIds": ids of listed knowledge bases that clearly match the purpose, otherwise [].',
  '- "mcpServerIds": ids of listed MCP servers that the purpose clearly needs, otherwise [].',
  '- Agent only — "permissionMode": one of the listed permission modes. Prefer "default" when the purpose only reads or advises.',
  '- Assistant only — "enableWebSearch": true only when the purpose needs current or online information.',
  '- Agent only — "skillIds": ids of listed skills that clearly help with the purpose, otherwise [].',
  '',
  'Rules:',
  '- Write the fields in the order listed above.',
  '- Only use ids that appear in the lists; never invent ids.',
  '- When the purpose is (none), infer the role from the name.',
  '- Write "name", "description" and "prompt" in the same language as the purpose, or as the name when there is no purpose.'
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
    `Purpose: ${purpose.trim() || NONE}`,
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

/** How far a streamed auto-config reply has got, read from its JSON before it is complete. */
export type AutoConfigProgress = {
  /** The system prompt written so far. */
  prompt: string
  promptDone: boolean
  /** MCP servers, plus the permission mode (Agent) or web search (Assistant). */
  tools: { done: boolean; mcpServerIds: string[]; permissionMode?: string; enableWebSearch?: boolean }
  /** Agent only. */
  skills: { done: boolean; skillIds: string[] }
}

const keyPattern = (key: string, opener: string) => new RegExp(`"${key}"\\s*:\\s*${opener}`)

/** A JSON string value, as far as it has been written; drops a trailing half-written escape. */
function readStringValue(text: string, key: string): { value: string; closed: boolean } | undefined {
  const match = keyPattern(key, '"').exec(text)
  if (!match) return undefined
  const start = match.index + match[0].length
  let end = start
  while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
  const closed = end < text.length
  const raw = text.slice(start, Math.min(end, text.length))
  // An unclosed value may end mid-escape (`\\`, `\\u00`); the longest prefix that parses is what is written.
  for (let cut = 0; cut <= 5 && cut <= raw.length; cut++) {
    try {
      return { value: JSON.parse(`"${raw.slice(0, raw.length - cut)}"`) as string, closed }
    } catch {
      // Keep trimming.
    }
  }
  return { value: raw, closed }
}

/** The complete string items of a JSON array value, and whether the array has closed. */
function readStringArray(text: string, key: string): { items: string[]; closed: boolean } | undefined {
  const match = keyPattern(key, '\\[').exec(text)
  if (!match) return undefined
  const rest = text.slice(match.index + match[0].length)
  const close = rest.indexOf(']')
  const body = close < 0 ? rest : rest.slice(0, close)
  const items = [...body.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(([, item]) => {
    try {
      return JSON.parse(`"${item}"`) as string
    } catch {
      return item
    }
  })
  return { items, closed: close >= 0 }
}

/** Reads a partial reply from {@link RESOURCE_AUTO_CONFIG_SYSTEM_PROMPT}, whose fields arrive in order. */
export function readAutoConfigProgress(text: string, kind: AutoConfigKind): AutoConfigProgress {
  const prompt = readStringValue(text, 'prompt')
  const mcp = readStringArray(text, 'mcpServerIds')
  const skills = readStringArray(text, 'skillIds')
  const permission = readStringValue(text, 'permissionMode')
  const webSearch = /"enableWebSearch"\s*:\s*(true|false)/.exec(text)?.[1]
  const toolsDone = kind === 'agent' ? Boolean(permission?.closed || skills) : webSearch !== undefined
  return {
    prompt: prompt?.value ?? '',
    promptDone: prompt?.closed ?? false,
    tools: {
      done: toolsDone,
      mcpServerIds: mcp?.items ?? [],
      ...(permission?.closed ? { permissionMode: permission.value } : {}),
      ...(webSearch === undefined ? {} : { enableWebSearch: webSearch === 'true' })
    },
    skills: { done: skills?.closed ?? false, skillIds: skills?.items ?? [] }
  }
}
