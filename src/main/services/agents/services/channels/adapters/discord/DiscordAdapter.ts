import { net } from 'electron'
import WebSocket from 'ws'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  downloadFileAsBase64,
  downloadImageAsBase64,
  type FileAttachment,
  type ImageAttachment,
  MAX_FILE_SIZE_BYTES,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand, SLASH_COMMANDS } from '../../constants'
import { FlushController } from '../../FlushController'
import { splitMessage } from '../../utils'

const DISCORD_API_BASE = 'https://discord.com/api/v10'
const DISCORD_MAX_LENGTH = 2000
const USER_AGENT = 'DiscordBot (https://github.com/CherryHQ/cherry-studio, 1.0.0)'

// Discord Gateway Opcodes
const OP_DISPATCH = 0
const OP_HEARTBEAT = 1
const OP_IDENTIFY = 2
const OP_RESUME = 6
const OP_RECONNECT = 7
const OP_INVALID_SESSION = 9
const OP_HELLO = 10
const OP_HEARTBEAT_ACK = 11

// Message Flags
const DISCORD_FLAG_EPHEMERAL = 64

// Gateway Intents
const INTENTS = {
  GUILDS: 1 << 0,
  GUILD_MESSAGES: 1 << 9,
  GUILD_MESSAGE_REACTIONS: 1 << 10,
  DIRECT_MESSAGES: 1 << 12,
  MESSAGE_CONTENT: 1 << 15
}

type DiscordAttachment = {
  id: string
  filename: string
  url: string
  proxy_url: string
  content_type?: string
  size: number
}

type DiscordMessage = {
  id: string
  channel_id: string
  guild_id?: string
  author: { id: string; username: string; bot?: boolean }
  content: string
  attachments?: DiscordAttachment[]
  timestamp: string
}

/**
 * Discord rate limit: 5 message operations per 5 seconds per channel.
 * Use 1200ms throttle to stay safely within limits.
 */
const DISCORD_STREAM_THROTTLE_MS = 1200

/**
 * Manages a single streaming response by creating a message, then
 * editing it in-place with throttled updates via FlushController.
 */
class DiscordStreamingController {
  private messageId: string | null = null
  private currentText = ''
  private readonly flush: FlushController
  private messageCreationPromise: Promise<void> | null = null
  private _completed = false

  constructor(
    private readonly discordChannelId: string,
    private readonly apiRequest: DiscordAdapter['apiRequest'],
    private readonly log: Record<string, (msg: string, meta?: Record<string, unknown>) => void>
  ) {
    this.flush = new FlushController(() => this.performFlush())
  }

  get completed(): boolean {
    return this._completed
  }

  async onText(text: string): Promise<void> {
    if (this._completed) return
    this.currentText = text
    await this.ensureMessageCreated()
    if (this.messageId) {
      await this.flush.throttledUpdate(DISCORD_STREAM_THROTTLE_MS)
    }
  }

  async complete(finalText: string): Promise<boolean> {
    if (this._completed) return false
    this._completed = true
    this.flush.complete()

    if (this.messageCreationPromise) await this.messageCreationPromise
    if (!this.messageId) return false

    await this.flush.waitForFlush()

    try {
      this.currentText = finalText
      await this.editMessage(finalText)
      return true
    } catch (error) {
      this.log.warn('Failed to finalize Discord stream', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  async error(errorMessage: string): Promise<void> {
    if (this._completed) return
    this._completed = true
    this.flush.complete()

    if (this.messageCreationPromise) await this.messageCreationPromise
    if (!this.messageId) return

    await this.flush.waitForFlush()

    try {
      const displayText = this.currentText
        ? `${this.currentText}\n\n---\n**Error**: ${errorMessage}`
        : `**Error**: ${errorMessage}`
      await this.editMessage(displayText)
    } catch {
      // Best-effort error update
    }
  }

  dispose(): void {
    this._completed = true
    this.flush.cancelPendingFlush()
    this.flush.complete()
  }

  // ---- Internal ----

  private async ensureMessageCreated(): Promise<void> {
    if (this.messageId) return
    if (this.messageCreationPromise) {
      await this.messageCreationPromise
      return
    }
    this.messageCreationPromise = this.createMessage()
    await this.messageCreationPromise
  }

  private async createMessage(): Promise<void> {
    try {
      const response = await this.apiRequest(`${DISCORD_API_BASE}/channels/${this.discordChannelId}/messages`, {
        method: 'POST',
        body: { content: this.currentText || '...' }
      })
      const data = (await response.json()) as { id?: string }
      this.messageId = data.id ?? null
    } catch (error) {
      this.log.warn('Failed to create Discord streaming message', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async editMessage(text: string): Promise<void> {
    if (!this.messageId) return
    // Discord messages max 2000 chars — truncate with indicator if needed
    const content = text.length > DISCORD_MAX_LENGTH ? text.slice(0, DISCORD_MAX_LENGTH - 3) + '...' : text
    await this.apiRequest(`${DISCORD_API_BASE}/channels/${this.discordChannelId}/messages/${this.messageId}`, {
      method: 'PATCH',
      body: { content }
    })
  }

  private async performFlush(): Promise<void> {
    if (!this.messageId || !this.currentText) return
    try {
      await this.editMessage(this.currentText)
    } catch {
      // Swallow flush errors — FlushController will reflush if needed
    }
  }
}

// Discord Interaction types
const INTERACTION_TYPE_PING = 1
const INTERACTION_TYPE_APPLICATION_COMMAND = 2
// Interaction callback response types
const INTERACTION_CALLBACK_CHANNEL_MESSAGE = 4
const INTERACTION_CALLBACK_DEFERRED_CHANNEL_MESSAGE = 5

type DiscordInteraction = {
  id: string
  type: number
  token: string
  channel_id: string
  guild_id?: string
  member?: { user: { id: string; username: string } }
  user?: { id: string; username: string }
  data?: { name: string; options?: Array<{ name: string; value: unknown }> }
}

class DiscordAdapter extends ChannelAdapter {
  private ws: WebSocket | null = null
  private readonly botToken: string
  private readonly allowedChannelIds: string[]

  private sessionId: string | null = null
  private applicationId: string | null = null
  private lastSeq: number | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatJitterTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatAcked = true
  private resumeGatewayUrl: string | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private isConnecting = false
  private shouldStop = false

  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000]
  private readonly maxReconnectAttempts = 50
  /** Per-chat streaming controller. One stream at a time per chat. */
  private readonly streamingControllers = new Map<string, DiscordStreamingController>()

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { bot_token, allowed_channel_ids } = config.channelConfig
    this.botToken = (bot_token as string) ?? ''
    const rawIds = allowed_channel_ids as string[] | undefined
    this.allowedChannelIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChannelIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!this.botToken
  }

  protected override async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.botToken) throw new Error('Discord bot token is required')
    this.shouldStop = false
    await this.startGateway()
    this.log.info('Discord bot started')
  }

  protected override async performDisconnect(): Promise<void> {
    this.shouldStop = true
    for (const controller of this.streamingControllers.values()) {
      controller.dispose()
    }
    this.streamingControllers.clear()
    this.cleanup()
    this.log.info('Discord bot stopped')
  }

  // ─── Gateway Connection ───────────────────────────────────────

  private async getGatewayUrl(): Promise<string> {
    const response = await net.fetch(`${DISCORD_API_BASE}/gateway/bot`, {
      headers: {
        Authorization: `Bot ${this.botToken}`,
        'User-Agent': USER_AGENT
      }
    })
    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Failed to get gateway URL: HTTP ${response.status} - ${errorText}`)
    }
    const data = (await response.json()) as { url: string }
    return data.url
  }

  private async startGateway(): Promise<void> {
    if (this.isConnecting || this.shouldStop) return
    this.isConnecting = true

    try {
      this.cleanup()

      const gatewayUrl = this.resumeGatewayUrl ?? (await this.getGatewayUrl())
      const wsUrl = `${gatewayUrl}?v=10&encoding=json`
      this.log.info('Connecting to Discord gateway', { url: wsUrl })

      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.on('open', () => {
        this.log.info('Discord WebSocket connected')
      })

      ws.on('message', (data: Buffer) => {
        this.handleWsMessage(data).catch((err) => {
          this.log.error('Error handling WS message', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      ws.on('close', (code, reason) => {
        this.markDisconnected(`WebSocket closed: ${code}`)
        this.log.warn(`WebSocket closed (code=${code}, reason=${reason.toString()})`)
        // 4004 = Authentication failed — do not reconnect
        if (code !== 4004) {
          this.scheduleReconnect()
        }
      })

      ws.on('error', (err) => {
        this.log.error('Discord WebSocket error', {
          error: err.message
        })
      })
    } catch (error) {
      this.log.error('Failed to start Discord gateway', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.scheduleReconnect()
    } finally {
      this.isConnecting = false
    }
  }

  // ─── WebSocket Message Handling ───────────────────────────────

  private async handleWsMessage(data: Buffer): Promise<void> {
    let payload: { op: number; d?: unknown; s?: number; t?: string }
    try {
      payload = JSON.parse(data.toString())
    } catch {
      return
    }

    if (payload.s !== undefined && payload.s !== null) {
      this.lastSeq = payload.s
    }

    switch (payload.op) {
      case OP_HELLO:
        this.handleHello(payload.d as { heartbeat_interval: number })
        break
      case OP_DISPATCH:
        if (payload.t) await this.handleDispatch(payload.t, payload.d)
        break
      case OP_HEARTBEAT_ACK:
        this.heartbeatAcked = true
        break
      case OP_HEARTBEAT:
        // Server requests immediate heartbeat
        this.sendHeartbeat()
        break
      case OP_RECONNECT:
        this.log.info('Discord gateway requested reconnect')
        this.ws?.close(4000, 'Reconnect requested')
        break
      case OP_INVALID_SESSION: {
        const resumable = payload.d === true
        if (resumable && this.sessionId) {
          // Wait 1-5s as per Discord docs then resume
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 4000))
          this.sendResume()
        } else {
          this.sessionId = null
          this.lastSeq = null
          this.resumeGatewayUrl = null
          await new Promise((r) => setTimeout(r, 1000 + Math.random() * 4000))
          this.sendIdentify()
        }
        break
      }
    }
  }

  private handleHello(data: { heartbeat_interval: number }): void {
    this.heartbeatAcked = true

    // Jittered first heartbeat as per Discord docs
    const jitter = Math.random()
    this.heartbeatJitterTimer = setTimeout(() => {
      this.heartbeatJitterTimer = null
      this.sendHeartbeat()
      this.heartbeatTimer = setInterval(() => {
        if (!this.heartbeatAcked) {
          this.log.warn('Discord heartbeat not acked, reconnecting')
          this.ws?.close(4000, 'Heartbeat timeout')
          return
        }
        this.heartbeatAcked = false
        this.sendHeartbeat()
      }, data.heartbeat_interval)
    }, data.heartbeat_interval * jitter)

    // Identify or resume
    if (this.sessionId && this.lastSeq !== null) {
      this.sendResume()
    } else {
      this.sendIdentify()
    }
  }

  private sendIdentify(): void {
    const intents =
      INTENTS.GUILDS |
      INTENTS.GUILD_MESSAGES |
      INTENTS.GUILD_MESSAGE_REACTIONS |
      INTENTS.DIRECT_MESSAGES |
      INTENTS.MESSAGE_CONTENT

    this.send({
      op: OP_IDENTIFY,
      d: {
        token: this.botToken,
        intents,
        properties: {
          os: process.platform,
          browser: 'cherry-studio',
          device: 'cherry-studio'
        }
      }
    })
  }

  private sendResume(): void {
    this.send({
      op: OP_RESUME,
      d: {
        token: this.botToken,
        session_id: this.sessionId,
        seq: this.lastSeq
      }
    })
  }

  private sendHeartbeat(): void {
    this.send({ op: OP_HEARTBEAT, d: this.lastSeq })
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  // ─── Dispatch Event Handling ──────────────────────────────────

  private async handleDispatch(eventType: string, data: unknown): Promise<void> {
    switch (eventType) {
      case 'READY': {
        const ready = data as {
          session_id: string
          resume_gateway_url: string
          user: { id: string; username: string }
          application: { id: string }
        }
        this.sessionId = ready.session_id
        this.resumeGatewayUrl = ready.resume_gateway_url
        this.applicationId = ready.application.id
        this.reconnectAttempts = 0
        this.markConnected()
        this.log.info(`Discord bot ready (user: ${ready.user.username})`)
        this.registerSlashCommands().catch((err) => {
          this.log.warn('Failed to register slash commands', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
        break
      }
      case 'RESUMED':
        this.reconnectAttempts = 0
        this.markConnected()
        this.log.info('Discord session resumed')
        break
      case 'MESSAGE_CREATE':
        await this.handleMessageCreate(data as DiscordMessage)
        break
      case 'INTERACTION_CREATE':
        await this.handleInteraction(data as DiscordInteraction)
        break
    }
  }

  private async handleMessageCreate(msg: DiscordMessage): Promise<void> {
    // Ignore bot messages (including own)
    if (msg.author.bot) return

    const chatId = msg.guild_id ? `channel:${msg.channel_id}` : `dm:${msg.channel_id}`

    if (!this.isAllowed(chatId, msg.channel_id)) return

    const { text, imageUrls, fileAttachments } = this.parseMessageContent(msg)
    if (!text && imageUrls.length === 0 && fileAttachments.length === 0) return

    if (isSlashCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      const cmd = text.split(/\s+/)[0].slice(1) as 'new' | 'compact' | 'help'
      this.emit('command', {
        chatId,
        userId: msg.author.id,
        userName: msg.author.username ?? '',
        command: cmd
      })
    } else {
      // Download images in parallel, converting to base64
      let images: ImageAttachment[] | undefined
      if (imageUrls.length > 0) {
        const results = await Promise.all(imageUrls.map((url) => downloadImageAsBase64(url)))
        const downloaded = results.filter((r): r is ImageAttachment => r !== null)
        if (downloaded.length > 0) images = downloaded
      }

      // Download non-image file attachments in parallel
      let files: FileAttachment[] | undefined
      if (fileAttachments.length > 0) {
        const results = await Promise.all(fileAttachments.map((att) => downloadFileAsBase64(att.url, att.filename)))
        const downloaded = results.filter((r): r is FileAttachment => r !== null)
        if (downloaded.length > 0) files = downloaded
      }

      this.emit('message', {
        chatId,
        userId: msg.author.id,
        userName: msg.author.username ?? '',
        text,
        images,
        files
      })
    }
  }

  /**
   * Parse message text, extract image URLs and downloadable file attachments.
   */
  private parseMessageContent(msg: DiscordMessage): {
    text: string
    imageUrls: string[]
    fileAttachments: DiscordAttachment[]
  } {
    const text = msg.content.replace(/<@!?\d+>/g, '').trim()
    const imageUrls: string[] = []
    const fileAttachments: DiscordAttachment[] = []

    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        if (att.content_type?.startsWith('image/')) {
          imageUrls.push(att.url)
        } else if (att.size <= MAX_FILE_SIZE_BYTES) {
          fileAttachments.push(att)
        }
      }
    }

    return { text, imageUrls, fileAttachments }
  }

  private isAllowed(chatId: string, rawChannelId?: string): boolean {
    if (this.allowedChannelIds.length === 0) return true
    return (
      this.allowedChannelIds.includes(chatId) ||
      (rawChannelId !== undefined && this.allowedChannelIds.includes(rawChannelId))
    )
  }

  private async sendWhoami(chatId: string): Promise<void> {
    const [type] = chatId.split(':')
    const typeLabel = type === 'dm' ? 'Direct Message' : 'Guild Channel'

    const message = [
      `Chat Info`,
      ``,
      `Type: ${typeLabel}`,
      `Chat ID: ${chatId}`,
      ``,
      `To enable notifications for this chat:`,
      `1. Go to Agent Settings > Channels > Discord`,
      `2. Add "${chatId}" to Allowed Channel IDs`,
      `3. Enable "Receive Notifications"`,
      ``,
      `Then use the notify tool or scheduled tasks will send messages here.`
    ].join('\n')

    try {
      await this.sendMessage(chatId, message)
    } catch (err) {
      this.log.error('Failed to send whoami', {
        chatId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // ─── Slash Commands ──────────────────────────────────────────

  private async registerSlashCommands(): Promise<void> {
    if (!this.applicationId) return

    await this.apiRequest(`${DISCORD_API_BASE}/applications/${this.applicationId}/commands`, {
      method: 'PUT',
      body: SLASH_COMMANDS as unknown as Record<string, unknown>[]
    })
    this.log.info('Registered Discord slash commands', { count: SLASH_COMMANDS.length })
  }

  private async handleInteraction(interaction: DiscordInteraction): Promise<void> {
    // Must always ACK a PING
    if (interaction.type === INTERACTION_TYPE_PING) return

    if (interaction.type !== INTERACTION_TYPE_APPLICATION_COMMAND || !interaction.data) return

    const commandName = interaction.data.name
    const user = interaction.member?.user ?? interaction.user
    const chatId = interaction.guild_id ? `channel:${interaction.channel_id}` : `dm:${interaction.channel_id}`

    if (!this.isAllowed(chatId, interaction.channel_id)) {
      await this.respondToInteraction(interaction, 'This bot is not enabled in this channel.', true)
      return
    }

    if (commandName === 'whoami') {
      const [type] = chatId.split(':')
      const typeLabel = type === 'dm' ? 'Direct Message' : 'Guild Channel'
      const info = [
        `**Chat Info**`,
        `Type: ${typeLabel}`,
        `Chat ID: \`${chatId}\``,
        ``,
        `Add \`${chatId}\` to Allowed Channel IDs in Agent Settings to enable notifications.`
      ].join('\n')
      await this.respondToInteraction(interaction, info, true)
      return
    }

    // For /new, /compact, /help — ACK with deferred response, then emit command
    await this.ackInteraction(interaction)

    this.emit('command', {
      chatId,
      userId: user?.id ?? '',
      userName: user?.username ?? '',
      command: commandName as 'new' | 'compact' | 'help'
    })
  }

  private async respondToInteraction(
    interaction: DiscordInteraction,
    content: string,
    ephemeral = false
  ): Promise<void> {
    await net.fetch(`${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: INTERACTION_CALLBACK_CHANNEL_MESSAGE,
        data: { content, ...(ephemeral ? { flags: DISCORD_FLAG_EPHEMERAL } : {}) }
      })
    })
  }

  private async ackInteraction(interaction: DiscordInteraction): Promise<void> {
    await net.fetch(`${DISCORD_API_BASE}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: INTERACTION_CALLBACK_DEFERRED_CHANNEL_MESSAGE })
    })
  }

  // ─── Message Sending (REST API) ──────────────────────────────

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    const chunks = splitMessage(text, DISCORD_MAX_LENGTH)
    const channelId = chatId.split(':')[1]

    for (let i = 0; i < chunks.length; i++) {
      await this.apiRequest(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
        method: 'POST',
        body: { content: chunks[i] }
      })

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    const channelId = chatId.split(':')[1]
    try {
      await this.apiRequest(`${DISCORD_API_BASE}/channels/${channelId}/typing`, {
        method: 'POST'
      })
    } catch {
      // Typing indicator is best-effort
    }
  }

  // ─── Streaming ─────────────────────────────────────────────────

  override async onTextUpdate(chatId: string, fullText: string): Promise<void> {
    const discordChannelId = chatId.split(':')[1]
    let controller = this.streamingControllers.get(chatId)
    if (!controller || controller.completed) {
      controller = new DiscordStreamingController(discordChannelId, this.apiRequest.bind(this), this.log)
      this.streamingControllers.set(chatId, controller)
    }
    await controller.onText(fullText)
  }

  override async onStreamComplete(chatId: string, finalText: string): Promise<boolean> {
    const controller = this.streamingControllers.get(chatId)
    if (!controller) return false
    try {
      return await controller.complete(finalText)
    } finally {
      this.streamingControllers.delete(chatId)
    }
  }

  override async onStreamError(chatId: string, error: string): Promise<void> {
    const controller = this.streamingControllers.get(chatId)
    if (!controller) return
    try {
      await controller.error(error)
    } finally {
      this.streamingControllers.delete(chatId)
    }
  }

  // ─── REST API Helper ─────────────────────────────────────────

  private async apiRequest(
    url: string,
    options?: { method?: string; body?: Record<string, unknown> | Record<string, unknown>[] }
  ): Promise<Response> {
    const response = await net.fetch(url, {
      method: options?.method ?? 'GET',
      headers: {
        Authorization: `Bot ${this.botToken}`,
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {})
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Discord API error ${url}: HTTP ${response.status} - ${errorText}`)
    }

    return response
  }

  // ─── Lifecycle Helpers ────────────────────────────────────────

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatJitterTimer) {
      clearTimeout(this.heartbeatJitterTimer)
      this.heartbeatJitterTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.shouldStop) return

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.markDisconnected('Max reconnect attempts reached')
      this.log.error('Max reconnect attempts reached, giving up')
      return
    }

    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)]
    this.reconnectAttempts++

    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.shouldStop) {
        this.startGateway().catch((err) => {
          this.log.error('Reconnect failed', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
    }, delay)
  }
}

// Self-registration
registerAdapterFactory('discord', (channel, agentId) => {
  return new DiscordAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config as Record<string, unknown>
  })
})
