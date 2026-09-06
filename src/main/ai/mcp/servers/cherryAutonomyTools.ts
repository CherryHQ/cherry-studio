/**
 * Agent autonomy tools (cron / notify / config) hosted by the in-process
 * `cherry-tools` MCP server (see `cherryBuiltinTools.ts`).
 *
 * Unlike the stateless builtin lookup tools, these act on behalf of a specific
 * agent (schedule its tasks, notify through its channels, manage its own
 * configuration), so they take the per-session agent context
 * `CherryBuiltinToolsServer` is constructed with.
 */

import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentChannelWorkflowService } from '@data/services/AgentChannelWorkflowService'
import { agentService } from '@data/services/AgentService'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { type ChannelAdapter, resolveWorkspaceFile, sanitizeChannelOutput } from '@main/ai/channels'
import type { NotifyChannel } from '@main/ai/runtime/agentMcpServers'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import {
  AgentSessionDeliveryStatusSchema,
  SESSION_CREATE_TOOL_NAME,
  SESSION_DELIVERIES_TOOL_NAME,
  SESSION_LIST_TOOL_NAME,
  SESSION_SEARCH_TOOL_NAME,
  SESSION_SEND_TOOL_NAME
} from '@shared/ai/agentSessionDelivery'
import { CONFIG_TOOL_NAME, CRON_TOOL_NAME, NOTIFY_TOOL_NAME } from '@shared/ai/builtinTools'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { Trigger } from '@shared/data/api/schemas/jobs'
import { ChannelConfigSchema } from '@shared/data/types/channel'
import QRCode from 'qrcode'

const logger = loggerService.withContext('McpServer:CherryAutonomyTools')

/** Per-session agent context the autonomy tools act on behalf of. */
export interface CherryAgentContext {
  agentId: string
  workspaceSource: AgentSessionWorkspaceSource
  workspacePath: string
  /** Notification recipients authorized for this exact turn, supplied only by the runtime. */
  trustedNotifyChannels?: readonly NotifyChannel[]
  /** Source-channel turns may explicitly select another live channel owned by this Agent. */
  allowAnyOwnedNotifyChannel?: boolean
  /** Built-in Assistant can use every knowledge base without a configured binding. Re-read live so deletion fails closed. */
  canAccessAllKnowledgeBases?: () => boolean
  /**
   * Read this agent's effective knowledge scope — `resolveKnowledgeBaseScope(binding,
   * composerSelection)`, not the raw binding. The binding half is re-read live; the composer
   * selection half is frozen when the connection is built. An empty list means neither source
   * granted access. The autonomy tools ignore this field.
   */
  getKnowledgeBaseIds: () => string[]
}

type CherryAutonomyContext = CherryAgentContext & {
  /** Trusted current Session identity injected by settingsBuilder; never accepted from tool args. */
  sessionId: string
}

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
  name: CRON_TOOL_NAME,
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
          'Channel IDs to send task results to. Omit to use this turn’s configured notification recipients; use an empty array [] to skip channel delivery. Explicit IDs must be configured recipients, except a source-channel session may select another live channel owned by this Agent.'
      },
      timeout_minutes: {
        type: 'number',
        description:
          'Timeout in minutes before the task is aborted. Default is 2. Increase for long-running tasks (e.g. 10).'
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
  name: NOTIFY_TOOL_NAME,
  description:
    'Deliver a message, a workspace file, or both to this turn’s configured notification recipients. Files are first-class deliverables: use file_path for final workspace artifacts. Telegram/Feishu/WeChat forward any file, and WeChat sends video as native video media; Discord/Slack/QQ do not support files yet. Omit channel_id to deliver to all configured recipients; provide channel_id only to select one configured recipient. In a source-channel session, channel_id may also select another live channel owned by this Agent.',
  inputSchema: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description: 'The notification message to send to the user. Optional if file_path is provided.'
      },
      file_path: {
        type: 'string',
        description:
          'A workspace file to deliver. Provide this, message, or both. Use a relative path or an absolute path inside the session workspace.'
      },
      channel_id: {
        type: 'string',
        description:
          'Optional explicit destination channel. Omit to deliver to all configured recipients for this turn.'
      }
    }
    // ponytail: no root anyOf — some providers (xAI) reject union root schemas; the handler
    // enforces "message or file_path" on the trimmed values anyway.
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
    required: ['app_id', 'app_secret', 'encrypt_key', 'verification_token', 'domain'],
    optional: ['allowed_chat_ids'],
    description:
      'Feishu/Lark bot. Set auth_mode to "qr" to register interactively without config. For credential setup, provide all required fields and set domain to "feishu" or "lark".'
  },
  qq: {
    required: ['app_id', 'client_secret'],
    optional: ['allowed_chat_ids'],
    description: 'QQ official bot via QQ Open Platform.'
  },
  wechat: {
    required: ['token_path'],
    optional: ['allowed_chat_ids'],
    description:
      'WeChat via local WeChat desktop client bridge. Set auth_mode to "qr" to log in interactively without config. For an existing login, provide its token_path.'
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
  name: CONFIG_TOOL_NAME,
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
        description:
          "Adapter-specific configuration (required for credential-based 'add_channel', optional for QR authentication and 'update_channel')"
      },
      auth_mode: {
        type: 'string',
        enum: ['credentials', 'qr'],
        description:
          'Authentication mode for add_channel. Use "qr" only with WeChat or Feishu for interactive setup; defaults to "credentials".'
      },
      enabled: {
        type: 'boolean',
        description:
          'Enable or disable the channel (optional; defaults to true on add, unchanged when omitted on update)'
      }
    },
    required: ['action']
  }
}

const SESSION_LIST_TOOL: Tool = {
  name: SESSION_LIST_TOOL_NAME,
  description:
    'List active Cherry Agent Sessions that can receive a message. Returns both agentId and sessionId for every address.',
  inputSchema: {
    type: 'object',
    properties: {
      agent_id: { type: 'string', description: 'Optional Agent id filter.' },
      cursor: { type: 'string', description: 'Opaque cursor returned by the previous page.' },
      limit: { type: 'number', description: 'Maximum Sessions to return (default 50, max 100).' }
    }
  }
}

const SESSION_SEARCH_TOOL: Tool = {
  name: SESSION_SEARCH_TOOL_NAME,
  description: 'Search visible Cherry Agent Sessions by metadata and message evidence.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        maxLength: 4096,
        description: 'Natural-language or keyword query, ranked by lexical relevance.'
      },
      agent_id: { type: 'string', description: 'Optional Agent id filter.' },
      limit: { type: 'number', description: 'Maximum Sessions to return (default 20, max 100).' }
    },
    required: ['query']
  }
}

const SESSION_DELIVERIES_TOOL: Tool = {
  name: SESSION_DELIVERIES_TOOL_NAME,
  description: 'Inspect durable incoming or outgoing cross-Session requests, results, and delivery state.',
  inputSchema: {
    type: 'object',
    properties: {
      direction: { type: 'string', enum: ['incoming', 'outgoing'] },
      request_id: { type: 'string', description: 'Optional request id; correlated results are included.' },
      status: { type: 'string', enum: ['accepted', 'delivering', 'consumed', 'failed'] },
      limit: { type: 'number', description: 'Maximum deliveries to return (default 20, max 100).' }
    }
  }
}

const SESSION_CREATE_TOOL: Tool = {
  name: SESSION_CREATE_TOOL_NAME,
  description:
    'Create a new Session for the current Agent and send its first durable message. The new Session inherits the current workspace policy and uses the Agent model.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'First message for the new Session.' },
      title: { type: 'string', maxLength: 255, description: 'Optional Session title.' }
    },
    required: ['message']
  }
}

const SESSION_SEND_TOOL: Tool = {
  name: SESSION_SEND_TOOL_NAME,
  description:
    'Send a durable message to another Cherry Agent Session. Sender agentId/sessionId are injected by the trusted runtime and cannot be supplied by the caller.',
  inputSchema: {
    type: 'object',
    properties: {
      target_session_id: {
        type: 'string',
        description: 'Target sessionId returned by session_list or delivery sender.'
      },
      message: { type: 'string', description: 'Message for the target Agent.' },
      reply: {
        type: 'string',
        enum: ['none', 'completion'],
        description: 'completion returns one asynchronous terminal result in a separate turn.'
      }
    },
    required: ['target_session_id', 'message']
  }
}

const AUTONOMY_TOOLS: readonly Tool[] = [
  CRON_TOOL,
  NOTIFY_TOOL,
  CONFIG_TOOL,
  SESSION_LIST_TOOL,
  SESSION_SEARCH_TOOL,
  SESSION_CREATE_TOOL,
  SESSION_DELIVERIES_TOOL,
  SESSION_SEND_TOOL
]

export class CherryAutonomyTools {
  private agentId: string
  private sessionId: string
  private workspace: AgentSessionWorkspaceSource
  private workspacePath: string
  private trustedNotifyChannels: readonly NotifyChannel[]
  private allowAnyOwnedNotifyChannel: boolean

  constructor(context: CherryAutonomyContext) {
    this.agentId = context.agentId
    this.sessionId = context.sessionId
    this.workspace = context.workspaceSource
    this.workspacePath = context.workspacePath
    this.trustedNotifyChannels = context.trustedNotifyChannels ?? []
    this.allowAnyOwnedNotifyChannel = context.allowAnyOwnedNotifyChannel === true
  }

  tools(): Tool[] {
    return AUTONOMY_TOOLS.flatMap((tool) => {
      if (tool.name !== NOTIFY_TOOL_NAME) return [tool]
      return this.trustedNotifyChannels.length > 0
        ? [
            {
              ...tool,
              description: `${tool.description} Configured recipients: ${this.trustedNotifyChannels.map((channel) => `${channel.type} (${channel.id})`).join(', ')}.`
            }
          ]
        : []
    })
  }

  handles(toolName: string): boolean {
    // Keep hidden tools routable so a stale catalog receives the policy error from `call()`.
    return AUTONOMY_TOOLS.some((tool) => tool.name === toolName)
  }

  async call(toolName: string, args: Record<string, unknown>): Promise<CallToolResult> {
    try {
      switch (toolName) {
        case CRON_TOOL_NAME: {
          const action = args.action
          switch (action) {
            case 'add':
              return await this.addJob(args)
            case 'list':
              return this.listJobs()
            case 'remove':
              return await this.removeJob(args)
            default:
              throw new McpError(ErrorCode.InvalidParams, `Unknown action "${action}", expected add/list/remove`)
          }
        }
        case NOTIFY_TOOL_NAME:
          if (this.trustedNotifyChannels.length === 0) {
            throw new McpError(
              ErrorCode.InvalidRequest,
              'notify is unavailable because this turn has no configured notification recipients'
            )
          }
          return await this.sendNotification(args)
        case SESSION_LIST_TOOL_NAME:
          return this.listSessions(args)
        case SESSION_SEARCH_TOOL_NAME:
          return this.searchSessions(args)
        case SESSION_CREATE_TOOL_NAME:
          return await this.createSession(args)
        case SESSION_DELIVERIES_TOOL_NAME:
          return this.listSessionDeliveries(args)
        case SESSION_SEND_TOOL_NAME:
          return await this.sendSessionMessage(args)
        case CONFIG_TOOL_NAME: {
          const action = args.action
          switch (action) {
            case 'status':
              return this.configStatus()
            case 'rename':
              return this.configRename(args)
            case 'add_channel':
              return await this.configAddChannel(args)
            case 'update_channel':
              return await this.configUpdateChannel(args)
            case 'remove_channel':
              return await this.configRemoveChannel(args)
            case 'reconnect_channel':
              return await this.configReconnectChannel(args)
            case 'complete_bootstrap':
              return this.configCompleteBootstrap()
            case 'reset_bootstrap':
              return this.configResetBootstrap()
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
      if (!(error instanceof AgentSessionDeliveryRoutingError)) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${message}` }],
          isError: true
        }
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify({ ok: false, error: { code: error.code, message } }) }],
        isError: true
      }
    }
  }

  private assertCurrentSessionIdentity(): void {
    const session = agentSessionService.getById(this.sessionId)
    if (session.agentId !== this.agentId) {
      throw new AgentSessionDeliveryRoutingError('SENDER_FORBIDDEN', 'The active runtime no longer owns this Session')
    }
  }

  private assertSessionToolsAuthorized(): void {
    const interaction = application.get('AgentSessionRuntimeService').getInteractionState(this.sessionId)
    if (interaction.currentTurn === 'headless' || interaction.userResponse === 'unavailable') {
      throw new AgentSessionDeliveryRoutingError(
        'SESSION_TOOL_FORBIDDEN',
        'Cross-Session discovery and delegation require an interactive user turn'
      )
    }
  }

  private listSessions(args: Record<string, unknown>) {
    this.assertCurrentSessionIdentity()
    this.assertSessionToolsAuthorized()
    const agentId = typeof args.agent_id === 'string' && args.agent_id.trim() ? args.agent_id.trim() : undefined
    const cursor = typeof args.cursor === 'string' && args.cursor.trim() ? args.cursor.trim() : undefined
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 50
    const page = agentSessionService.listAddressableByCursor({ agentId, cursor, limit })
    const sessions = page.items.map((session) => ({
      ...session,
      isCurrent: session.sessionId === this.sessionId
    }))
    return {
      content: [{ type: 'text' as const, text: JSON.stringify({ sessions, nextCursor: page.nextCursor }) }]
    }
  }

  private searchSessions(args: Record<string, unknown>) {
    this.assertCurrentSessionIdentity()
    this.assertSessionToolsAuthorized()
    const query = typeof args.query === 'string' ? args.query.trim() : ''
    if (!query) throw new McpError(ErrorCode.InvalidParams, "'query' is required")
    if (query.length > 4096) throw new McpError(ErrorCode.InvalidParams, "'query' must be at most 4096 characters")
    const agentId = typeof args.agent_id === 'string' && args.agent_id.trim() ? args.agent_id.trim() : undefined
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 20
    const matches = agentSessionMessageService.searchRanked({ q: query, limit, agentId, addressableOnly: true })
    const sessions = new Map<
      string,
      {
        agentId?: string
        agentName?: string
        sessionId: string
        sessionName: string
        isCurrent: boolean
        matches: Array<{ messageId: string; snippet: string; createdAt: string }>
        metadataMatches: Array<{ field: 'name' | 'description'; snippet: string }>
      }
    >()
    for (const match of matches) {
      const candidate = sessions.get(match.sessionId) ?? {
        agentId: match.agentId,
        agentName: match.agentName,
        sessionId: match.sessionId,
        sessionName: match.sessionName,
        isCurrent: match.sessionId === this.sessionId,
        matches: [],
        metadataMatches: []
      }
      candidate.matches.push({ messageId: match.messageId, snippet: match.snippet, createdAt: match.createdAt })
      sessions.set(match.sessionId, candidate)
    }
    for (const result of agentSessionService.searchWithMetadataEvidence({
      q: query,
      limit,
      agentId,
      addressableOnly: true
    })) {
      const match = result.item
      const existing = sessions.get(match.id)
      if (existing) {
        existing.metadataMatches.push(...result.matches)
        continue
      }
      if (sessions.size >= limit) continue
      sessions.set(match.id, {
        agentId: match.target.agentId ?? undefined,
        agentName: match.subtitle,
        sessionId: match.id,
        sessionName: match.title,
        isCurrent: match.id === this.sessionId,
        matches: [],
        metadataMatches: result.matches
      })
    }
    return { content: [{ type: 'text' as const, text: JSON.stringify({ sessions: [...sessions.values()] }) }] }
  }

  private listSessionDeliveries(args: Record<string, unknown>) {
    this.assertCurrentSessionIdentity()
    this.assertSessionToolsAuthorized()
    const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.trunc(args.limit), 1), 100) : 20
    if (args.direction !== undefined && args.direction !== 'incoming' && args.direction !== 'outgoing') {
      throw new McpError(ErrorCode.InvalidParams, "invalid 'direction'")
    }
    const direction = args.direction ?? 'incoming'
    const requestId = typeof args.request_id === 'string' ? args.request_id.trim() : undefined
    const statusResult = args.status === undefined ? undefined : AgentSessionDeliveryStatusSchema.safeParse(args.status)
    if (statusResult && !statusResult.success) throw new McpError(ErrorCode.InvalidParams, "invalid 'status'")
    const deliveries = agentSessionMessageService
      .listSessionDeliveries({
        sessionId: this.sessionId,
        direction,
        requestId,
        status: statusResult?.data,
        limit
      })
      .flatMap((message) =>
        message.delivery
          ? [
              {
                id: message.id,
                envelope: message.delivery,
                content: (message.data.parts ?? [])
                  .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                  .map((part) => part.text)
                  .join('\n')
              }
            ]
          : []
      )
    return { content: [{ type: 'text' as const, text: JSON.stringify({ deliveries }) }] }
  }

  private async createSession(args: Record<string, unknown>) {
    this.assertCurrentSessionIdentity()
    this.assertSessionToolsAuthorized()
    const content = typeof args.message === 'string' ? args.message.trim() : ''
    const title = typeof args.title === 'string' ? args.title.trim() : ''
    if (!content) throw new McpError(ErrorCode.InvalidParams, "'message' is required")
    if (args.title !== undefined && typeof args.title !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "'title' must be a string")
    }
    if (title.length > 255) throw new McpError(ErrorCode.InvalidParams, "'title' must be at most 255 characters")

    const created = application.get('AgentSessionDeliveryService').acceptWithNewSession({
      senderAgentId: this.agentId,
      senderSessionId: this.sessionId,
      sessionName: title,
      workspace: this.workspace,
      content
    })
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            agentId: created.session.agentId,
            sessionId: created.session.id,
            requestId: created.message.id,
            delivery: created.message.delivery
          })
        }
      ]
    }
  }

  private async sendSessionMessage(args: Record<string, unknown>) {
    this.assertCurrentSessionIdentity()
    this.assertSessionToolsAuthorized()
    const receiverSessionId = typeof args.target_session_id === 'string' ? args.target_session_id.trim() : ''
    const content = typeof args.message === 'string' ? args.message.trim() : ''
    const reply = args.reply === undefined ? 'none' : args.reply
    if (reply !== 'none' && reply !== 'completion') {
      throw new McpError(ErrorCode.InvalidParams, "'reply' must be none or completion")
    }
    if (!receiverSessionId) throw new McpError(ErrorCode.InvalidParams, "'target_session_id' is required")
    if (!content) throw new McpError(ErrorCode.InvalidParams, "'message' is required")

    const accepted = application.get('AgentSessionDeliveryService').accept({
      senderAgentId: this.agentId,
      senderSessionId: this.sessionId,
      receiverSessionId,
      content,
      replyPolicy: reply
    })
    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            requestId: accepted.id,
            status: 'accepted',
            delivery: accepted.delivery
          })
        }
      ]
    }
  }

  private getNotifyChannelAccess(
    channelId: string,
    adapters?: readonly { channelId: string; connected: boolean }[]
  ): 'allowed' | 'not-owned' | 'not-granted' {
    const channel = channelService.getChannel(channelId)
    if (!channel || channel.agentId !== this.agentId) return 'not-owned'
    if (this.trustedNotifyChannels.some((trustedChannel) => trustedChannel.id === channelId)) return 'allowed'
    // A dropped adapter stays registered for reconnection, so require a live connection here —
    // otherwise this fallback authorizes an offline channel the turn was never granted.
    return this.allowAnyOwnedNotifyChannel &&
      (adapters ?? application.get('ChannelManager').getAgentAdapters(this.agentId)).some(
        (adapter) => adapter.channelId === channelId && adapter.connected
      )
      ? 'allowed'
      : 'not-granted'
  }

  private async addJob(args: Record<string, unknown>) {
    const name = args.name as string | undefined
    const message = args.message as string | undefined
    const cronExpr = args.cron as string | undefined
    const every = args.every as string | undefined
    const at = args.at as string | undefined
    const rawChannelIds = args.channel_ids
    const timeoutMinutes = args.timeout_minutes as number | undefined
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for add")
    if (!message) throw new McpError(ErrorCode.InvalidParams, "'message' is required for add")

    // Determine trigger shape (cron expression / interval ms / one-shot timestamp)
    const scheduleCount = [cronExpr, every, at].filter(Boolean).length
    if (scheduleCount === 0) throw new McpError(ErrorCode.InvalidParams, "One of 'cron', 'every', or 'at' is required")
    if (scheduleCount > 1) throw new McpError(ErrorCode.InvalidParams, "Use only one of 'cron', 'every', or 'at'")

    let trigger: Trigger

    if (cronExpr) {
      trigger = { kind: 'cron', expr: cronExpr }
    } else if (every) {
      const minutes = parseDurationToMinutes(every)
      trigger = { kind: 'interval', ms: minutes * 60_000 }
    } else {
      const date = new Date(at!)
      if (isNaN(date.getTime())) throw new McpError(ErrorCode.InvalidParams, `Invalid timestamp: "${at}"`)
      trigger = { kind: 'once', at: date.getTime() }
    }

    let channelIds: string[] | undefined
    if (rawChannelIds !== undefined) {
      // Callers bypassing this tool's schema can pass a non-array; rejecting keeps it from being
      // read as omission and fanning out to every trusted recipient.
      if (!Array.isArray(rawChannelIds) || rawChannelIds.some((id) => typeof id !== 'string')) {
        throw new McpError(ErrorCode.InvalidParams, "'channel_ids' must be an array of channel ids")
      }
      channelIds = rawChannelIds as string[]
    } else if (this.trustedNotifyChannels.length > 0) {
      channelIds = this.trustedNotifyChannels.map((channel) => channel.id)
    }

    // Task targets have the same live ownership and turn authority requirements as immediate notifications.
    for (const channelId of channelIds ?? []) {
      const access = this.getNotifyChannelAccess(channelId)
      if (access === 'not-owned') throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)
      if (access === 'not-granted') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Channel "${channelId}" is not a configured notification recipient for this turn`
        )
      }
    }

    const task = application.get('AgentJobsService').createTask(this.agentId, {
      name,
      prompt: message,
      trigger,
      workspace: this.workspace,
      timeoutMinutes: timeoutMinutes && timeoutMinutes > 0 ? timeoutMinutes : undefined,
      channelIds: channelIds && channelIds.length > 0 ? channelIds : undefined
    })

    logger.info('Cron job created via tool', { agentId: this.agentId, taskId: task.id })
    return {
      content: [{ type: 'text' as const, text: `Job created:\n${JSON.stringify(task, null, 2)}` }]
    }
  }

  private listJobs() {
    const { tasks } = taskService.listTasks(this.agentId, { limit: 100 })

    if (tasks.length === 0) {
      return { content: [{ type: 'text' as const, text: 'No scheduled jobs.' }] }
    }

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(tasks, null, 2) }]
    }
  }

  private async sendNotification(args: Record<string, unknown>) {
    const message = typeof args.message === 'string' ? args.message.trim() : undefined
    const filePath = typeof args.file_path === 'string' ? args.file_path.trim() : undefined
    if (!message && !filePath) {
      throw new McpError(ErrorCode.InvalidParams, "Provide 'message', 'file_path', or both for notify")
    }

    const explicitChannelId = typeof args.channel_id === 'string' ? args.channel_id.trim() : undefined
    if (args.channel_id !== undefined && !explicitChannelId) {
      throw new McpError(ErrorCode.InvalidParams, "'channel_id' must not be empty")
    }
    const targetChannelIds = explicitChannelId
      ? [explicitChannelId]
      : this.trustedNotifyChannels.map((channel) => channel.id)
    const targetChannelIdSet = new Set(targetChannelIds)
    const allAgentAdapters = application.get('ChannelManager').getAgentAdapters(this.agentId)
    for (const channelId of targetChannelIdSet) {
      if (this.getNotifyChannelAccess(channelId, allAgentAdapters) !== 'allowed') {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `Channel "${channelId}" is not a configured notification recipient for this turn`
        )
      }
    }

    const adapters = allAgentAdapters.filter((adapter) => targetChannelIdSet.has(adapter.channelId))
    const availableChannelIds = new Set(adapters.map((adapter) => adapter.channelId))
    const unavailableChannelIds = [...targetChannelIdSet].filter((channelId) => !availableChannelIds.has(channelId))
    if (unavailableChannelIds.length > 0) {
      const recipients = unavailableChannelIds.join(', ')
      const unavailableMessage =
        unavailableChannelIds.length === 1
          ? `Configured notification recipient is unavailable: ${recipients}.`
          : `Configured notification recipients are unavailable: ${recipients}.`
      throw new McpError(ErrorCode.InvalidRequest, unavailableMessage)
    }

    // Resolve the file once after recipient validation so a bad path fails before dispatch.
    const file = filePath ? await resolveWorkspaceFile(this.workspacePath, filePath) : undefined
    const sanitizedMessage = message ? sanitizeChannelOutput(message).text : undefined

    let messagesSent = 0
    let filesSent = 0
    const errors: string[] = []

    const recordError = (adapter: ChannelAdapter, chatId: string, what: string, err: unknown) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      errors.push(`${adapter.channelId}/${chatId} (${what}): ${errMsg}`)
      // Log the raw error, not just its message, so the SDK's cause chain and any
      // attached `response` payload survive to the logs for diagnosis.
      logger.warn(`Failed to send ${what} via notify`, {
        agentId: this.agentId,
        channelId: adapter.channelId,
        chatId,
        error: err
      })
    }

    for (const adapter of adapters) {
      for (const chatId of adapter.notifyChatIds) {
        // Message and file are independent — one failing must not skip the other.
        if (sanitizedMessage) {
          try {
            await adapter.sendMessage(chatId, sanitizedMessage)
            messagesSent++
          } catch (err) {
            recordError(adapter, chatId, 'message', err)
          }
        }
        if (file) {
          try {
            await adapter.sendFile(chatId, file)
            filesSent++
          } catch (err) {
            recordError(adapter, chatId, 'file', err)
          }
        }
      }
    }

    const parts: string[] = []
    if (sanitizedMessage) parts.push(`Message sent to ${messagesSent} chat(s).`)
    if (file) parts.push(`File "${file.filename}" sent to ${filesSent} chat(s).`)
    if (errors.length > 0) parts.push(`Errors: ${errors.join('; ')}`)

    logger.info('Notification sent via notify tool', {
      agentId: this.agentId,
      messagesSent,
      filesSent,
      errors: errors.length
    })

    // A requested payload that reached nobody because every attempt failed is a failed
    // tool call — otherwise the agent sees success while the user received nothing
    // (unsupported adapter, platform size reject, etc.). Zero recipients with no failed
    // attempts (no chats configured) stays a normal result.
    const messageFailed = sanitizedMessage !== undefined && messagesSent === 0
    const fileFailed = file !== undefined && filesSent === 0
    const deliveryFailed = errors.length > 0 && (messageFailed || fileFailed)

    return {
      content: [{ type: 'text' as const, text: parts.join(' ') }],
      ...(deliveryFailed ? { isError: true } : {})
    }
  }

  // ── Config tool handlers ──────────────────────────────────────────

  private configStatus() {
    const agent = agentService.getAgent(this.agentId)
    if (!agent) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)

    const config = agent.configuration
    const channels = channelService.listChannels({ agentId: this.agentId })

    const adapterStatuses = application.get('ChannelManager').getAdapterStatuses(this.agentId)
    const statusMap = new Map(adapterStatuses.map((s) => [s.channelId, s.connected]))

    const channelSummary = channels.map((ch) => ({
      id: ch.id,
      type: ch.type,
      name: ch.name,
      enabled: ch.isActive,
      connected: statusMap.get(ch.id) ?? false
    }))

    const result = {
      agentId: agent.id,
      name: agent.name,
      model: agent.model,
      supported_channel_types: Object.entries(CHANNEL_CONFIG_SCHEMAS).map(([type, schema]) => ({
        type,
        description: schema.description,
        required_fields: schema.required,
        optional_fields: schema.optional
      })),
      channels: channelSummary,
      heartbeat_enabled: config?.heartbeat_enabled ?? false
    }

    logger.info('Config status queried', { agentId: this.agentId })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }]
    }
  }

  private async configAddChannel(args: Record<string, unknown>) {
    const type = typeof args.type === 'string' ? args.type : undefined
    const name = typeof args.name === 'string' ? args.name : undefined
    const authMode = typeof args.auth_mode === 'string' ? args.auth_mode : 'credentials'
    const enabled = typeof args.enabled === 'boolean' ? args.enabled : undefined
    const rawConfig = args.config

    if (!type) throw new McpError(ErrorCode.InvalidParams, "'type' is required for add_channel")
    if (!name) throw new McpError(ErrorCode.InvalidParams, "'name' is required for add_channel")
    if (rawConfig !== undefined && (typeof rawConfig !== 'object' || rawConfig === null || Array.isArray(rawConfig))) {
      throw new McpError(ErrorCode.InvalidParams, "'config' must be an object")
    }
    if (args.auth_mode !== undefined && typeof args.auth_mode !== 'string') {
      throw new McpError(ErrorCode.InvalidParams, "'auth_mode' must be a string")
    }
    if (args.enabled !== undefined && typeof args.enabled !== 'boolean') {
      throw new McpError(ErrorCode.InvalidParams, "'enabled' must be a boolean")
    }

    const schema = CHANNEL_CONFIG_SCHEMAS[type]
    if (!schema) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown channel type "${type}". Supported: ${Object.keys(CHANNEL_CONFIG_SCHEMAS).join(', ')}`
      )
    }

    if (authMode !== 'credentials' && authMode !== 'qr') {
      throw new McpError(ErrorCode.InvalidParams, `Unknown auth_mode "${authMode}", expected credentials/qr`)
    }
    if (authMode === 'qr' && type !== 'wechat' && type !== 'feishu') {
      throw new McpError(ErrorCode.InvalidParams, `QR authentication is not supported for ${type} channels`)
    }
    if (authMode === 'qr' && enabled === false) {
      throw new McpError(ErrorCode.InvalidParams, 'QR authentication requires the channel to be enabled')
    }

    let cfg: object = rawConfig ?? {}
    if (authMode === 'qr' && type === 'wechat') {
      cfg = { ...rawConfig, token_path: '' }
    } else if (authMode === 'qr' && type === 'feishu') {
      const unverifiedChannels = channelService
        .listChannels({ agentId: this.agentId, type: 'feishu' })
        .filter((channel) => channel.type === 'feishu' && !(channel.config.app_id && channel.config.app_secret))

      if (unverifiedChannels.length > 1) {
        const channelIds = unverifiedChannels.map((channel) => channel.id).join(', ')
        throw new McpError(
          ErrorCode.InvalidParams,
          `Multiple unverified Feishu channels already exist (${channelIds}). Use reconnect_channel with the intended channel_id instead of creating another channel.`
        )
      }

      const existingChannel = unverifiedChannels[0]
      cfg = {
        allowed_chat_ids: [],
        domain: 'feishu',
        ...existingChannel?.config,
        ...rawConfig,
        app_id: '',
        app_secret: '',
        encrypt_key: '',
        verification_token: ''
      }

      if (existingChannel) {
        const config = ChannelConfigSchema.parse({ type, ...cfg })
        const updated = channelService.updateChannel(existingChannel.id, {
          name,
          config,
          isActive: true
        })
        if (updated && updated.name !== existingChannel.name) agentSessionService.notifySourceProjectionChange()
        return await this.configReconnectChannel({ channel_id: existingChannel.id })
      }
    }
    if (authMode === 'credentials') {
      for (const field of schema.required) {
        if (!(field in cfg) || !cfg[field]) {
          throw new McpError(ErrorCode.InvalidParams, `Missing required config field "${field}" for ${type} channel`)
        }
      }
    }

    const config = ChannelConfigSchema.parse({ type, ...cfg })
    const channelType = config.type

    // For channels that use QR-based setup (WeChat login, Feishu app registration),
    // connect is blocking (waits for QR scan), so run sync in background
    // and wait only for the QR URL to return it to the agent.
    const needsQr = authMode === 'qr'

    if (needsQr) {
      const newChannel = channelService.createChannel({
        type: channelType,
        name,
        agentId: this.agentId,
        workspace: this.workspace,
        config,
        isActive: enabled ?? true
      })

      const channelManager = application.get('ChannelManager')
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

    const newChannel = await agentChannelWorkflowService.createChannel({
      type: channelType,
      name,
      agentId: this.agentId,
      workspace: this.workspace,
      config,
      isActive: enabled ?? true
    })

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

    const existing = channelService.getChannel(channelId)
    if (!existing) throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)
    if (existing.agentId !== this.agentId)
      throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)

    const updates: Record<string, unknown> = {}
    if (args.name !== undefined) updates.name = args.name as string
    if (args.enabled !== undefined) updates.isActive = args.enabled as boolean
    if (args.config !== undefined) {
      updates.config = { ...existing.config, ...(args.config as Record<string, unknown>) }
    }

    await agentChannelWorkflowService.updateChannel(channelId, updates)

    logger.info('Channel updated via config tool', { agentId: this.agentId, channelId })
    return {
      content: [{ type: 'text' as const, text: `Channel "${channelId}" updated and reloaded.` }]
    }
  }

  private async configRemoveChannel(args: Record<string, unknown>) {
    const channelId = args.channel_id as string | undefined
    if (!channelId) throw new McpError(ErrorCode.InvalidParams, "'channel_id' is required for remove_channel")

    const channel = channelService.getChannel(channelId)
    if (!channel) throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)
    if (channel.agentId !== this.agentId)
      throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)

    await agentChannelWorkflowService.deleteChannel(channelId)

    logger.info('Channel removed via config tool', { agentId: this.agentId, channelId, type: channel.type })
    return {
      content: [{ type: 'text' as const, text: `Channel "${channelId}" (${channel.name}) removed.` }]
    }
  }

  private async configReconnectChannel(args: Record<string, unknown>) {
    const channelId = args.channel_id as string | undefined
    if (!channelId) throw new McpError(ErrorCode.InvalidParams, "'channel_id' is required for reconnect_channel")

    const channel = channelService.getChannel(channelId)
    if (!channel) throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)
    if (channel.agentId !== this.agentId)
      throw new McpError(ErrorCode.InvalidParams, `Channel "${channelId}" not found`)

    const needsQr =
      channel.type === 'wechat' || (channel.type === 'feishu' && !(channel.config.app_id && channel.config.app_secret))

    const channelManager = application.get('ChannelManager')
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

  private configRename(args: Record<string, unknown>) {
    const name = typeof args.name === 'string' ? args.name : undefined
    if (!name || !name.trim()) throw new McpError(ErrorCode.InvalidParams, "'name' is required for rename")

    agentService.updateAgent(this.agentId, { name: name.trim() })

    logger.info('Agent renamed via config tool', { agentId: this.agentId, name: name.trim() })
    return {
      content: [{ type: 'text' as const, text: `Agent renamed to "${name.trim()}".` }]
    }
  }

  private configCompleteBootstrap() {
    const updated = agentService.updateAgent(this.agentId, { configuration: { bootstrap_completed: true } })
    if (!updated) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)

    logger.info('Bootstrap marked as completed', { agentId: this.agentId })
    return {
      content: [
        { type: 'text' as const, text: 'Bootstrap completed. Future sessions will use your standard personality.' }
      ]
    }
  }

  private configResetBootstrap() {
    const updated = agentService.updateAgent(this.agentId, { configuration: { bootstrap_completed: false } })
    if (!updated) throw new McpError(ErrorCode.InternalError, `Agent not found: ${this.agentId}`)

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
      await agentChannelWorkflowService.deleteChannel(channelId)
    } catch (err) {
      logger.error('Failed to remove orphan channel', {
        agentId: this.agentId,
        channelId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private async removeJob(args: Record<string, unknown>) {
    const id = typeof args.id === 'string' ? args.id : undefined
    if (!id) throw new McpError(ErrorCode.InvalidParams, "'id' is required for remove")

    const deleted = await application.get('AgentJobsService').deleteTask(this.agentId, id)
    if (!deleted) throw new McpError(ErrorCode.InvalidParams, `Job "${id}" not found`)

    logger.info('Cron job removed via tool', { agentId: this.agentId, taskId: id })
    return {
      content: [{ type: 'text' as const, text: `Job "${id}" removed.` }]
    }
  }
}
