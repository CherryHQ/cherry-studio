import type { HubTool, ListInput } from './types'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const MAX_RESULTS_HARD_LIMIT = 200

export type ListResult = {
  tools: HubTool[]
  total: number
}

export function listTools(tools: HubTool[], input: ListInput): ListResult {
  const query = typeof input.query === 'string' ? input.query : ''
  const server = typeof input.server === 'string' ? input.server : ''

  const limitRaw = typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : DEFAULT_LIMIT
  const limit = Math.min(Math.max(1, limitRaw), MAX_LIMIT)

  const keywords = query
    .toLowerCase()
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)

  const matched: HubTool[] = []
  let total = 0

  for (const tool of tools) {
    if (server && tool.serverId.toLowerCase() !== server.toLowerCase()) {
      continue
    }

    if (!matchesKeywords(tool, keywords)) {
      continue
    }

    total += 1
    if (matched.length >= MAX_RESULTS_HARD_LIMIT) {
      continue
    }
    matched.push(tool)
  }

  const ranked = keywords.length > 0 ? rankTools(matched, keywords) : matched

  return {
    tools: ranked.slice(0, limit),
    total
  }
}

function matchesKeywords(tool: HubTool, keywords: string[]): boolean {
  if (keywords.length === 0) {
    return true
  }

  const haystack =
    `${tool.jsName} ${tool.id} ${tool.serverId} ${tool.serverName} ${tool.toolName} ${tool.description ?? ''}`
      .toLowerCase()
      .trim()

  return keywords.some((kw) => haystack.includes(kw))
}

function rankTools(tools: HubTool[], keywords: string[]): HubTool[] {
  const scored = tools.map((tool) => ({ tool, score: calculateScore(tool, keywords) }))
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.tool)
}

function calculateScore(tool: HubTool, keywords: string[]): number {
  const jsName = tool.jsName.toLowerCase()
  const id = tool.id.toLowerCase()
  const description = (tool.description ?? '').toLowerCase()

  let score = 0

  for (const keyword of keywords) {
    if (jsName === keyword) score += 10
    else if (jsName.startsWith(keyword)) score += 5
    else if (jsName.includes(keyword)) score += 3

    if (id.includes(keyword)) score += 2

    if (description.includes(keyword)) score += 1
  }

  return score
}

export function formatListResultAsText(tools: HubTool[], total: number): string {
  if (tools.length === 0) {
    return 'No tools available'
  }

  const lines: string[] = []
  lines.push(`Total: ${total} tools${total > tools.length ? ` (showing first ${tools.length})` : ''}`)
  lines.push('')

  for (const tool of tools) {
    const desc = truncateDescription(tool.description || tool.jsName, 50)
    // Include original id to make it unambiguous and easy to fall back to.
    lines.push(`- ${tool.jsName} (${tool.id}): ${desc}`)
  }

  return lines.join('\n')
}

function truncateDescription(s: string, maxWords: number): string {
  if (maxWords <= 0) return ''
  const words = s.trim().split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return words.join(' ')
  return `${words.slice(0, maxWords).join(' ')}…`
}
