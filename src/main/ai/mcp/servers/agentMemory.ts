import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import * as z from 'zod'

import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { assertAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { isWin } from '@main/core/platform'

const logger = loggerService.withContext('McpServer:AgentMemory')

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

async function getAgentDataPath(ctx: MemoryToolContext): Promise<string> {
  const agent = agentService.getAgent(ctx.agentId)
  if (!agent) throw new Error(`Agent not found: ${ctx.agentId}`)
  const assertedPath = await assertAgentDataDirectory(path.dirname(ctx.agentDataPath), ctx.agentId)
  if (path.resolve(assertedPath) !== path.resolve(ctx.agentDataPath)) {
    throw new Error(`Agent data path mismatch for ${ctx.agentId}`)
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

async function memoryUpdate(content: string, ctx: MemoryToolContext): Promise<string> {
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
  return 'Memory updated.'
}

async function memoryAppend(text: string, tags: string[], ctx: MemoryToolContext): Promise<string> {
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
  return `Journal entry added at ${entry.ts}.`
}

async function memorySearch(query: string, tagFilter: string, limit: number, ctx: MemoryToolContext): Promise<string> {
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
      return 'No journal entries found.'
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
  if (result.length === 0) return 'No matching journal entries found.'
  logger.info('Journal search via tool', { agentId: ctx.agentId, query, tag: tagFilter, resultCount: result.length })
  return JSON.stringify(result, null, 2)
}

const MemoryInputSchema = z
  .object({
    action: z
      .enum(['update', 'append', 'search'])
      .describe(
        "Action to perform: 'update' overwrites FACT.md (durable knowledge only), 'append' adds a JOURNAL entry, 'search' queries the journal"
      ),
    content: z.string().optional().describe('Full markdown content for FACT.md (required for update)'),
    text: z.string().optional().describe('Journal entry text (required for append)'),
    tags: z.array(z.string()).optional().describe('Tags for the journal entry (optional, for append)'),
    query: z.string().optional().describe('Search query — case-insensitive substring match (for search)'),
    tag: z.string().optional().describe('Filter by tag (optional, for search)'),
    limit: z.coerce.number().int().positive().optional().describe('Max results to return (default 20, for search)')
  })
  .superRefine((args, ctx) => {
    if (args.action === 'update' && !args.content)
      ctx.addIssue({ code: 'custom', message: "'content' is required for update action", path: ['content'] })
    if (args.action === 'append' && !args.text)
      ctx.addIssue({ code: 'custom', message: "'text' is required for append action", path: ['text'] })
  })

export function createAgentMemoryServer(ctx: MemoryToolContext): McpServer {
  const server = new McpServer({ name: 'agent-memory', version: '1.0.0' })
  server.registerTool(
    'memory',
    {
      description:
        "Manage persistent memory in this agent's data directory across sessions and workspaces. Actions: 'update' overwrites memory/FACT.md (durable knowledge and decisions that should survive across sessions). 'append' logs to memory/JOURNAL.jsonl (one-time events, completed tasks, session notes). 'search' queries the journal. Before writing to FACT.md, ask: will this still matter in 6 months? If not, use append instead.",
      inputSchema: MemoryInputSchema
    },
    async (args) => {
      const text =
        args.action === 'update'
          ? await memoryUpdate(args.content!, ctx)
          : args.action === 'append'
            ? await memoryAppend(args.text!, args.tags ?? [], ctx)
            : await memorySearch(args.query ?? '', args.tag ?? '', args.limit ?? 20, ctx)
      return { content: [{ type: 'text', text }] }
    }
  )
  return server
}
