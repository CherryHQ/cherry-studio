import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { assertAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { isWin } from '@main/core/platform'

import { type NeutralTool, type NeutralToolResult, ToolError, ToolErrorCode } from './types'

const logger = loggerService.withContext('AgentTools:Memory')

export interface MemoryToolContext {
  agentId: string
  agentDataPath: string
}

function withNoFollow(flags: number): number {
  return isWin ? flags : flags | constants.O_NOFOLLOW
}

async function resolveFileCI(dir: string, name: string): Promise<string> {
  const exact = path.join(dir, name)
  try {
    const fileStat = await lstat(exact)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`Agent memory file must be a real file: ${exact}`)
    }
    return exact
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  try {
    const entries = await readdir(dir)
    const match = entries.find((entry) => entry.toLowerCase() === name.toLowerCase())
    if (!match) return exact
    const matchedPath = path.join(dir, match)
    const fileStat = await lstat(matchedPath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`Agent memory file must be a real file: ${matchedPath}`)
    }
    return matchedPath
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('Unexpected error reading directory', { dir, error: (error as Error).message })
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
    content: { type: 'string', description: 'Full markdown content for FACT.md (required for update)' },
    text: { type: 'string', description: 'Journal entry text (required for append)' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tags for the journal entry (optional, for append)'
    },
    query: { type: 'string', description: 'Search query — case-insensitive substring match (for search)' },
    tag: { type: 'string', description: 'Filter by tag (optional, for search)' },
    limit: { type: 'integer', description: 'Max results to return (default 20, for search)' }
  },
  required: ['action']
}

async function getAgentDataPath(ctx: MemoryToolContext): Promise<string> {
  const agent = agentService.getAgent(ctx.agentId)
  if (!agent) throw new ToolError(`Agent not found: ${ctx.agentId}`, ToolErrorCode.InternalError)
  const assertedPath = await assertAgentDataDirectory(path.dirname(ctx.agentDataPath), ctx.agentId)
  if (path.resolve(assertedPath) !== path.resolve(ctx.agentDataPath)) {
    throw new ToolError(`Agent data path mismatch for ${ctx.agentId}`, ToolErrorCode.InternalError)
  }
  return assertedPath
}

async function assertMemoryDirectory(ctx: MemoryToolContext): Promise<string> {
  const memoryDir = path.join(await getAgentDataPath(ctx), 'memory')
  const memoryStat = await lstat(memoryDir)
  if (!memoryStat.isDirectory() || memoryStat.isSymbolicLink()) {
    throw new Error(`Agent memory directory must be a real directory: ${memoryDir}`)
  }
  return memoryDir
}

async function assertRegularFileOrMissing(filePath: string): Promise<void> {
  try {
    const fileStat = await lstat(filePath)
    if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
      throw new Error(`Agent memory file must be a real file: ${filePath}`)
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

async function memoryUpdate(args: Record<string, unknown>, ctx: MemoryToolContext): Promise<NeutralToolResult> {
  const content = args.content
  if (typeof content !== 'string' || !content) {
    throw new ToolError("'content' is required for update action", ToolErrorCode.InvalidParams)
  }

  const memoryDir = await assertMemoryDirectory(ctx)
  const factPath = await resolveFileCI(memoryDir, 'FACT.md')
  await assertRegularFileOrMissing(factPath)

  const tmpPath = path.join(memoryDir, `.FACT.md.${randomUUID()}.tmp`)
  const handle = await open(tmpPath, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf-8')
    await handle.close()
    await assertMemoryDirectory(ctx)
    await assertRegularFileOrMissing(factPath)
    await rename(tmpPath, factPath)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(tmpPath).catch(() => undefined)
    throw error
  }

  logger.info('Memory FACT.md updated via tool', { agentId: ctx.agentId, length: content.length })
  return { content: [{ type: 'text', text: 'Memory updated.' }] }
}

async function memoryAppend(args: Record<string, unknown>, ctx: MemoryToolContext): Promise<NeutralToolResult> {
  const text = args.text
  if (typeof text !== 'string' || !text) {
    throw new ToolError("'text' is required for append action", ToolErrorCode.InvalidParams)
  }

  const tags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []
  const memoryDir = await assertMemoryDirectory(ctx)
  const journalPath = await resolveFileCI(memoryDir, 'JOURNAL.jsonl')
  await assertRegularFileOrMissing(journalPath)
  const entry: JournalEntry = { ts: new Date().toISOString(), tags, text }

  const handle = await open(
    journalPath,
    withNoFollow(constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY),
    0o600
  )
  try {
    const fileStat = await handle.stat()
    if (!fileStat.isFile()) throw new Error(`Agent journal must be a regular file: ${journalPath}`)
    await handle.appendFile(`${JSON.stringify(entry)}\n`, 'utf-8')
  } finally {
    await handle.close()
  }

  logger.info('Journal entry appended via tool', { agentId: ctx.agentId, tags })
  return { content: [{ type: 'text', text: `Journal entry added at ${entry.ts}.` }] }
}

async function memorySearch(args: Record<string, unknown>, ctx: MemoryToolContext): Promise<NeutralToolResult> {
  const query = typeof args.query === 'string' ? args.query : ''
  const tagFilter = typeof args.tag === 'string' ? args.tag : ''
  const rawLimit = typeof args.limit === 'number' || typeof args.limit === 'string' ? String(args.limit) : '20'
  const limit = Math.max(1, Number.parseInt(rawLimit, 10) || 20)
  const journalPath = await resolveFileCI(await assertMemoryDirectory(ctx), 'JOURNAL.jsonl')

  let fileContent: string
  try {
    const handle = await open(journalPath, withNoFollow(constants.O_RDONLY))
    try {
      const fileStat = await handle.stat()
      if (!fileStat.isFile()) throw new Error(`Agent journal must be a regular file: ${journalPath}`)
      fileContent = await handle.readFile('utf-8')
    } finally {
      await handle.close()
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { content: [{ type: 'text', text: 'No journal entries found.' }] }
    }
    throw new Error(`Failed to read journal at ${journalPath}: ${(error as Error).message}`)
  }

  const queryLower = query.toLowerCase()
  const tagLower = tagFilter.toLowerCase()
  const matches: JournalEntry[] = []
  for (const line of fileContent.split('\n')) {
    if (!line.trim()) continue
    try {
      const entry = JSON.parse(line) as JournalEntry
      if (tagFilter && !entry.tags?.some((tag) => tag.toLowerCase() === tagLower)) continue
      if (query && !entry.text.toLowerCase().includes(queryLower)) continue
      matches.push(entry)
    } catch {
      logger.warn('Skipping corrupted journal line', { journalPath, line: line.substring(0, 100) })
    }
  }

  const result = matches.slice(-limit).reverse()
  if (result.length === 0) return { content: [{ type: 'text', text: 'No matching journal entries found.' }] }
  logger.info('Journal search via tool', { agentId: ctx.agentId, query, tag: tagFilter, resultCount: result.length })
  return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
}

export const memoryTool: NeutralTool<MemoryToolContext> = {
  name: 'memory',
  description:
    "Manage persistent memory in this agent's data directory across sessions and workspaces. Actions: 'update' overwrites memory/FACT.md (durable knowledge and decisions that should survive across sessions). 'append' logs to memory/JOURNAL.jsonl (one-time events, completed tasks, session notes). 'search' queries the journal. Before writing to FACT.md, ask: will this still matter in 6 months? If not, use append instead.",
  inputSchema: MEMORY_INPUT_SCHEMA,
  handler: (args, ctx) => {
    switch (args.action) {
      case 'update':
        return memoryUpdate(args, ctx)
      case 'append':
        return memoryAppend(args, ctx)
      case 'search':
        return memorySearch(args, ctx)
      default:
        throw new ToolError(
          `Unknown action "${args.action}", expected update/append/search`,
          ToolErrorCode.InvalidParams
        )
    }
  }
}
