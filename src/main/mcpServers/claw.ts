import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { PluginService } from '@main/services/agents/plugins/PluginService'
import { agentService } from '@main/services/agents/services/AgentService'
import { channelManager } from '@main/services/agents/services/channels/ChannelManager'
import { taskService } from '@main/services/agents/services/TaskService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { TaskContextMode, TaskScheduleType } from '@types'
import { net } from 'electron'

const logger = loggerService.withContext('MCPServer:Claw')

/**
 * Parse a human-friendly duration string (e.g. '30m', '2h', '1h30m') into minutes.
 */
function parseDurationToMinutes(duration: string): number {
  let totalMinutes = 0
  const hourMatch = duration.match(/(\d+)\s*h/i)
  const minMatch = duration.match(/(\d+)\s*m/i)

  if (hourMatch) totalMinutes += parseInt(hourMatch[1], 10) * 60
  if (minMatch) totalMinutes += parseInt(minMatch[1], 10)

  if (totalMinutes === 0) {
    const raw = parseInt(duration, 10)
    if (!isNaN(raw) && raw > 0) return raw
    throw new Error(`Invalid duration: "${duration}". Use formats like '30m', '2h', '1h30m'.`)
  }

  return totalMinutes
}

type SkillSearchResult = {
  name: string
  namespace?: string
  description?: string | null
  author?: string | null
  installs?: number
  metadata?: {
    repoOwner?: string
    repoName?: string
  }
}

function buildSkillIdentifier(skill: SkillSearchResult): string {
  const { name, namespace, metadata } = skill
  const repoOwner = metadata?.repoOwner
  const repoName = metadata?.repoName

  if (repoOwner && repoName) {
    return `${repoOwner}/${repoName}/${name}`
  }

  if (namespace) {
    const cleanNamespace = namespace.replace(/^@/, '')
    const parts = cleanNamespace.split('/').filter(Boolean)
    if (parts.length >= 2) {
      return `${parts[0]}/${parts[1]}/${name}`
    }
    return `${cleanNamespace}/${name}`
  }

  return name
}

const CRON_TOOL: Tool = {
  name: 'cron',
  description:
    "Manage scheduled tasks. Use action 'add' to create a recurring or one-time job, 'list' to see all jobs, or 'remove' to delete a job. For one-time jobs, use the 'at' field with an RFC3339 timestamp.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['add', 'list', 'remove'],
        description: 'The action to perform'
      },
      name: {
        type: 'string',
        description: 'Name of the job (required for add)'
      },
      message: {
        type: 'string',
        description: 'The prompt/instruction to execute on schedule (required for add)'
      },
      cron: {
        type: 'string',
        description: "Cron expression, e.g. '0 9 * * 1-5' for weekdays at 9am (use cron OR every, not both)"
      },
      every: {
        type: 'string',
        description: "Duration, e.g. '30m', '2h', '24h' (use every OR cron, not both)"
      },
      at: {
        type: 'string',
        description:
          "RFC3339 timestamp for a one-time job, e.g. '2024-01-15T14:30:00+08:00' (use at OR cron OR every, not combined)"
      },
      session_mode: {
        type: 'string',
        enum: ['reuse', 'new'],
        description:
          "Session behavior: 'reuse' (default) keeps conversation history across executions, 'new' starts a fresh session each time"
      },
      id: {
        type: 'string',
        description: 'Job ID (required for remove)'
      }
    },
    required: ['action']
  }
}

const NOTIFY_TOOL: Tool = {
  name: 'notify',
  description:
    'Send a notification message to the user through connected channels (e.g. Telegram). Use this to proactively inform the user about task results, status updates, or any important information.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The notification message to send to the user'
      },
      channel_id: {
        type: 'string',
        description: 'Optional: send to a specific channel only (omit to send to all notify-enabled channels)'
      }
    },
    required: ['message']
  }
}

const MARKETPLACE_BASE_URL = 'https://claude-plugins.dev'

const SKILLS_TOOL: Tool = {
  name: 'skills',
  description:
    "Manage Claude skills in the agent's workspace. Use action 'search' to find skills from the marketplace, 'install' to install a skill, 'remove' to uninstall a skill, or 'list' to see installed skills.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['search', 'install', 'remove', 'list'],
        description: 'The action to perform'
      },
      query: {
        type: 'string',
        description: "Search query for finding skills in the marketplace (required for 'search')"
      },
      identifier: {
        type: 'string',
        description:
          "Marketplace skill identifier in 'owner/repo/skill-name' format (required for 'install'). Get this from the search results."
      },
      name: {
        type: 'string',
        description: "Skill folder name to remove (required for 'remove'). Get this from the list results."
      }
    },
    required: ['action']
  }
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
  } catch {
    // exact match not found, try case-insensitive
  }

  try {
    const entries = await readdir(dir)
    const target = name.toLowerCase()
    const match = entries.find((e) => e.toLowerCase() === target)
    return match ? path.join(dir, match) : exact
  } catch {
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
    "Manage persistent memory across sessions. Actions: 'update' overwrites memory/FACT.md (only durable project knowledge and decisions — not user preferences or personality, those belong in user.md and soul.md). 'append' logs to memory/JOURNAL.jsonl (one-time events, completed tasks, session notes). 'search' queries the journal. Before writing to FACT.md, ask: will this still matter in 6 months? If not, use append instead.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['update', 'append', 'search'],
        description:
          "Action to perform: 'update' overwrites FACT.md (durable project knowledge only), 'append' adds a JOURNAL entry, 'search' queries the journal"
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

class ClawServer {
  public mcpServer: McpServer
  private agentId: string

  constructor(agentId: string) {
    this.agentId = agentId
    this.mcpServer = new McpServer(
      {
        name: 'claw',
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
      tools: [CRON_TOOL, NOTIFY_TOOL, SKILLS_TOOL, MEMORY_TOOL]
    }))

    this.mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const toolName = request.params.name
      const args = (request.params.arguments ?? {}) as Record<string, string | undefined>

      try {
        switch (toolName) {
          case 'cron': {
            const action = args.action
            switch (action) {
              case 'add':
                return await this.addJob(args)
              case 'list':
                return await this.listJobs()
              case 'remove':
                return await this.removeJob(args)
              default:
                throw new McpError(ErrorCode.InvalidParams, `Unknown action "${action}", expected add/list/remove`)
            }
          }
          case 'notify':
            return await this.sendNotification(args)
          case 'skills': {
            const action = args.action
            switch (action) {
              case 'search':
                return await this.searchSkills(args)
              case 'install':
                return await this.installSkill(args)
              case 'remove':
                return await this.removeSkill(args)
              case 'list':
                return await this.listSkills()
              default:
                throw new McpError(
                  ErrorCode.InvalidParams,
                  `Unknown action "${action}", expected search/install/remove/list`
                )
            }
          }
          case 'memory': {
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
          }
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`)
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

  private async addJob(args: Record<string, string | undefined>) {
    const name = args.name
    const message = args.message
    const cronExpr = args.cron
    const every = args.every
    const at = args.at
    const sessionMode = args.session_mode

    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for add")
    if (!message) throw new McpError(ErrorCode.InvalidParams, "'message' is required for add")

    // Determine schedule type and value
    const scheduleCount = [cronExpr, every, at].filter(Boolean).length
    if (scheduleCount === 0) throw new McpError(ErrorCode.InvalidParams, "One of 'cron', 'every', or 'at' is required")
    if (scheduleCount > 1) throw new McpError(ErrorCode.InvalidParams, "Use only one of 'cron', 'every', or 'at'")

    let scheduleType: TaskScheduleType
    let scheduleValue: string

    if (cronExpr) {
      scheduleType = 'cron'
      scheduleValue = cronExpr
    } else if (every) {
      scheduleType = 'interval'
      scheduleValue = String(parseDurationToMinutes(every))
    } else {
      scheduleType = 'once'
      // Validate and normalize to ISO string
      const date = new Date(at!)
      if (isNaN(date.getTime())) throw new McpError(ErrorCode.InvalidParams, `Invalid timestamp: "${at}"`)
      scheduleValue = date.toISOString()
    }

    const contextMode: TaskContextMode = sessionMode === 'new' ? 'isolated' : 'session'

    const task = await taskService.createTask(this.agentId, {
      name,
      prompt: message,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      context_mode: contextMode
    })

    logger.info('Cron job created via tool', { agentId: this.agentId, taskId: task.id })
    return {
      content: [{ type: 'text' as const, text: `Job created:\n${JSON.stringify(task, null, 2)}` }]
    }
  }

  private async listJobs() {
    const { tasks } = await taskService.listTasks(this.agentId, { limit: 100 })

    if (tasks.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No scheduled jobs.' }] }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }]
    }
  }

  private async sendNotification(args: Record<string, string | undefined>) {
    const message = args.message
    if (!message) throw new McpError(ErrorCode.InvalidParams, "'message' is required for notify")

    const targetChannelId = args.channel_id
    let adapters = channelManager.getNotifyAdapters(this.agentId)

    if (targetChannelId) {
      adapters = adapters.filter((a) => a.channelId === targetChannelId)
    }

    if (adapters.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No notify-enabled channels found. Enable `is_notify_receiver` on at least one channel in agent settings.'
          }
        ]
      }
    }

    let sent = 0
    const errors: string[] = []

    for (const adapter of adapters) {
      for (const chatId of adapter.notifyChatIds) {
        try {
          await adapter.sendMessage(chatId, message)
          sent++
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          errors.push(`${adapter.channelId}/${chatId}: ${errMsg}`)
          logger.warn('Failed to send notification', {
            agentId: this.agentId,
            channelId: adapter.channelId,
            chatId,
            error: errMsg
          })
        }
      }
    }

    const parts = [`Notification sent to ${sent} chat(s).`]
    if (errors.length > 0) {
      parts.push(`Errors: ${errors.join('; ')}`)
    }

    logger.info('Notification sent via notify tool', { agentId: this.agentId, sent, errors: errors.length })
    return {
      content: [{ type: 'text' as const, text: parts.join(' ') }]
    }
  }

  private async searchSkills(args: Record<string, string | undefined>) {
    const query = args.query
    if (!query) throw new McpError(ErrorCode.InvalidParams, "'query' is required for search")

    const url = new URL(`${MARKETPLACE_BASE_URL}/api/skills`)
    url.searchParams.set('q', query.replace(/[-_]+/g, ' ').trim())
    url.searchParams.set('limit', '20')
    url.searchParams.set('offset', '0')

    const response = await net.fetch(url.toString(), { method: 'GET' })
    if (!response.ok) {
      throw new Error(`Marketplace API returned ${response.status}: ${response.statusText}`)
    }

    const json = (await response.json()) as { skills?: SkillSearchResult[]; total?: number }
    const skills = json.skills ?? []

    if (skills.length === 0) {
      return { content: [{ type: 'text' as const, text: `No skills found for "${query}".` }] }
    }

    const results = skills.map((s) => ({
      name: s.name,
      description: s.description ?? null,
      author: s.author ?? null,
      identifier: buildSkillIdentifier(s),
      installs: s.installs ?? 0
    }))

    logger.info('Skills search via tool', { agentId: this.agentId, query, resultCount: results.length })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Found ${results.length} skill(s) for "${query}":\n${JSON.stringify(results, null, 2)}\n\nUse the 'identifier' field with action 'install' to install a skill.`
        }
      ]
    }
  }

  private async installSkill(args: Record<string, string | undefined>) {
    const identifier = args.identifier
    if (!identifier) {
      throw new McpError(
        ErrorCode.InvalidParams,
        "'identifier' is required for install (format: 'owner/repo/skill-name')"
      )
    }

    const pluginService = PluginService.getInstance()
    const sourcePath = `marketplace:skill:${identifier}`

    const metadata = await pluginService.install({
      agentId: this.agentId,
      sourcePath,
      type: 'skill'
    })

    logger.info('Skill installed via tool', { agentId: this.agentId, identifier, name: metadata.name })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Skill installed:\n  Name: ${metadata.name}\n  Description: ${metadata.description ?? 'N/A'}\n  Folder: ${metadata.filename}`
        }
      ]
    }
  }

  private async removeSkill(args: Record<string, string | undefined>) {
    const name = args.name
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for remove (skill folder name)")

    const pluginService = PluginService.getInstance()

    await pluginService.uninstall({
      agentId: this.agentId,
      filename: name,
      type: 'skill'
    })

    logger.info('Skill removed via tool', { agentId: this.agentId, name })
    return {
      content: [{ type: 'text' as const, text: `Skill "${name}" removed.` }]
    }
  }

  private async listSkills() {
    const pluginService = PluginService.getInstance()
    const allPlugins = await pluginService.listInstalled(this.agentId)
    const skills = allPlugins.filter((p) => p.type === 'skill')

    if (skills.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No skills installed.' }] }
    }

    const results = skills.map((s) => ({
      name: s.metadata.name,
      folder: s.filename,
      description: s.metadata.description ?? null
    }))

    logger.info('Skills list via tool', { agentId: this.agentId, count: results.length })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }]
    }
  }

  private async getWorkspacePath(): Promise<string> {
    const agent = await agentService.getAgent(this.agentId)
    if (!agent) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)
    const workspace = agent.accessible_paths?.[0]
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
    } catch {
      return { content: [{ type: 'text' as const, text: 'No journal entries found.' }] }
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

  private async removeJob(args: Record<string, string | undefined>) {
    const id = args.id
    if (!id) throw new McpError(ErrorCode.InvalidParams, "'id' is required for remove")

    const deleted = await taskService.deleteTask(this.agentId, id)
    if (!deleted) throw new McpError(ErrorCode.InvalidParams, `Job "${id}" not found`)

    logger.info('Cron job removed via tool', { agentId: this.agentId, taskId: id })
    return {
      content: [{ type: 'text' as const, text: `Job "${id}" removed.` }]
    }
  }
}

export default ClawServer
