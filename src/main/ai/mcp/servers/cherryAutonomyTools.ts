/**
 * Agent autonomy tools (cron / notify / config / session_*) hosted by the in-process
 * `cherry-tools` MCP server (see `cherryBuiltinTools.ts`).
 *
 * Unlike the stateless builtin lookup tools, these act on behalf of a specific
 * agent (schedule its tasks, notify through its channels, delegate to other Sessions,
 * manage its own configuration), so they take the per-session agent context.
 */

import type { CallToolResult, McpServer } from '@modelcontextprotocol/server'
import QRCode from 'qrcode'
import * as z from 'zod'

import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { AgentSessionDeliveryRoutingError, agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentTaskService as taskService } from '@data/services/AgentTaskService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import {
  createAgentChannel,
  createAgentChannelAndWaitForQr,
  deleteAgentChannel,
  reconnectAgentChannel,
  reconnectAgentChannelWithQr,
  type ChannelAdapter,
  resolveWorkspaceFile,
  sanitizeChannelOutput,
  updateAgentChannel,
  updateAgentChannelAndWaitForQr
} from '@main/ai/channels'
import { conversationEvidence } from '@main/ai/messages/conversationEvidence'
import { findPersistedToolOutput } from '@main/ai/messages/persistedToolOutput'
import { readConversation, type ReadConversationInput } from '@main/ai/messages/readConversation'
import type { NotifyChannel } from '@main/ai/runtime/agentMcpServers'
import { runtimeDriverRegistry } from '@main/ai/runtime/registry'
import { isHeartbeatEnabled } from '@shared/ai/agentHeartbeat'
import {
  AgentSessionDeliveryStatusSchema,
  SESSION_CREATE_TOOL_NAME,
  SESSION_DELIVERIES_TOOL_NAME,
  SESSION_LIST_TOOL_NAME,
  SESSION_READ_TOOL_NAME,
  SESSION_SEARCH_TOOL_NAME,
  SESSION_SEND_TOOL_NAME
} from '@shared/ai/agentSessionDelivery'
import { CONFIG_TOOL_NAME, CRON_TOOL_NAME, NOTIFY_TOOL_NAME } from '@shared/ai/builtinTools'
import { TimeoutMinutesAtomSchema } from '@shared/data/api/schemas/agents'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import { JOB_ERROR_CODES, type Trigger } from '@shared/data/api/schemas/jobs'
import { ChannelConfigSchema } from '@shared/data/types/channel'

const logger = loggerService.withContext('McpServer:CherryAutonomyTools')

const AGENT_LIST_TOOL_NAME = 'agent_list'

/** Per-session agent context the autonomy tools act on behalf of. */
export interface AutonomyToolsContext {
  agentId: string
  /** Trusted current Session identity injected by the runtime; never accepted from tool args. */
  sessionId: string
  workspaceSource: AgentSessionWorkspaceSource
  workspacePath: string
  /** Notification recipients authorized for this exact turn, supplied only by the runtime. */
  trustedNotifyChannels: readonly NotifyChannel[]
  /** Source-channel turns may explicitly select another live channel owned by this Agent. */
  allowAnyOwnedNotifyChannel: boolean
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

const CRON_DESCRIPTION =
  "Manage scheduled tasks. Use action 'add' to create a recurring or one-time job, 'update' with an id to change only the supplied fields, 'list' to see this Agent's jobs, or 'remove' to delete a job. Edit existing jobs with 'update' instead of removing and re-creating them. For one-time jobs, use the 'at' field with an RFC3339 timestamp."

const CronInputSchema = z.object({
  action: z.enum(['add', 'update', 'list', 'remove']).describe('The action to perform'),
  name: z
    .string()
    .min(1)
    .optional()
    .describe('Name of the job (required for add). Names are unique across all Agents, including disabled jobs.'),
  message: z.string().min(1).optional().describe('The prompt/instruction to execute on schedule (required for add)'),
  cron: z
    .string()
    .min(1)
    .optional()
    .describe("Cron expression, e.g. '0 9 * * 1-5' for weekdays at 9am (use cron OR every, not both)"),
  every: z.string().min(1).optional().describe("Duration, e.g. '30m', '2h', '24h' (use every OR cron, not both)"),
  at: z
    .string()
    .min(1)
    .optional()
    .describe(
      "RFC3339 timestamp for a one-time job, e.g. '2024-01-15T14:30:00+08:00' (use at OR cron OR every, not combined)"
    ),
  channel_ids: z
    .array(z.string())
    .optional()
    .describe(
      'Channel IDs to send task results to. On add, omit to use this turn’s configured notification recipients; on update, omit to keep existing recipients; use an empty array [] to skip channel delivery. Explicit IDs must be configured recipients, except a source-channel session may select another live channel owned by this Agent.'
    ),
  timeout_minutes: TimeoutMinutesAtomSchema.describe(
    'Timeout in minutes before the task is aborted. Default is 2 on add; omit on update to keep the current timeout. Use null for no timeout.'
  ),
  reuse_session: z
    .boolean()
    .optional()
    .describe(
      'Continue each execution in the same session. Default is false on add; omit on update to keep the current setting.'
    ),
  id: z.string().min(1).optional().describe('Job ID (required for update and remove)')
})
type CronInput = z.output<typeof CronInputSchema>

const NOTIFY_DESCRIPTION =
  'Deliver a message, a workspace file, or both to this turn’s configured notification recipients. Files are first-class deliverables: use file_path for final workspace artifacts. Telegram/Feishu/WeChat forward any file, and WeChat sends video as native video media; DingTalk forwards non-empty files up to 20 MiB with a platform-supported filename extension; Discord/Slack/QQ do not support files yet. Omit channel_id to deliver to all configured recipients; provide channel_id only to select one configured recipient. In a source-channel session, channel_id may also select another live channel owned by this Agent.'

// ponytail: no root union — some providers (xAI) reject union root schemas; the handler
// enforces "message or file_path" on the trimmed values anyway.
const NotifyInputSchema = z.object({
  message: z
    .string()
    .optional()
    .describe('The notification message to send to the user. Optional if file_path is provided.'),
  file_path: z
    .string()
    .optional()
    .describe(
      'A workspace file to deliver. Provide this, message, or both. Use a relative path or an absolute path inside the session workspace.'
    ),
  channel_id: z
    .string()
    .optional()
    .describe('Optional explicit destination channel. Omit to deliver to all configured recipients for this turn.')
})
type NotifyInput = z.output<typeof NotifyInputSchema>

/** Per-adapter-type config schema descriptions (for agent self-documentation). */
const CHANNEL_CONFIG_SCHEMAS: Record<string, { required: string[]; optional: string[]; description: string }> = {
  dingtalk: {
    required: ['client_id', 'client_secret', 'robot_code'],
    optional: ['allowed_chat_ids', 'allowed_user_ids', 'card_template_id'],
    description:
      'DingTalk internal app robot. Enable Stream mode. Chat IDs: dm:<senderStaffId> or group:<conversationId>. Both allowlists must match when configured. Optional AI card template uses msgContent and flowStatus fields.'
  },
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

const CONFIG_DESCRIPTION =
  "Inspect and manage your own agent configuration. Use 'status' to see current channels, model, and supported adapter types. Use 'rename' to change your display name. Use 'add_channel', 'update_channel', 'remove_channel', or 'reconnect_channel' to manage IM channel connections. Use 'reconnect_channel' when a WeChat or Feishu channel needs to re-scan a QR code (e.g. session expired or initial setup failed). Use 'complete_bootstrap' to mark the onboarding ritual as done. Use 'reset_bootstrap' to re-run the onboarding in the next session."

const ConfigInputSchema = z.object({
  action: z
    .enum([
      'status',
      'rename',
      'add_channel',
      'update_channel',
      'remove_channel',
      'reconnect_channel',
      'complete_bootstrap',
      'reset_bootstrap'
    ])
    .describe('The action to perform'),
  type: z
    .enum(Object.keys(CHANNEL_CONFIG_SCHEMAS) as [string, ...string[]])
    .optional()
    .describe("Channel adapter type (required for 'add_channel')"),
  name: z
    .string()
    .optional()
    .describe("For 'rename': the new agent display name. For 'add_channel': human-readable channel name."),
  channel_id: z.string().optional().describe("Channel ID (required for 'update_channel' and 'remove_channel')"),
  config: z
    .record(z.string(), z.unknown())
    .optional()
    .describe(
      "Adapter-specific configuration (required for credential-based 'add_channel', optional for QR authentication and 'update_channel')"
    ),
  auth_mode: z
    .enum(['credentials', 'qr'])
    .optional()
    .describe(
      'Authentication mode for add_channel. Use "qr" only with WeChat or Feishu for interactive setup; defaults to "credentials".'
    ),
  enabled: z
    .boolean()
    .optional()
    .describe('Enable or disable the channel (optional; defaults to true on add, unchanged when omitted on update)')
})
type ConfigInput = z.output<typeof ConfigInputSchema>

const SessionListInputSchema = z.object({
  agent_id: z.string().optional().describe('Optional Agent id filter.'),
  cursor: z.string().optional().describe('Opaque cursor returned by the previous page.'),
  limit: z.number().optional().describe('Maximum Sessions to return (default 50, max 100).')
})

const SessionSearchInputSchema = z.object({
  query: z.string().max(4096).describe('Natural-language or keyword query, ranked by lexical relevance.'),
  agent_id: z.string().optional().describe('Optional Agent id filter.'),
  limit: z.number().optional().describe('Maximum Sessions to return (default 20, max 100).')
})

const SessionReadInputSchema = z.strictObject({
  session_id: z.string().min(1).describe('Chat topic, Agent Session, or temporary conversation id.'),
  cursor: z.string().optional().describe('Opaque cursor returned by the previous page.'),
  limit: z.number().int().positive().optional().describe('Maximum messages to return.'),
  node_id: z.string().optional().describe('Topic branch endpoint message id.'),
  include_siblings: z.boolean().optional().describe('Include sibling replies for topic messages.'),
  message_id: z.string().min(1).optional().describe('Read one exact message in the conversation.'),
  tool_call_id: z.string().min(1).optional().describe('Restore the persisted output for message_id tool call.')
})

const SessionDeliveriesInputSchema = z.object({
  direction: z.enum(['incoming', 'outgoing']).optional(),
  request_id: z.string().optional().describe('Optional request id; correlated results are included.'),
  status: AgentSessionDeliveryStatusSchema.optional(),
  limit: z.number().optional().describe('Maximum deliveries to return (default 20, max 100).')
})

const SessionCreateInputSchema = z.object({
  message: z.string().describe('First message for the new Session.'),
  title: z.string().max(255).optional().describe('Optional Session title.'),
  target_agent_id: z.string().optional().describe('Optional target Agent id.')
})

const SessionSendInputSchema = z.object({
  target_session_id: z.string().describe('Target sessionId returned by session_list or delivery sender.'),
  message: z.string().describe('Message for the target Agent.'),
  reply: z
    .enum(['none', 'completion'])
    .optional()
    .describe('completion returns one asynchronous terminal result in a separate turn.')
})

function assertCurrentSessionIdentity(ctx: AutonomyToolsContext): void {
  const session = agentSessionService.getById(ctx.sessionId)
  if (session.agentId !== ctx.agentId) {
    throw new AgentSessionDeliveryRoutingError('SENDER_FORBIDDEN', 'The active runtime no longer owns this Session')
  }
}

function assertSessionToolsAuthorized(ctx: AutonomyToolsContext): void {
  const interaction = application.get('AgentSessionRuntimeService').getInteractionState(ctx.sessionId)
  if (interaction.currentTurn === 'headless' || interaction.userResponse === 'unavailable') {
    throw new AgentSessionDeliveryRoutingError(
      'SESSION_TOOL_FORBIDDEN',
      'Cross-Session discovery and delegation require an interactive user turn, and this delivery-, channel-, or scheduled-triggered turn has none: the call was denied and did not run, and retrying it inside this turn cannot succeed. If this turn was started by a delivery with reply "completion", its final assistant output is returned to the sender automatically — finish the turn with your answer as normal output instead of calling session tools.'
    )
  }
}

/** Session tools share the sender gates; routing failures keep a machine-readable code for the model. */
async function runSessionTool(
  ctx: AutonomyToolsContext,
  run: () => CallToolResult | Promise<CallToolResult>
): Promise<CallToolResult> {
  try {
    assertCurrentSessionIdentity(ctx)
    assertSessionToolsAuthorized(ctx)
    return await run()
  } catch (error) {
    if (!(error instanceof AgentSessionDeliveryRoutingError)) throw error
    return {
      content: [
        { type: 'text', text: JSON.stringify({ ok: false, error: { code: error.code, message: error.message } }) }
      ],
      isError: true
    }
  }
}

function clampLimit(limit: number | undefined, fallback: number): number {
  return limit === undefined ? fallback : Math.min(Math.max(Math.trunc(limit), 1), 100)
}

function listSessions(ctx: AutonomyToolsContext, args: z.output<typeof SessionListInputSchema>): CallToolResult {
  const agentId = args.agent_id?.trim() || undefined
  const cursor = args.cursor?.trim() || undefined
  const page = agentSessionService.listAddressableByCursor({ agentId, cursor, limit: clampLimit(args.limit, 50) })
  const sessions = page.items.map((session) => ({
    ...session,
    isCurrent: session.sessionId === ctx.sessionId
  }))
  return {
    content: [{ type: 'text', text: JSON.stringify({ sessions, nextCursor: page.nextCursor }) }]
  }
}

function listAgents(): CallToolResult {
  const agents = agentService.listAgents().agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    description: agent.description ?? '',
    runtime: {
      type: agent.type,
      available: runtimeDriverRegistry.getAgentSessionDriver(agent.type) !== undefined
    },
    modelConfigured: agent.model !== null
  }))
  return { content: [{ type: 'text', text: JSON.stringify({ agents }) }] }
}

function searchSessions(ctx: AutonomyToolsContext, args: z.output<typeof SessionSearchInputSchema>): CallToolResult {
  const query = args.query.trim()
  if (!query) throw new Error("'query' is required")
  const agentId = args.agent_id?.trim() || undefined
  const limit = clampLimit(args.limit, 20)
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
      isCurrent: match.sessionId === ctx.sessionId,
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
      isCurrent: match.id === ctx.sessionId,
      matches: [],
      metadataMatches: result.matches
    })
  }
  return { content: [{ type: 'text', text: JSON.stringify({ sessions: [...sessions.values()] }) }] }
}

async function readSession(args: z.output<typeof SessionReadInputSchema>): Promise<CallToolResult> {
  const sessionId = args.session_id.trim()
  if (args.tool_call_id && !args.message_id) {
    throw new Error("'tool_call_id' requires 'message_id'")
  }

  const readInput: ReadConversationInput = {
    sessionId,
    cursor: args.cursor,
    limit: args.limit,
    nodeId: args.node_id,
    includeSiblings: args.include_siblings,
    messageId: args.message_id
  }
  const conversation = conversationEvidence(readConversation(readInput))
  if (args.tool_call_id && args.message_id) {
    const topicId = conversation.source === 'agent' ? buildAgentSessionTopicId(sessionId) : sessionId
    const toolResult = await findPersistedToolOutput(topicId, args.message_id, args.tool_call_id)
    return { content: [{ type: 'text', text: JSON.stringify({ ...conversation, toolResult }) }] }
  }
  return { content: [{ type: 'text', text: JSON.stringify(conversation) }] }
}

function listSessionDeliveries(
  ctx: AutonomyToolsContext,
  args: z.output<typeof SessionDeliveriesInputSchema>
): CallToolResult {
  const deliveries = agentSessionMessageService
    .listSessionDeliveries({
      sessionId: ctx.sessionId,
      direction: args.direction ?? 'incoming',
      requestId: args.request_id?.trim(),
      status: args.status,
      limit: clampLimit(args.limit, 20)
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
  return { content: [{ type: 'text', text: JSON.stringify({ deliveries }) }] }
}

function createSession(ctx: AutonomyToolsContext, args: z.output<typeof SessionCreateInputSchema>): CallToolResult {
  const content = args.message.trim()
  const title = args.title?.trim() ?? ''
  if (!content) throw new Error("'message' is required")

  let targetAgentId: string | undefined
  if (args.target_agent_id !== undefined) {
    targetAgentId = args.target_agent_id.trim()
    if (!targetAgentId) throw new Error("'target_agent_id' must be a non-empty string")
    if (!agentService.getAgent(targetAgentId)) {
      throw new AgentSessionDeliveryRoutingError('TARGET_AGENT_DELETED', `Target Agent not found: ${targetAgentId}`)
    }
  }

  const created = application.get('AgentSessionDeliveryService').acceptWithNewSession({
    senderAgentId: ctx.agentId,
    senderSessionId: ctx.sessionId,
    sessionName: title,
    workspace: ctx.workspaceSource,
    content,
    ...(targetAgentId ? { targetAgentId } : {})
  })
  return {
    content: [
      {
        type: 'text',
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

function sendSessionMessage(ctx: AutonomyToolsContext, args: z.output<typeof SessionSendInputSchema>): CallToolResult {
  const receiverSessionId = args.target_session_id.trim()
  const content = args.message.trim()
  if (!receiverSessionId) throw new Error("'target_session_id' is required")
  if (!content) throw new Error("'message' is required")

  const accepted = application.get('AgentSessionDeliveryService').accept({
    senderAgentId: ctx.agentId,
    senderSessionId: ctx.sessionId,
    receiverSessionId,
    content,
    replyPolicy: args.reply ?? 'none'
  })
  return {
    content: [
      {
        type: 'text',
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

function getNotifyChannelAccess(
  ctx: AutonomyToolsContext,
  channelId: string,
  adapters?: readonly { channelId: string; connected: boolean }[]
): 'allowed' | 'not-owned' | 'not-granted' {
  const channel = channelService.getChannel(channelId)
  if (!channel || channel.agentId !== ctx.agentId) return 'not-owned'
  if (ctx.trustedNotifyChannels.some((trustedChannel) => trustedChannel.id === channelId)) return 'allowed'
  // A dropped adapter stays registered for reconnection, so require a live connection here —
  // otherwise this fallback authorizes an offline channel the turn was never granted.
  return ctx.allowAnyOwnedNotifyChannel &&
    (adapters ?? application.get('ChannelManager').getAgentAdapters(ctx.agentId)).some(
      (adapter) => adapter.channelId === channelId && adapter.connected
    )
    ? 'allowed'
    : 'not-granted'
}

function saveJob(ctx: AutonomyToolsContext, args: CronInput, action: 'add' | 'update'): CallToolResult {
  const {
    name,
    message,
    cron: cronExpr,
    every,
    at,
    timeout_minutes: timeoutMinutes,
    reuse_session: reuseSession,
    id
  } = args
  if (action === 'update' && !id) throw new Error("'id' is required for update")
  if (action === 'add' && !name) throw new Error("'name' is required for add")
  if (action === 'add' && !message) throw new Error("'message' is required for add")

  // Determine trigger shape (cron expression / interval ms / one-shot timestamp)
  const scheduleCount = [cronExpr, every, at].filter(Boolean).length
  if (action === 'add' && scheduleCount === 0) throw new Error("One of 'cron', 'every', or 'at' is required")
  if (scheduleCount > 1) throw new Error("Use only one of 'cron', 'every', or 'at'")

  let trigger: Trigger | undefined

  if (cronExpr) {
    trigger = { kind: 'cron', expr: cronExpr }
  } else if (every) {
    const minutes = parseDurationToMinutes(every)
    trigger = { kind: 'interval', ms: minutes * 60_000 }
  } else if (at) {
    const date = new Date(at)
    if (isNaN(date.getTime())) throw new Error(`Invalid timestamp: "${at}"`)
    trigger = { kind: 'once', at: date.getTime() }
  }

  let channelIds = args.channel_ids
  if (channelIds === undefined && action === 'add' && ctx.trustedNotifyChannels.length > 0) {
    channelIds = ctx.trustedNotifyChannels.map((channel) => channel.id)
  }

  // Task targets have the same live ownership and turn authority requirements as immediate notifications.
  for (const channelId of channelIds ?? []) {
    const access = getNotifyChannelAccess(ctx, channelId)
    if (access === 'not-owned') throw new Error(`Channel "${channelId}" not found`)
    if (access === 'not-granted') {
      throw new Error(`Channel "${channelId}" is not a configured notification recipient for this turn`)
    }
  }

  const service = application.get('AgentJobsService')
  const patch = {
    name,
    prompt: message,
    trigger,
    timeoutMinutes,
    channelIds,
    ...(reuseSession !== undefined ? { reuseSession } : {})
  }
  const task =
    action === 'add'
      ? service.createTask(ctx.agentId, {
          ...patch,
          name: name!,
          prompt: message!,
          trigger: trigger!,
          workspace: ctx.workspaceSource,
          channelIds: channelIds?.length ? channelIds : undefined
        })
      : service.updateTask(ctx.agentId, id!, patch)
  if (!task) throw new Error(`Job "${id}" not found`)

  const outcome = action === 'add' ? 'created' : 'updated'
  logger.info(`Cron job ${outcome} via tool`, { agentId: ctx.agentId, taskId: task.id })
  return {
    content: [{ type: 'text', text: `Job ${outcome}:\n${JSON.stringify(task, null, 2)}` }]
  }
}

function listJobs(ctx: AutonomyToolsContext): CallToolResult {
  const { tasks } = taskService.listTasks(ctx.agentId, { limit: 100 })

  if (tasks.length === 0) {
    return { content: [{ type: 'text', text: 'No scheduled jobs.' }] }
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(tasks, null, 2) }]
  }
}

async function removeJob(ctx: AutonomyToolsContext, id: string | undefined): Promise<CallToolResult> {
  if (!id) throw new Error("'id' is required for remove")

  const deleted = await application.get('AgentJobsService').deleteTask(ctx.agentId, id)
  if (!deleted) throw new Error(`Job "${id}" not found`)

  logger.info('Cron job removed via tool', { agentId: ctx.agentId, taskId: id })
  return {
    content: [{ type: 'text', text: `Job "${id}" removed.` }]
  }
}

async function runCron(ctx: AutonomyToolsContext, args: CronInput): Promise<CallToolResult> {
  try {
    switch (args.action) {
      case 'add':
      case 'update':
        return saveJob(ctx, args, args.action)
      case 'list':
        return listJobs(ctx)
      case 'remove':
        return await removeJob(ctx, args.id)
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(JOB_ERROR_CODES.SCHEDULE_NAME_CONFLICT)) {
      throw new Error(
        `${error.message} Names are unique across all Agents, including disabled jobs; cron list only shows this Agent's jobs. Use update with the existing job id to edit your own task, choose a different name, or inspect the conflicting task in Settings > Scheduled Tasks.`
      )
    }
    throw error
  }
}

async function sendNotification(ctx: AutonomyToolsContext, args: NotifyInput): Promise<CallToolResult> {
  const message = args.message?.trim()
  const filePath = args.file_path?.trim()
  if (!message && !filePath) {
    throw new Error("Provide 'message', 'file_path', or both for notify")
  }

  const explicitChannelId = args.channel_id?.trim()
  if (args.channel_id !== undefined && !explicitChannelId) {
    throw new Error("'channel_id' must not be empty")
  }
  const targetChannelIds = explicitChannelId
    ? [explicitChannelId]
    : ctx.trustedNotifyChannels.map((channel) => channel.id)
  const targetChannelIdSet = new Set(targetChannelIds)
  const allAgentAdapters = application.get('ChannelManager').getAgentAdapters(ctx.agentId)
  for (const channelId of targetChannelIdSet) {
    if (getNotifyChannelAccess(ctx, channelId, allAgentAdapters) !== 'allowed') {
      throw new Error(`Channel "${channelId}" is not a configured notification recipient for this turn`)
    }
  }

  const adapters = allAgentAdapters.filter((adapter) => targetChannelIdSet.has(adapter.channelId))
  const availableChannelIds = new Set(adapters.map((adapter) => adapter.channelId))
  const unavailableChannelIds = [...targetChannelIdSet].filter((channelId) => !availableChannelIds.has(channelId))
  if (unavailableChannelIds.length > 0) {
    const recipients = unavailableChannelIds.join(', ')
    throw new Error(
      unavailableChannelIds.length === 1
        ? `Configured notification recipient is unavailable: ${recipients}.`
        : `Configured notification recipients are unavailable: ${recipients}.`
    )
  }

  // Resolve the file once after recipient validation so a bad path fails before dispatch.
  const file = filePath ? await resolveWorkspaceFile(ctx.workspacePath, filePath) : undefined
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
      agentId: ctx.agentId,
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
    agentId: ctx.agentId,
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
    content: [{ type: 'text', text: parts.join(' ') }],
    ...(deliveryFailed ? { isError: true } : {})
  }
}

// ── Config tool handlers ──────────────────────────────────────────

function configStatus(ctx: AutonomyToolsContext): CallToolResult {
  const agent = agentService.getAgent(ctx.agentId)
  if (!agent) throw new Error(`Agent not found: ${ctx.agentId}`)

  const config = agent.configuration
  const channels = channelService.listChannels({ agentId: ctx.agentId })

  const adapterStatuses = application.get('ChannelManager').getAdapterStatuses(ctx.agentId)
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
    heartbeat_enabled: isHeartbeatEnabled(config ?? {})
  }

  logger.info('Config status queried', { agentId: ctx.agentId })
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
  }
}

async function configAddChannel(ctx: AutonomyToolsContext, args: ConfigInput): Promise<CallToolResult> {
  const { type, name, enabled, config: rawConfig } = args
  const authMode = args.auth_mode ?? 'credentials'

  if (!type) throw new Error("'type' is required for add_channel")
  if (!name) throw new Error("'name' is required for add_channel")

  const schema = CHANNEL_CONFIG_SCHEMAS[type]
  if (authMode === 'qr' && type !== 'wechat' && type !== 'feishu') {
    throw new Error(`QR authentication is not supported for ${type} channels`)
  }
  if (authMode === 'qr' && enabled === false) {
    throw new Error('QR authentication requires the channel to be enabled')
  }

  let cfg: Record<string, unknown> = rawConfig ?? {}
  if (authMode === 'qr' && type === 'wechat') {
    cfg = { ...rawConfig, token_path: '' }
  } else if (authMode === 'qr' && type === 'feishu') {
    const unverifiedChannels = channelService
      .listChannels({ agentId: ctx.agentId, type: 'feishu' })
      .filter((channel) => channel.type === 'feishu' && !(channel.config.app_id && channel.config.app_secret))

    if (unverifiedChannels.length > 1) {
      const channelIds = unverifiedChannels.map((channel) => channel.id).join(', ')
      throw new Error(
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
      const { qrUrl } = await updateAgentChannelAndWaitForQr(
        existingChannel.id,
        ctx.agentId,
        { name, config, isActive: true },
        30_000
      )
      return await configReconnectChannel(ctx, existingChannel.id, qrUrl)
    }
  }
  if (authMode === 'credentials') {
    for (const field of schema.required) {
      if (!cfg[field]) {
        throw new Error(`Missing required config field "${field}" for ${type} channel`)
      }
    }
  }

  const config = ChannelConfigSchema.parse({ type, ...cfg })
  const channelType = config.type

  // For channels that use QR-based setup (WeChat login, Feishu app registration),
  // connect is blocking (waits for QR scan), so run sync in background
  // and wait only for the QR URL to return it to the agent.
  if (authMode === 'qr') {
    const channelLabel = type === 'wechat' ? 'WeChat' : 'Feishu'
    const scanHint =
      type === 'wechat'
        ? 'scan with WeChat to log in'
        : 'scan with Feishu to create a bot app and obtain credentials automatically'

    try {
      const { channel: newChannel, qrUrl } = await createAgentChannelAndWaitForQr(
        {
          type: channelType,
          name,
          agentId: ctx.agentId,
          workspace: ctx.workspaceSource,
          config,
          isActive: enabled ?? true
        },
        30_000
      )
      const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 })
      // Extract base64 from data URI: "data:image/png;base64,..."
      const base64 = qrDataUrl.split(',')[1]

      logger.info(`${channelLabel} channel added, QR code generated`, {
        agentId: ctx.agentId,
        channelId: newChannel.id
      })
      return {
        content: [
          {
            type: 'text',
            text: `${channelLabel} channel created (ID: ${newChannel.id}). QR code generated — display it to the user so they can ${scanHint}.`
          },
          {
            type: 'image',
            data: base64,
            mimeType: 'image/png'
          }
        ]
      }
    } catch (err) {
      logger.warn(`Failed to get ${channelLabel} QR code`, {
        agentId: ctx.agentId,
        error: err instanceof Error ? err.message : String(err)
      })
      return {
        content: [
          {
            type: 'text',
            text: `Failed to set up ${channelLabel} channel: ${err instanceof Error ? err.message : String(err)}. The channel was not saved. Please try again.`
          }
        ],
        isError: true
      }
    }
  }

  const newChannel = createAgentChannel({
    type: channelType,
    name,
    agentId: ctx.agentId,
    workspace: ctx.workspaceSource,
    config,
    isActive: enabled ?? true
  })

  logger.info('Channel added via config tool', { agentId: ctx.agentId, channelId: newChannel.id, type })
  return {
    content: [
      {
        type: 'text',
        text: `Channel added and activated:\n${JSON.stringify({ id: newChannel.id, type, name, enabled: newChannel.isActive }, null, 2)}`
      }
    ]
  }
}

/** Resolve a channel owned by this Agent; another Agent's channel reads as missing so existence never leaks. */
function getOwnedChannel(ctx: AutonomyToolsContext, channelId: string | undefined, action: string) {
  if (!channelId) throw new Error(`'channel_id' is required for ${action}`)
  const channel = channelService.getChannel(channelId)
  if (!channel || channel.agentId !== ctx.agentId) throw new Error(`Channel "${channelId}" not found`)
  return channel
}

function configUpdateChannel(ctx: AutonomyToolsContext, args: ConfigInput): CallToolResult {
  const existing = getOwnedChannel(ctx, args.channel_id, 'update_channel')

  const updates: Record<string, unknown> = {}
  if (args.name !== undefined) updates.name = args.name
  if (args.enabled !== undefined) updates.isActive = args.enabled
  if (args.config !== undefined) {
    updates.config = { ...existing.config, ...args.config }
  }

  updateAgentChannel(existing.id, updates)

  logger.info('Channel updated via config tool', { agentId: ctx.agentId, channelId: existing.id })
  return {
    content: [{ type: 'text', text: `Channel "${existing.id}" updated and reloaded.` }]
  }
}

async function configRemoveChannel(ctx: AutonomyToolsContext, args: ConfigInput): Promise<CallToolResult> {
  const channel = getOwnedChannel(ctx, args.channel_id, 'remove_channel')

  await deleteAgentChannel(channel.id)

  logger.info('Channel removed via config tool', { agentId: ctx.agentId, channelId: channel.id, type: channel.type })
  return {
    content: [{ type: 'text', text: `Channel "${channel.id}" (${channel.name}) removed.` }]
  }
}

async function configReconnectChannel(
  ctx: AutonomyToolsContext,
  channelId: string | undefined,
  preparedQrUrl?: string
): Promise<CallToolResult> {
  const channel = getOwnedChannel(ctx, channelId, 'reconnect_channel')

  const needsQr =
    channel.type === 'wechat' || (channel.type === 'feishu' && !(channel.config.app_id && channel.config.app_secret))

  if (!needsQr) {
    await reconnectAgentChannel(channel.id)
    return {
      content: [{ type: 'text', text: `Channel "${channel.id}" reconnected.` }]
    }
  }

  const channelLabel = channel.type === 'wechat' ? 'WeChat' : 'Feishu'

  try {
    const qrUrl = preparedQrUrl ?? (await reconnectAgentChannelWithQr(ctx.agentId, channel.id, 30_000))
    const qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 300, margin: 2 })
    const base64 = qrDataUrl.split(',')[1]

    logger.info(`${channelLabel} channel reconnect QR generated`, { agentId: ctx.agentId, channelId: channel.id })
    return {
      content: [
        {
          type: 'text',
          text: `${channelLabel} channel "${channel.id}" needs re-authentication. Display this QR code for the user to scan.`
        },
        {
          type: 'image',
          data: base64,
          mimeType: 'image/png'
        }
      ]
    }
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Failed to generate QR for reconnect: ${err instanceof Error ? err.message : String(err)}`
        }
      ],
      isError: true
    }
  }
}

function configRename(ctx: AutonomyToolsContext, args: ConfigInput): CallToolResult {
  const name = args.name?.trim()
  if (!name) throw new Error("'name' is required for rename")

  agentService.updateAgent(ctx.agentId, { name })

  logger.info('Agent renamed via config tool', { agentId: ctx.agentId, name })
  return {
    content: [{ type: 'text', text: `Agent renamed to "${name}".` }]
  }
}

function configSetBootstrap(ctx: AutonomyToolsContext, completed: boolean): CallToolResult {
  const updated = agentService.updateAgent(ctx.agentId, { configuration: { bootstrap_completed: completed } })
  if (!updated) throw new Error(`Agent not found: ${ctx.agentId}`)

  logger.info(completed ? 'Bootstrap marked as completed' : 'Bootstrap reset', { agentId: ctx.agentId })
  const text = completed
    ? 'Bootstrap completed. Future sessions will use your standard personality.'
    : 'Bootstrap has been reset. The next session will run the onboarding flow.'
  return { content: [{ type: 'text', text }] }
}

async function runConfig(ctx: AutonomyToolsContext, args: ConfigInput): Promise<CallToolResult> {
  switch (args.action) {
    case 'status':
      return configStatus(ctx)
    case 'rename':
      return configRename(ctx, args)
    case 'add_channel':
      return configAddChannel(ctx, args)
    case 'update_channel':
      return configUpdateChannel(ctx, args)
    case 'remove_channel':
      return configRemoveChannel(ctx, args)
    case 'reconnect_channel':
      return configReconnectChannel(ctx, args.channel_id)
    case 'complete_bootstrap':
      return configSetBootstrap(ctx, true)
    case 'reset_bootstrap':
      return configSetBootstrap(ctx, false)
  }
}

export function registerAutonomyTools(server: McpServer, ctx: AutonomyToolsContext): void {
  server.registerTool(CRON_TOOL_NAME, { description: CRON_DESCRIPTION, inputSchema: CronInputSchema }, (args) =>
    runCron(ctx, args)
  )
  // Without recipients there is nothing notify could reach, so the tool is not offered at all.
  if (ctx.trustedNotifyChannels.length > 0) {
    const recipients = ctx.trustedNotifyChannels.map((channel) => `${channel.type} (${channel.id})`).join(', ')
    server.registerTool(
      NOTIFY_TOOL_NAME,
      { description: `${NOTIFY_DESCRIPTION} Configured recipients: ${recipients}.`, inputSchema: NotifyInputSchema },
      (args) => sendNotification(ctx, args)
    )
  }
  server.registerTool(CONFIG_TOOL_NAME, { description: CONFIG_DESCRIPTION, inputSchema: ConfigInputSchema }, (args) =>
    runConfig(ctx, args)
  )
  server.registerTool(
    SESSION_LIST_TOOL_NAME,
    {
      description:
        'List active Cherry Agent Sessions that can receive a message. Returns both agentId and sessionId for every address.',
      inputSchema: SessionListInputSchema
    },
    (args) => runSessionTool(ctx, () => listSessions(ctx, args))
  )
  server.registerTool(
    AGENT_LIST_TOOL_NAME,
    {
      description: 'List available Cherry Agents with their public identity and runtime readiness.',
      inputSchema: z.object({})
    },
    () => runSessionTool(ctx, listAgents)
  )
  server.registerTool(
    SESSION_SEARCH_TOOL_NAME,
    {
      description: 'Search visible Cherry Agent Sessions by metadata and message evidence.',
      inputSchema: SessionSearchInputSchema
    },
    (args) => runSessionTool(ctx, () => searchSessions(ctx, args))
  )
  server.registerTool(
    SESSION_READ_TOOL_NAME,
    {
      description:
        'Read messages from a Cherry Chat topic, Agent Session, or temporary conversation. The session type is detected from session_id. Use message_id for one exact message and tool_call_id with it to restore a persisted tool result. Attachments are descriptive only: their addresses and contents are omitted.',
      inputSchema: SessionReadInputSchema
    },
    (args) => runSessionTool(ctx, () => readSession(args))
  )
  server.registerTool(
    SESSION_CREATE_TOOL_NAME,
    {
      description:
        'Create a new Session and send its first durable message. Omit target_agent_id to use the current Agent; provide it to create the Session for another Agent. The new Session inherits the current workspace policy and uses the target Agent model.',
      inputSchema: SessionCreateInputSchema
    },
    (args) => runSessionTool(ctx, () => createSession(ctx, args))
  )
  server.registerTool(
    SESSION_DELIVERIES_TOOL_NAME,
    {
      description: 'Inspect durable incoming or outgoing cross-Session requests, results, and delivery state.',
      inputSchema: SessionDeliveriesInputSchema
    },
    (args) => runSessionTool(ctx, () => listSessionDeliveries(ctx, args))
  )
  server.registerTool(
    SESSION_SEND_TOOL_NAME,
    {
      description:
        'Send a durable message to another Cherry Agent Session. Sender agentId/sessionId are injected by the trusted runtime and cannot be supplied by the caller.',
      inputSchema: SessionSendInputSchema
    },
    (args) => runSessionTool(ctx, () => sendSessionMessage(ctx, args))
  )
}
