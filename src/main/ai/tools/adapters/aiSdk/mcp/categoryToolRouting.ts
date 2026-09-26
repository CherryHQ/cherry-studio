// Keeps the MCP tool set a request carries proportional to what the request is actually about.
//
// Every tool an assistant exposes is re-sent, schema and all, on every step of every turn — a
// dozen servers in `auto` mode is thousands of tokens before the user has said anything. On a free
// tier that is the difference between a day's quota and an hour's. This ranks the available tools
// by how well they match the request's category and keeps the best `TOOL_BUDGET` of them.
//
// Deliberately a cap, never a filter: a request whose category matches nothing still gets tools,
// just in arbitrary order. Same principle as `routeDefaultModelId` — routing is an optimisation,
// so a misclassification may cost a few wasted slots but can never take a capability away outright.

import type { UIMessage } from 'ai'

import { application } from '@application'
import { loggerService } from '@logger'
import type { TaskCategory } from '@shared/data/preference/preferenceTypes'
import { classifyTaskCategory } from '@shared/utils/taskCategory'

const logger = loggerService.withContext('CategoryToolRouting')

/**
 * How many MCP tools may ride along on a request. Chosen from what a turn actually uses: past the
 * low twenties a model's tool choice gets worse, not better, and every extra schema is paid for on
 * every step. Sets at or below this are passed through untouched.
 */
const TOOL_BUDGET = 24

/**
 * Words that mark a tool as belonging to a category, matched against the server and tool slugs
 * inside a wire id. English only on purpose: `buildMcpToolWireId` slugs non-ASCII names away, so
 * the ids are always ASCII even when the request that selects them is Turkish.
 *
 * `think|plan|reason|sequential` counts for both code and research: a planning tool is what stops a
 * weak free model from charging at a whole project in one step, which is most of what makes the
 * cheap tier feel like the expensive one. Matched on the *server* slug too, so a tool whose own name
 * says nothing (`@cherry/sequentialthinking`'s single tool) is still recognised.
 */
const CATEGORY_TOOL_SIGNALS: Partial<Record<TaskCategory, RegExp>> = {
  code: /file|dir|path|read|write|edit|create|fs|terminal|shell|command|exec|bash|git|repo|code|lint|test|npm|desktop|commander|think|plan|reason|sequential/,
  research:
    /search|fetch|web|browse|crawl|scrape|url|http|page|tavily|brave|exa|jina|wiki|news|google|bing|duckduck|think|plan|reason|sequential/,
  image: /image|img|paint|draw|flux|diffusion|pollination|fal|render|photo|picture|visual/,
  writing: /doc|note|notion|obsidian|memo|translate|text|write|markdown/
}

/** `mcp__{server}__{tool}_{digest}` — the slugs are what a keyword can be matched against. */
function slugsOf(toolId: string): string {
  return toolId
    .replace(/^mcp__/, '')
    .replace(/_[0-9a-f]{20}$/, '')
    .toLowerCase()
}

/** Text of the last user turn; that is what the tools for *this* step have to serve. */
export function lastUserPromptText(messages: readonly UIMessage[] | undefined): string {
  if (!messages?.length) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'user') continue
    return message.parts
      .filter((part): part is { type: 'text'; text: string } => part.type === 'text' && 'text' in part)
      .map((part) => part.text)
      .join(' ')
  }
  return ''
}

/**
 * Ranks `toolIds` by fitness for the request and cuts the tail beyond `TOOL_BUDGET`. Returns the
 * input unchanged when routing is off, when the set already fits, or when anything goes wrong.
 */
export function routeMcpToolIds(toolIds: readonly string[], promptText: string): string[] {
  if (toolIds.length <= TOOL_BUDGET) return [...toolIds]

  try {
    if (!application.get('PreferenceService').get('chat.routing.auto_enabled')) return [...toolIds]

    const category = classifyTaskCategory(promptText)
    const signal = CATEGORY_TOOL_SIGNALS[category]
    // Nothing to rank by (a 'general' request, say): cap without reordering, so the budget still
    // holds and the set stays stable across turns instead of shuffling on every message.
    if (!signal) return toolIds.slice(0, TOOL_BUDGET)

    // Stable partition rather than a sort: ties keep the order the catalog gave them, so a request
    // that matches nothing new does not silently swap out the tools the last step was using.
    const matched: string[] = []
    const rest: string[] = []
    for (const toolId of toolIds) (signal.test(slugsOf(toolId)) ? matched : rest).push(toolId)

    const chosen = [...matched, ...rest].slice(0, TOOL_BUDGET)
    logger.info('capped the MCP tool set for this request', {
      category,
      available: toolIds.length,
      matched: matched.length,
      kept: chosen.length
    })
    return chosen
  } catch (error) {
    logger.warn('tool routing failed, sending every available tool', { error })
    return [...toolIds]
  }
}
