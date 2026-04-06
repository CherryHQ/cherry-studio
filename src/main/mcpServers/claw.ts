import { appendFile, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { type ChannelConfig, ChannelConfigSchema } from '@main/services/agents/database/schema'
import { agentService } from '@main/services/agents/services/AgentService'
import { channelManager } from '@main/services/agents/services/channels/ChannelManager'
import { channelService } from '@main/services/agents/services/ChannelService'
import { taskService } from '@main/services/agents/services/TaskService'
import { skillService } from '@main/services/agents/skills'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { CherryClawConfiguration, TaskScheduleType } from '@types'
import { net } from 'electron'
import QRCode from 'qrcode'

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
      channel_ids: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Channel IDs to send task results to. Omit to auto-bind all agent channels. Use an empty array [] to skip channel delivery.'
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

/** Per-adapter-type config schema descriptions (for agent self-documentation). */
const CHANNEL_CONFIG_SCHEMAS: Record<string, { required: string[]; optional: string[]; description: string }> = {
  telegram: {
    required: ['bot_token'],
    optional: ['allowed_chat_ids'],
    description: 'Telegram Bot. Get bot_token from @BotFather.'
  },
  feishu: {
    required: [],
    optional: ['app_id', 'app_secret', 'encrypt_key', 'verification_token', 'allowed_chat_ids', 'domain'],
    description:
      'Feishu/Lark bot. If app_id and app_secret are omitted, a QR code is returned for the user to scan with Feishu to auto-create a bot app and obtain credentials. domain defaults to "feishu" (use "lark" for international).'
  },
  qq: {
    required: ['app_id', 'client_secret'],
    optional: ['allowed_chat_ids'],
    description: 'QQ official bot via QQ Open Platform.'
  },
  wechat: {
    required: [],
    optional: ['token_path', 'allowed_chat_ids'],
    description:
      'WeChat via local WeChat desktop client bridge. After adding, a QR code image is returned — display it inline for the user to scan with their phone.'
  },
  discord: {
    required: ['bot_token'],
    optional: ['allowed_channel_ids'],
    description: [
      'Discord bot via WebSocket gateway.',
      'Setup steps:',
      '1. Go to https://discord.com/developers/applications and click "New Application".',
      '2. Go to the "Bot" tab, click "Reset Token" to generate a new token — this is your bot_token.',
      '3. Under "Privileged Gateway Intents", enable "MESSAGE CONTENT INTENT".',
      '4. Go to "OAuth2 > URL Generator", select scopes: "bot", and bot permissions: "Send Messages", "Read Message History", "View Channels".',
      '5. Copy the generated URL, open it in a browser to invite the bot to your server.',
      '6. allowed_channel_ids format: "channel:<channel_id>" for guild channels, "dm:<channel_id>" for DMs. Send /whoami in Discord to get the correct ID.'
    ].join(' ')
  },
  slack: {
    required: ['bot_token', 'app_token'],
    optional: ['allowed_channel_ids'],
    description: [
      'Slack bot via Socket Mode (WebSocket).',
      'Setup steps:',
      '1. Go to https://api.slack.com/apps and click "Create New App" > "From scratch".',
      '2. Go to "OAuth & Permissions", add Bot Token Scopes: "chat:write", "reactions:write", "channels:history", "groups:history", "im:history", "mpim:history", "users:read", "files:read".',
      '3. Click "Install to Workspace" and copy the "Bot User OAuth Token" (xoxb-...) — this is your bot_token.',
      '4. Go to "Socket Mode" and enable it. Generate an App-Level Token with scope "connections:write" — this is your app_token (xapp-...).',
      '5. Go to "Event Subscriptions", enable events, and subscribe to bot events: "message.channels", "message.groups", "message.im", "message.mpim", "app_mention".',
      '6. Invite the bot to channels by typing /invite @YourBotName in the desired Slack channel.',
      '7. allowed_channel_ids is optional — leave empty to allow all channels the bot is in.'
    ].join(' ')
  }
}

const CONFIG_TOOL: Tool = {
  name: 'config',
  description:
    "Inspect and manage your own agent configuration. Use 'status' to see current channels, model, and supported adapter types. Use 'rename' to change your display name. Use 'add_channel', 'update_channel', 'remove_channel', or 'reconnect_channel' to manage IM channel connections. Use 'reconnect_channel' when a WeChat or Feishu channel needs to re-scan a QR code (e.g. session expired or initial setup failed). Use 'complete_bootstrap' to mark the onboarding ritual as done. Use 'reset_bootstrap' to re-run the onboarding in the next session.",
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [
          'status',
          'rename',
          'add_channel',
          'update_channel',
          'remove_channel',
          'reconnect_channel',
          'complete_bootstrap',
          'reset_bootstrap'
        ],
        description: 'The action to perform'
      },
      type: {
        type: 'string',
        enum: ['telegram', 'feishu', 'qq', 'wechat', 'discord', 'slack'],
        description: "Channel adapter type (required for 'add_channel')"
      },
      name: {
        type: 'string',
        description: "For 'rename': the new agent display name. For 'add_channel': human-readable channel name."
      },
      channel_id: {
        type: 'string',
        description: "Channel ID (required for 'update_channel' and 'remove_channel')"
      },
      config: {
        type: 'object',
        description: "Adapter-specific configuration (required for 'add_channel', optional for 'update_channel')"
      },
      enabled: {
        type: 'boolean',
        description: 'Enable or disable the channel (optional for add/update, defaults to true)'
      }
    },
    required: ['action']
  }
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
  private sourceChannelId: string | undefined

  constructor(agentId: string, sourceChannelId?: string) {
    this.agentId = agentId
    this.sourceChannelId = sourceChannelId
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
      tools: [CRON_TOOL, NOTIFY_TOOL, SKILLS_TOOL, MEMORY_TOOL, CONFIG_TOOL]
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
          case 'config': {
            const action = args.action
            switch (action) {
              case 'status':
                return await this.configStatus()
              case 'rename':
                return await this.configRename(args)
              case 'add_channel':
                return await this.configAddChannel(args)
              case 'update_channel':
                return await this.configUpdateChannel(args)
              case 'remove_channel':
                return await this.configRemoveChannel(args)
              case 'reconnect_channel':
                return await this.configReconnectChannel(args)
              case 'complete_bootstrap':
                return await this.configCompleteBootstrap()
              case 'reset_bootstrap':
                return await this.configResetBootstrap()
              default:
                throw new McpError(
                  ErrorCode.InvalidParams,
                  `Unknown action "${action}", expected status/rename/add_channel/update_channel/remove_channel/reconnect_channel/complete_bootstrap/reset_bootstrap`
                )
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

  private async addJob(args: Record<string, unknown>) {
    const name = args.name as string | undefined
    const message = args.message as string | undefined
    const cronExpr = args.cron as string | undefined
    const every = args.every as string | undefined
    const at = args.at as string | undefined
    const rawChannelIds = args.channel_ids as string[] | undefined
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

    // Resolve channel_ids: explicit array, or default to the current channel
    let channelIds: string[] | undefined
    if (Array.isArray(rawChannelIds)) {
      channelIds = rawChannelIds
    } else if (this.sourceChannelId) {
      channelIds = [this.sourceChannelId]
    }

    const task = await taskService.createTask(this.agentId, {
      name,
      prompt: message,
      schedule_type: scheduleType,
      schedule_value: scheduleValue,
      channel_ids: channelIds && channelIds.length > 0 ? channelIds : undefined
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
    let adapters = channelManager.getAgentAdapters(this.agentId)

    if (targetChannelId) {
      adapters = adapters.filter((a) => a.channelId === targetChannelId)
    }

    if (adapters.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: 'No connected channels found. Configure at least one channel in settings.'
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

    const installed = await skillService.install({
      installSource: `claude-plugins:${identifier}`
    })

    logger.info('Skill installed via tool', { agentId: this.agentId, identifier, name: installed.name })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Skill installed:\n  Name: ${installed.name}\n  Description: ${installed.description ?? 'N/A'}\n  Folder: ${installed.folderName}`
        }
      ]
    }
  }

  private async removeSkill(args: Record<string, string | undefined>) {
    const name = args.name
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for remove (skill folder name)")

    await skillService.uninstallByFolderName(name)

    logger.info('Skill removed via tool', { agentId: this.agentId, name })
    return {
      content: [{ type: 'text' as const, text: `Skill "${name}" removed.` }]
    }
  }

  private async listSkills() {
    const skills = await skillService.list()

    if (skills.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No skills installed.' }] }
    }

    const results = skills.map((s) => ({
      name: s.name,
      folder: s.folderName,
      description: s.description ?? null,
      enabled: s.isEnabled
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

  // ── Config tool handlers ──────────────────────────────────────────

  private async configStatus() {
    const agent = await agentService.getAgent(this.agentId)
    if (!agent) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)

    const config = agent.configuration
    const channels = await channelService.listChannels({ agentId: this.agentId })

    const adapterStatuses = channelManager.getAdapterStatuses(this.agentId)
    const statusMap = new Map(adapterStatuses.map((s) => [s.channelId, s.connected]))

    const channelSummary = channels.map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      enabled: ch.isActive,
      connected: statusMap.get(ch.id) ?? false
    }))

    const result = {
      agent_id: agent.id,
      name: agent.name,
      model: agent.model,
      supported_channel_types: Object.entries(CHANNEL_CONFIG_SCHEMAS).map(([type, schema]) => ({
        type,
        description: schema.description,
        required_fields: schema.required,
        optional_fields: schema.optional
      })),
      channels: channelSummary,
      soul_enabled: config?.soul_enabled ?? false,
      heartbeat_enabled: config?.heartbeat_enabled ?? false
    }

    logger.info('Config status queried', { agentId: this.agentId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  }

  private async configAddChannel(args: Record<string, unknown>) {
    const type = args.type as string | undefined
    const name = args.name as string | undefined
    const channelConfig = args.config as Record<string, unknown> | undefined
    const enabled = args.enabled as boolean | undefined

    if (!type) throw new McpError(ErrorCode.InvalidParams, "'type' is required for add_channel")
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for add_channel")

    const schema = CHANNEL_CONFIG_SCHEMAS[type]
    if (!schema) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown channel type "${type}". Supported: ${Object.keys(CHANNEL_CONFIG_SCHEMAS).join(', ')}`
      )
    }

    // Validate required config fields
    const cfg = channelConfig ?? {}
    for (const field of schema.required) {
      if (!cfg[field]) {
        throw new McpError(ErrorCode.InvalidParams, `Missing required config field "${field}" for ${type} channel`)
      }
    }

    const channelType = type as ChannelConfig['type']
    const config = ChannelConfigSchema.parse({ type: channelType, ...cfg })
    const newChannel = await channelService.createChannel({
      type: channelType,
      name,
      agentId: this.agentId,
      config,
      isActive: enabled ?? true
    })

    // For channels that use QR-based setup (WeChat login, Feishu app registration),
    // connect is blocking (waits for QR scan), so run sync in background
    // and wait only for the QR URL to return it to the agent.
    const needsQr = type === 'wechat' || (type === 'feishu' && !cfg.app_id && !cfg.app_secret)

    if (needsQr) {
      const qrPromise = channelManager.waitForQrUrl(this.agentId, newChannel.id, 30_000)
      // Fire-and-forget: syncAgent will complete once the user scans
      channelManager.syncAgent(this.agentId).catch((err) => {
        logger.error(`${type} sync failed`, {
          agentId: this.agentId,
          channelId: newChannel.id,
          error: err instanceof Error ? err.message : String(err)
        })
      })

      const channelLabel = type === 'wechat' ? 'WeChat' : 'Feishu'
      const scanHint =
        type === 'wechat'
          ? 'scan with WeChat to log in'
          : 'scan with Feishu to create a bot app and obtain credentials automatically'

      try {
        const qrUrl = await qrPromise
        const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 })
        // Extract base64 from data URI: "data:image/png;base64,..."
        const base64 = qrDataUrl.split(',')[1]

        logger.info(`${channelLabel} channel added, QR code generated`, {
          agentId: this.agentId,
          channelId: newChannel.id
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: `${channelLabel} channel created (ID: ${newChannel.id}). QR code generated — display it to the user so they can ${scanHint}.`
            },
            {
              type: 'image' as const,
              data: base64,
              mimeType: 'image/png'
            }
          ]
        }
      } catch (err) {
        // QR timed out — remove the orphan channel so it doesn't block future syncAgent calls
        await this.removeOrphanChannel(newChannel.id)

        logger.warn(`Failed to get ${channelLabel} QR code, orphan channel removed`, {
          agentId: this.agentId,
          channelId: newChannel.id,
          error: err instanceof Error ? err.message : String(err)
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to set up ${channelLabel} channel: ${err instanceof Error ? err.message : String(err)}. The channel was not saved. Please try again.`
            }
          ],
          isError: true
        }
      }
    }

    await channelManager.syncAgent(this.agentId)

    logger.info('Channel added via config tool', { agentId: this.agentId, channelId: newChannel.id, type })
    return {
      content: [
        {
          type: 'text' as const,
          text: `Channel added and activated:\n${JSON.stringify({ id: newChannel.id, type, name, enabled: newChannel.isActive }, null, 2)}`
        }
      ]
    }
  }

  private async configUpdateChannel(args: Record<string, unknown>) {
    const channelId = args.channel_id as string | undefined
    if (!channelId) throw new McpError(ErrorCode.InvalidParams, "'channel_id' is required for update_channel")

    const existing = await channelService.getChannel(channelId)
    if (!existing) throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)

    const updates: Record<string, unknown> = {}
    if (args.name !== undefined) updates.name = args.name as string
    if (args.enabled !== undefined) updates.isActive = args.enabled as boolean
    if (args.config !== undefined) {
      updates.config = { ...existing.config, ...(args.config as Record<string, unknown>) }
    }

    await channelService.updateChannel(channelId, updates)
    await channelManager.syncAgent(this.agentId)

    logger.info('Channel updated via config tool', { agentId: this.agentId, channelId })
    return {
      content: [{ type: 'text' as const, text: `Channel "${channelId}" updated and reloaded.` }]
    }
  }

  private async configRemoveChannel(args: Record<string, unknown>) {
    const channelId = args.channel_id as string | undefined
    if (!channelId) throw new McpError(ErrorCode.InvalidParams, "'channel_id' is required for remove_channel")

    const channel = await channelService.getChannel(channelId)
    if (!channel) throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)

    await channelService.deleteChannel(channelId)
    await channelManager.syncAgent(this.agentId)

    logger.info('Channel removed via config tool', { agentId: this.agentId, channelId, type: channel.type })
    return {
      content: [{ type: 'text' as const, text: `Channel "${channelId}" (${channel.name}) removed.` }]
    }
  }

  private async configReconnectChannel(args: Record<string, unknown>) {
    const channelId = args.channel_id as string | undefined
    if (!channelId) throw new McpError(ErrorCode.InvalidParams, "'channel_id' is required for reconnect_channel")

    const channel = await channelService.getChannel(channelId)
    if (!channel) throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)

    const needsQr =
      channel.type === 'wechat' || (channel.type === 'feishu' && !(channel.config as Record<string, unknown>).app_id)

    if (!needsQr) {
      // For non-QR channels, just re-sync
      await channelManager.syncAgent(this.agentId)
      return {
        content: [{ type: 'text' as const, text: `Channel "${channelId}" reconnected.` }]
      }
    }

    // QR-based reconnect: sync in background, wait for QR URL
    const qrPromise = channelManager.waitForQrUrl(this.agentId, channelId, 30_000)
    channelManager.syncAgent(this.agentId).catch((err) => {
      logger.error('Reconnect sync failed', {
        agentId: this.agentId,
        channelId,
        error: err instanceof Error ? err.message : String(err)
      })
    })

    const channelLabel = channel.type === 'wechat' ? 'WeChat' : 'Feishu'

    try {
      const qrUrl = await qrPromise
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 })
      const base64 = qrDataUrl.split(',')[1]

      logger.info(`${channelLabel} channel reconnect QR generated`, { agentId: this.agentId, channelId })
      return {
        content: [
          {
            type: 'text' as const,
            text: `${channelLabel} channel "${channelId}" needs re-authentication. Display this QR code for the user to scan.`
          },
          {
            type: 'image' as const,
            data: base64,
            mimeType: 'image/png'
          }
        ]
      }
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to generate QR for reconnect: ${err instanceof Error ? err.message : String(err)}`
          }
        ],
        isError: true
      }
    }
  }

  private async configRename(args: Record<string, unknown>) {
    const name = args.name as string | undefined
    if (!name || !name.trim()) throw new McpError(ErrorCode.InvalidParams, "'name' is required for rename")

    await agentService.updateAgent(this.agentId, { name: name.trim() })

    logger.info('Agent renamed via config tool', { agentId: this.agentId, name: name.trim() })
    return {
      content: [{ type: 'text' as const, text: `Agent renamed to "${name.trim()}".` }]
    }
  }

  private async configCompleteBootstrap() {
    const agent = await agentService.getAgent(this.agentId)
    if (!agent) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)

    const existingConfig = agent.configuration
    await agentService.updateAgent(this.agentId, {
      configuration: { ...existingConfig, bootstrap_completed: true } as CherryClawConfiguration
    })

    logger.info('Bootstrap marked as completed', { agentId: this.agentId })
    return {
      content: [
        { type: 'text' as const, text: 'Bootstrap completed. Future sessions will use your standard personality.' }
      ]
    }
  }

  private async configResetBootstrap() {
    const agent = await agentService.getAgent(this.agentId)
    if (!agent) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)

    const existingConfig = agent.configuration
    await agentService.updateAgent(this.agentId, {
      configuration: { ...existingConfig, bootstrap_completed: false } as CherryClawConfiguration
    })

    logger.info('Bootstrap reset', { agentId: this.agentId })
    return {
      content: [
        { type: 'text' as const, text: 'Bootstrap has been reset. The next session will run the onboarding flow.' }
      ]
    }
  }

  /**
   * Remove a channel from config that failed to connect (e.g. QR timeout).
   * Prevents orphaned channels from blocking future syncAgent calls.
   */
  private async removeOrphanChannel(channelId: string): Promise<void> {
    try {
      await channelService.deleteChannel(channelId)
      await channelManager.syncAgent(this.agentId)
    } catch (err) {
      logger.error('Failed to remove orphan channel', {
        agentId: this.agentId,
        channelId,
        error: err instanceof Error ? err.message : String(err)
      })
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
