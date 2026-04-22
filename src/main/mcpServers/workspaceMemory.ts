import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { agentService } from '@main/services/agents/services/AgentService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'

const logger = loggerService.withContext('MCPServer:WorkspaceMemory')

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

const MEMORY_TOOL: Tool = {
  name: 'memory',
  description:
    "Manage persistent memory in this agent's workspace across sessions. Actions: 'update' overwrites memory/FACT.md (durable knowledge and decisions that should survive across sessions). 'append' logs to memory/JOURNAL.jsonl (one-time events, completed tasks, session notes). 'search' queries the journal. Before writing to FACT.md, ask: will this still matter in 6 months? If not, use append instead.",
  inputSchema: {
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
}

/**
 * MCP server exposing cross-session memory to any agent (not gated on Soul Mode).
 *
 * Memory lives in the agent's workspace under `memory/` — `FACT.md` for
 * durable knowledge and `JOURNAL.jsonl` for timestamped events. Any agent
 * with a stable workspace benefits from this; the tool itself is just a
 * thin, safe wrapper over file operations.
 *
 * Distinct from the built-in `memory.ts` knowledge-graph server, which is
 * a user-opt-in MCP that stores entity/relation graphs in a global JSON
 * file rather than in the agent's workspace.
 */
class WorkspaceMemoryServer {
  public mcpServer: McpServer
  private agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
    this.mcpServer = new McpServer(
      {
        name: 'agent-memory',
        version: '1.0.0'
      },
      {
        capabilities: {
          tools: {}
        }
      }
    )
    this.setupHandlers()
  }

  private setupHandlers() {
    this.mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [MEMORY_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        if (toolName !== 'memory') {
          throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
        }
        const action = args.action
        switch (action) {
          case 'update':
            return await this.memoryUpdate(args)
          case 'append':
            return await this.memoryAppend(args)
          case 'search':
            return await this.memorySearch(args)
          default:
            throw new McpError(ErrorCode.InvalidParams, `Unknown action "${action}", expected update/append/search`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`Tool error: ${toolName}`, { agentId: this.agentId, error: message })
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
    })
  }

  private async getWorkspacePath(): Promise<string> {
    const agent = await agentService.getAgent(this.agentId)
    if (!agent) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)
    const workspace = agent.accessiblePaths?.[0]
    if (!workspace) throw new McpError(ErrorCode.InternalError, 'Agent has no workspace path configured')
    return workspace
  }

  private async memoryUpdate(args: Record<string, string | undefined>) {
    const content = args.content
    if (!content) throw new McpError(ErrorCode.InvalidParams, "'content' is required for update action")

    const workspace = await this.getWorkspacePath()
    const memoryDir = path.join(workspace, 'memory')
    const factPath = await resolveFileCI(memoryDir, 'FACT.md')

    await mkdir(memoryDir, { recursive: true })

    // Atomic write via temp file + rename
    const tmpPath = `${factPath}.${Date.now()}.tmp`
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, factPath)

    logger.info('Memory FACT.md updated via tool', { agentId: this.agentId, length: content.length })
    return {
      content: [{ type: 'text' as const, text: 'Memory updated.' }]
    }
  }

  private async memoryAppend(args: Record<string, string | undefined>) {
    const text = args.text
    if (!text) throw new McpError(ErrorCode.InvalidParams, "'text' is required for append action")

    const tags: string[] = []
    const rawTags = (args as Record<string, unknown>).tags
    if (Array.isArray(rawTags)) {
      for (const item of rawTags) {
        if (typeof item === 'string') tags.push(item)
      }
    }

    const workspace = await this.getWorkspacePath()
    const memoryDir = path.join(workspace, 'memory')

    await mkdir(memoryDir, { recursive: true })

    const journalPath = await resolveFileCI(memoryDir, 'JOURNAL.jsonl')

    const entry: JournalEntry = {
      ts: new Date().toISOString(),
      tags,
      text
    }

    await appendFile(journalPath, JSON.stringify(entry) + '\n', 'utf-8')

    logger.info('Journal entry appended via tool', { agentId: this.agentId, tags })
    return {
      content: [{ type: 'text' as const, text: `Journal entry added at ${entry.ts}.` }]
    }
  }

  private async memorySearch(args: Record<string, string | undefined>) {
    const query = args.query ?? ''
    const tagFilter = args.tag ?? ''
    const limit = Math.max(1, parseInt(args.limit ?? '20', 10) || 20)

    const workspace = await this.getWorkspacePath()
    const memoryDir = path.join(workspace, 'memory')
    const journalPath = await resolveFileCI(memoryDir, 'JOURNAL.jsonl')

    let fileContent: string
    try {
      fileContent = await readFile(journalPath, 'utf-8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { content: [{ type: 'text' as const, text: 'No journal entries found.' }] }
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
      return { content: [{ type: 'text' as const, text: 'No matching journal entries found.' }] }
    }

    logger.info('Journal search via tool', { agentId: this.agentId, query, tag: tagFilter, resultCount: result.length })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  }
}

export default WorkspaceMemoryServer
