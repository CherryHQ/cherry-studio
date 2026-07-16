import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'

import { type NeutralTool, type NeutralToolResult, ToolError, ToolErrorCode } from './types'

const logger = loggerService.withContext('AgentTools:Memory')

/** Per-session context the workspace-memory tool operates on. */
export interface MemoryToolContext {
  agentId: string
  workspacePath: string
}

/**
 * Resolve a filename within a directory using case-insensitive matching.
 * Returns the full path if found (preferring exact match), or the canonical path as fallback.
 */
async function resolveFileCI(dir: string, name: string): Promise<string> {
  const exact = path.join(dir, name)
  try {
    await stat(exact)
    return exact
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Unexpected error checking file', { path: exact, error: (err as Error).message })
    }
    // exact match not found, try case-insensitive
  }

  try {
    const entries = await readdir(dir)
    const target = name.toLowerCase()
    const match = entries.find((e) => e.toLowerCase() === target)
    return match ? path.join(dir, match) : exact
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Unexpected error reading directory', { dir, error: (err as Error).message })
    }
    return exact
  }
}

type JournalEntry = {
  ts: string
  tags: string[]
  text: string
}

const MEMORY_INPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['update', 'append', 'search'],
      description:
        "Action to perform: 'update' overwrites FACT.md (durable knowledge only), 'append' adds a JOURNAL entry, 'search' queries the journal"
    },
    content: {
      type: 'string',
      description: 'Full markdown content for FACT.md (required for update)'
    },
    text: {
      type: 'string',
      description: 'Journal entry text (required for append)'
    },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for the journal entry (optional, for append)'
    },
    query: {
      type: 'string',
      description: 'Search query — case-insensitive substring match (for search)'
    },
    tag: {
      type: 'string',
      description: 'Filter by tag (optional, for search)'
    },
    limit: {
      type: 'integer',
      description: 'Max results to return (default 20, for search)'
    }
  },
  required: ['action']
}

/**
 * Deliberate existence check: memory writes must stop once the owning agent is gone.
 */
function getWorkspacePath(ctx: MemoryToolContext): string {
  const agent = agentService.getAgent(ctx.agentId)
  if (!agent) throw new ToolError(`Agent not found: ${ctx.agentId}`, ToolErrorCode.InternalError)
  return ctx.workspacePath
}

async function memoryUpdate(args: Record<string, unknown>, ctx: MemoryToolContext): Promise<NeutralToolResult> {
  const content = args.content as string | undefined
  if (!content) throw new ToolError("'content' is required for update action", ToolErrorCode.InvalidParams)

  const workspace = getWorkspacePath(ctx)
  const memoryDir = path.join(workspace, 'memory')
  const factPath = await resolveFileCI(memoryDir, 'FACT.md')

  await mkdir(memoryDir, { recursive: true })

  // Atomic write via temp file + rename
  const tmpPath = `${factPath}.${Date.now()}.tmp`
  await writeFile(tmpPath, content, 'utf-8')
  await rename(tmpPath, factPath)

  logger.info('Memory FACT.md updated via tool', { agentId: ctx.agentId, length: content.length })
  return {
    content: [{ type: 'text', text: 'Memory updated.' }]
  }
}

async function memoryAppend(args: Record<string, unknown>, ctx: MemoryToolContext): Promise<NeutralToolResult> {
  const text = args.text as string | undefined
  if (!text) throw new ToolError("'text' is required for append action", ToolErrorCode.InvalidParams)

  const tags: string[] = []
  const rawTags = args.tags
  if (Array.isArray(rawTags)) {
    for (const item of rawTags) {
      if (typeof item === 'string') tags.push(item)
    }
  }

  const workspace = getWorkspacePath(ctx)
  const memoryDir = path.join(workspace, 'memory')

  await mkdir(memoryDir, { recursive: true })

  const journalPath = await resolveFileCI(memoryDir, 'JOURNAL.jsonl')

  const entry: JournalEntry = {
    ts: new Date().toISOString(),
    tags,
    text
  }

  await appendFile(journalPath, JSON.stringify(entry) + '\n', 'utf-8')

  logger.info('Journal entry appended via tool', { agentId: ctx.agentId, tags })
  return {
    content: [{ type: 'text', text: `Journal entry added at ${entry.ts}.` }]
  }
}

async function memorySearch(args: Record<string, unknown>, ctx: MemoryToolContext): Promise<NeutralToolResult> {
  const query = (args.query as string | undefined) ?? ''
  const tagFilter = (args.tag as string | undefined) ?? ''
  const limit = Math.max(1, parseInt((args.limit as string | undefined) ?? '20', 10) || 20)

  const workspace = getWorkspacePath(ctx)
  const memoryDir = path.join(workspace, 'memory')
  const journalPath = await resolveFileCI(memoryDir, 'JOURNAL.jsonl')

  let fileContent: string
  try {
    fileContent = await readFile(journalPath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: [{ type: 'text', text: 'No journal entries found.' }] }
    }
    throw new Error(`Failed to read journal at ${journalPath}: ${(err as Error).message}`)
  }

  const queryLower = query.toLowerCase()
  const tagLower = tagFilter.toLowerCase()
  const matches: JournalEntry[] = []

  for (const line of fileContent.split('\n')) {
    if (!line.trim()) continue
    let entry: JournalEntry
    try {
      entry = JSON.parse(line)
    } catch {
      logger.warn('Skipping corrupted journal line', { journalPath, line: line.substring(0, 100) })
      continue
    }
    if (tagFilter && !entry.tags?.some((t) => t.toLowerCase() === tagLower)) continue
    if (query && !entry.text.toLowerCase().includes(queryLower)) continue
    matches.push(entry)
  }

  // Return last N entries in reverse-chronological order
  const result = matches.slice(-limit).reverse()

  if (result.length === 0) {
    return { content: [{ type: 'text', text: 'No matching journal entries found.' }] }
  }

  logger.info('Journal search via tool', { agentId: ctx.agentId, query, tag: tagFilter, resultCount: result.length })
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  }
}

/**
 * Cross-session workspace memory tool.
 *
 * Memory lives in the agent's workspace under `memory/` — `FACT.md` for durable
 * knowledge and `JOURNAL.jsonl` for timestamped events. Any agent with a stable
 * workspace benefits from this; the tool itself is a thin, safe wrapper over file
 * operations.
 *
 * Distinct from the built-in knowledge-graph `memory` MCP server, which stores
 * entity/relation graphs in a global JSON file rather than in the agent workspace.
 */
export const memoryTool: NeutralTool<MemoryToolContext> = {
  name: 'memory',
  description:
    "Manage persistent memory in this agent's workspace across sessions. Actions: 'update' overwrites memory/FACT.md (durable knowledge and decisions that should survive across sessions). 'append' logs to memory/JOURNAL.jsonl (one-time events, completed tasks, session notes). 'search' queries the journal. Before writing to FACT.md, ask: will this still matter in 6 months? If not, use append instead.",
  inputSchema: MEMORY_INPUT_SCHEMA,
  handler: (args, ctx) => {
    const action = args.action
    switch (action) {
      case 'update':
        return memoryUpdate(args, ctx)
      case 'append':
        return memoryAppend(args, ctx)
      case 'search':
        return memorySearch(args, ctx)
      default:
        throw new ToolError(`Unknown action "${action}", expected update/append/search`, ToolErrorCode.InvalidParams)
    }
  }
}
