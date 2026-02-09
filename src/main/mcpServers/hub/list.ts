import type { HubTool, ListInput } from './types'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export type ListResult = {
  tools: HubTool[]
  total: number
  limit: number
  offset: number
}

export function listTools(tools: HubTool[], input: ListInput): ListResult {
  const limitRaw = typeof input.limit === 'number' && Number.isFinite(input.limit) ? input.limit : DEFAULT_LIMIT
  const limit = Math.min(Math.max(1, Math.floor(limitRaw)), MAX_LIMIT)

  const offsetRaw = typeof input.offset === 'number' && Number.isFinite(input.offset) ? input.offset : 0
  const offset = Math.max(0, Math.floor(offsetRaw))

  const total = tools.length
  const sliced = tools.slice(offset, offset + limit)

  return {
    tools: sliced,
    total,
    limit,
    offset
  }
}

export function formatListResultAsText(result: ListResult): string {
  const { tools, total, limit, offset } = result

  if (tools.length === 0) {
    return `Total: ${total} tools\nOffset: ${offset}\nLimit: ${limit}\n\nNo tools available`
  }

  const lines: string[] = []
  lines.push(`Total: ${total} tools`)
  lines.push(`Offset: ${offset}`)
  lines.push(`Limit: ${limit}`)
  lines.push(`Returned: ${tools.length}`)
  lines.push('')

  for (const tool of tools) {
    const desc = truncateDescription(tool.description || tool.jsName, 50)
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
