import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import { type ChannelConfig, ChannelConfigSchema } from '@main/services/agents/database/schema'
import { agentService } from '@main/services/agents/services/AgentService'
import type { ChannelAdapter } from '@main/services/agents/services/channels/ChannelAdapter'
import { channelManager } from '@main/services/agents/services/channels/ChannelManager'
import { channelService } from '@main/services/agents/services/ChannelService'
import { taskService } from '@main/services/agents/services/TaskService'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Tool } from '@modelcontextprotocol/sdk/types.js'
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { AgentConfiguration, TaskScheduleType } from '@types'
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
    "Send a notification to the user through connected channels (e.g. Telegram, WeChat). Use to proactively deliver task results, status updates, or files you've generated. Supports optional image attachment (image_path OR image_base64) and/or file attachment (file_path) so images and documents you produce in the agent workspace can be relayed straight to the user's IM client instead of sending URLs. Media delivery currently supported by WeChat.",
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'The notification message to send. Optional when an image or file is attached — the attachment is then sent on its own.'
      },
      channel_id: {
        type: 'string',
        description: 'Optional: send to a specific channel only (omit to send to all notify-enabled channels)'
      },
      image_path: {
        type: 'string',
        description: 'Absolute local file path to an image (PNG/JPEG/GIF/WebP). Mutually exclusive with image_base64.'
      },
      image_base64: {
        type: 'string',
        description: 'Base64-encoded image bytes (raw or data URI). Mutually exclusive with image_path.'
      },
      file_path: {
        type: 'string',
        description:
          'Absolute local file path to a document (PDF, DOCX, etc.) to send as a file attachment. The basename is used as the file name shown to the recipient.'
      }
    },
    required: []
  }
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

// ── Notify tool helpers ────────────────────────────────────────────────
// Kept as module-level functions so ClawServer.sendNotification stays short:
// parse args → build payloads → deliver → format summary.

type NotifyKind = 'text' | 'image' | 'file'

type NotifyPayload = {
  kind: NotifyKind
  send: (adapter: ChannelAdapter, chatId: string) => Promise<void>
}

const NOTIFY_KIND_LABELS: Record<NotifyKind, string> = {
  text: 'Notification',
  image: 'Image',
  file: 'File'
}

async function buildNotifyPayloads(args: Record<string, unknown>): Promise<NotifyPayload[]> {
  const message = args.message as string | undefined
  const imagePath = args.image_path as string | undefined
  const imageBase64 = args.image_base64 as string | undefined
  const filePath = args.file_path as string | undefined

  if (imagePath && imageBase64) {
    throw new McpError(ErrorCode.InvalidParams, "Provide only one of 'image_path' or 'image_base64'")
  }

  const payloads: NotifyPayload[] = []

  const imageBuffer = await resolveImageBytes(imagePath, imageBase64)
  if (imageBuffer) {
    payloads.push({
      kind: 'image',
      send: (adapter, chatId) => adapter.sendMedia(chatId, imageBuffer, 'image')
    })
  }

  if (filePath) {
    const file = await resolveFileBytes(filePath)
    payloads.push({
      kind: 'file',
      send: (adapter, chatId) => adapter.sendMedia(chatId, file.buffer, 'file', file.fileName)
    })
  }

  if (message) {
    payloads.push({
      kind: 'text',
      send: (adapter, chatId) => adapter.sendMessage(chatId, message)
    })
  }

  if (payloads.length === 0) {
    throw new McpError(
      ErrorCode.InvalidParams,
      "At least one of 'message', 'image_path', 'image_base64', or 'file_path' is required"
    )
  }

  return payloads
}

async function resolveImageBytes(imagePath?: string, imageBase64?: string): Promise<Buffer | undefined> {
  if (imagePath) return readAbsoluteFile(imagePath, 'image_path')
  if (!imageBase64) return undefined

  const raw = imageBase64.startsWith('data:') ? (imageBase64.split(',', 2)[1] ?? '') : imageBase64
  const buffer = Buffer.from(raw, 'base64')
  if (buffer.length === 0) {
    throw new McpError(ErrorCode.InvalidParams, "'image_base64' did not decode to any bytes")
  }
  return buffer
}

async function resolveFileBytes(filePath: string): Promise<{ buffer: Buffer; fileName: string }> {
  const buffer = await readAbsoluteFile(filePath, 'file_path')
  return { buffer, fileName: path.basename(filePath) }
}

async function readAbsoluteFile(absPath: string, argName: string): Promise<Buffer> {
  if (!path.isAbsolute(absPath)) {
    throw new McpError(ErrorCode.InvalidParams, `'${argName}' must be an absolute path`)
  }
  try {
    return await readFile(absPath)
  } catch (err) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `Failed to read ${argName} "${absPath}": ${err instanceof Error ? err.message : String(err)}`
    )
  }
}

function formatNotifyResult(payloads: NotifyPayload[], stats: Record<NotifyKind, number>, errors: string[]): string {
  const attempted = new Set(payloads.map((p) => p.kind))
  const parts: string[] = []
  for (const kind of ['text', 'image', 'file'] as const) {
    if (attempted.has(kind)) parts.push(`${NOTIFY_KIND_LABELS[kind]} sent to ${stats[kind]} chat(s).`)
  }
  if (errors.length > 0) parts.push(`Errors: ${errors.join('; ')}`)
  return parts.join(' ')
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
      tools: [CRON_TOOL, NOTIFY_TOOL, CONFIG_TOOL]
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

  private async sendNotification(args: Record<string, unknown>) {
    const payloads = await buildNotifyPayloads(args)
    const adapters = this.resolveNotifyAdapters(args.channel_id as string | undefined)

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

    const stats: Record<NotifyKind, number> = { text: 0, image: 0, file: 0 }
    const errors: string[] = []

    for (const adapter of adapters) {
      for (const chatId of adapter.notifyChatIds) {
        for (const payload of payloads) {
          try {
            await payload.send(adapter, chatId)
            stats[payload.kind]++
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err)
            errors.push(`${adapter.channelId}/${chatId} (${payload.kind}): ${errMsg}`)
            logger.warn('Failed to send notification payload', {
              agentId: this.agentId,
              channelId: adapter.channelId,
              chatId,
              kind: payload.kind,
              error: errMsg
            })
          }
        }
      }
    }

    logger.info('Notification sent via notify tool', {
      agentId: this.agentId,
      ...stats,
      errors: errors.length
    })
    return {
      content: [{ type: 'text' as const, text: formatNotifyResult(payloads, stats, errors) }]
    }
  }

  private resolveNotifyAdapters(targetChannelId: string | undefined): ChannelAdapter[] {
    const adapters = channelManager.getAgentAdapters(this.agentId)
    return targetChannelId ? adapters.filter((a) => a.channelId === targetChannelId) : adapters
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
      // Fire-and-forget: syncChannel will complete once the user scans
      channelManager.syncChannel(newChannel.id).catch((err) => {
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
        // QR timed out — remove the orphan channel so it doesn't block future connections
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

    await channelManager.syncChannel(newChannel.id)

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
    await channelManager.syncChannel(channelId)

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
    await channelManager.disconnectChannel(channelId)

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
      await channelManager.syncChannel(channelId)
      return {
        content: [{ type: 'text' as const, text: `Channel "${channelId}" reconnected.` }]
      }
    }

    // QR-based reconnect: sync in background, wait for QR URL
    const qrPromise = channelManager.waitForQrUrl(this.agentId, channelId, 30_000)
    channelManager.syncChannel(channelId).catch((err) => {
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
      configuration: { ...existingConfig, bootstrap_completed: true } as AgentConfiguration
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
      configuration: { ...existingConfig, bootstrap_completed: false } as AgentConfiguration
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
   * Prevents orphaned channels from blocking future connections.
   */
  private async removeOrphanChannel(channelId: string): Promise<void> {
    try {
      await channelService.deleteChannel(channelId)
      await channelManager.disconnectChannel(channelId)
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
