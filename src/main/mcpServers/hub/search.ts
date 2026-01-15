import { generateToolsCode } from './generator'
import type { GeneratedTool, SearchQuery, SearchResult } from './types'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export function searchTools(tools: GeneratedTool[], query: SearchQuery): SearchResult {
  const { query: queryStr, limit = DEFAULT_LIMIT } = query
  const effectiveLimit = Math.min(Math.max(1, limit), MAX_LIMIT)

  const keywords = queryStr
    .toLowerCase()
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0)

  if (keywords.length === 0) {
    const sliced = tools.slice(0, effectiveLimit)
    return {
      tools: generateToolsCode(sliced),
      total: tools.length
    }
  }

  const matchedTools = tools.filter((tool) => {
    const searchText = buildSearchText(tool).toLowerCase()
    return keywords.some((keyword) => searchText.includes(keyword))
  })

  const rankedTools = rankTools(matchedTools, keywords)
  const sliced = rankedTools.slice(0, effectiveLimit)

  return {
    tools: generateToolsCode(sliced),
    total: matchedTools.length
  }
}

function buildSearchText(tool: GeneratedTool): string {
  const combinedName = tool.serverName ? `${tool.serverName}_${tool.toolName}` : tool.toolName
  const parts = [
    tool.toolName,
    tool.functionName,
    tool.serverName,
    combinedName,
    tool.description || '',
    tool.signature
  ]
  return parts.join(' ')
}

function rankTools(tools: GeneratedTool[], keywords: string[]): GeneratedTool[] {
  const scored = tools.map((tool) => ({
    tool,
    score: calculateScore(tool, keywords)
  }))

  scored.sort((a, b) => b.score - a.score)

  return scored.map((s) => s.tool)
}

function calculateScore(tool: GeneratedTool, keywords: string[]): number {
  let score = 0
  const toolName = tool.toolName.toLowerCase()
  const serverName = (tool.serverName || '').toLowerCase()
  const functionName = tool.functionName.toLowerCase()
  const description = (tool.description || '').toLowerCase()

  for (const keyword of keywords) {
    // Match tool name
    if (toolName === keyword) {
      score += 10
    } else if (toolName.startsWith(keyword)) {
      score += 5
    } else if (toolName.includes(keyword)) {
      score += 3
    }

    // Match server name
    if (serverName === keyword) {
      score += 8
    } else if (serverName.startsWith(keyword)) {
      score += 4
    } else if (serverName.includes(keyword)) {
      score += 2
    }

    // Match function name (serverName_toolName format)
    if (functionName === keyword) {
      score += 10
    } else if (functionName.startsWith(keyword)) {
      score += 5
    } else if (functionName.includes(keyword)) {
      score += 3
    }

    if (description.includes(keyword)) {
      const count = (description.match(new RegExp(escapeRegex(keyword), 'g')) || []).length
      score += Math.min(count, 3)
    }
  }

  return score
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
