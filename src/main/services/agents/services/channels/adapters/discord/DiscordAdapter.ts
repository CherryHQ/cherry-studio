import { loggerService } from '@logger'
import type { CherryClawChannel } from '@types'
import { net } from 'electron'
import WebSocket from 'ws'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  downloadImageAsBase64,
  type ImageAttachment,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'

const logger = loggerService.withContext('DiscordAdapter')

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

function splitMessage(text: string): string[] {
  if (text.length <= DISCORD_MAX_LENGTH) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= DISCORD_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', DISCORD_MAX_LENGTH)
    if (splitIndex <= 0) splitIndex = remaining.lastIndexOf('\n', DISCORD_MAX_LENGTH)
    if (splitIndex <= 0) splitIndex = remaining.lastIndexOf(' ', DISCORD_MAX_LENGTH)
    if (splitIndex <= 0) splitIndex = DISCORD_MAX_LENGTH

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '').trimStart()
  }

  return chunks
}

class DiscordAdapter extends ChannelAdapter {
  private ws: WebSocket | null = null
  private readonly botToken: string
  private readonly allowedChannelIds: string[]

  private sessionId: string | null = null
  private lastSeq: number | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private heartbeatAcked = true
  private resumeGatewayUrl: string | null = null
  private reconnectAttempts = 0
  private isConnecting = false
  private shouldStop = false

  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000]
  private readonly maxReconnectAttempts = 50

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
    logger.info('Discord bot started', { agentId: this.agentId, channelId: this.channelId })
  }

  protected override async performDisconnect(): Promise<void> {
    this.shouldStop = true
    this.cleanup()
    logger.info('Discord bot stopped', { agentId: this.agentId, channelId: this.channelId })
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
      logger.info('Connecting to Discord gateway', { agentId: this.agentId, url: wsUrl })

      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.on('open', () => {
        logger.info('Discord WebSocket connected', { agentId: this.agentId })
      })

      ws.on('message', (data: Buffer) => {
        this.handleWsMessage(data).catch((err) => {
          logger.error('Error handling WS message', {
            agentId: this.agentId,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      ws.on('close', (code, reason) => {
        this.markDisconnected()
        logger.info('Discord WebSocket closed', {
          agentId: this.agentId,
          code,
          reason: reason.toString()
        })
        // 4004 = Authentication failed — do not reconnect
        if (code !== 4004) {
          this.scheduleReconnect()
        }
      })

      ws.on('error', (err) => {
        logger.error('Discord WebSocket error', {
          agentId: this.agentId,
          error: err.message
        })
      })
    } catch (error) {
      logger.error('Failed to start Discord gateway', {
        agentId: this.agentId,
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
        logger.info('Discord gateway requested reconnect', { agentId: this.agentId })
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
    setTimeout(() => {
      this.sendHeartbeat()
      this.heartbeatTimer = setInterval(() => {
        if (!this.heartbeatAcked) {
          logger.warn('Discord heartbeat not acked, reconnecting', { agentId: this.agentId })
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
        }
        this.sessionId = ready.session_id
        this.resumeGatewayUrl = ready.resume_gateway_url
        this.reconnectAttempts = 0
        this.markConnected()
        logger.info('Discord bot ready', {
          agentId: this.agentId,
          sessionId: this.sessionId,
          botUser: ready.user.username
        })
        break
      }
      case 'RESUMED':
        this.reconnectAttempts = 0
        this.markConnected()
        logger.info('Discord session resumed', { agentId: this.agentId })
        break
      case 'MESSAGE_CREATE':
        await this.handleMessageCreate(data as DiscordMessage)
        break
    }
  }

  private async handleMessageCreate(msg: DiscordMessage): Promise<void> {
    // Ignore bot messages (including own)
    if (msg.author.bot) return

    const chatId = msg.guild_id ? `channel:${msg.channel_id}` : `dm:${msg.channel_id}`

    if (!this.isAllowed(chatId, msg.channel_id)) return

    const { text, imageUrls, fileLines } = this.parseMessageContent(msg)
    if (!text && imageUrls.length === 0) return

    if (this.isCommand(text)) {
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

      const parts = [text, ...fileLines].filter(Boolean)
      this.emit('message', {
        chatId,
        userId: msg.author.id,
        userName: msg.author.username ?? '',
        text: parts.join('\n') || 'What is in this image?',
        images
      })
    }
  }

  /**
   * Parse message text, extract image URLs and non-image file links from attachments.
   */
  private parseMessageContent(msg: DiscordMessage): { text: string; imageUrls: string[]; fileLines: string[] } {
    const text = msg.content.replace(/<@!?\d+>/g, '').trim()
    const imageUrls: string[] = []
    const fileLines: string[] = []

    if (msg.attachments?.length) {
      for (const att of msg.attachments) {
        if (att.content_type?.startsWith('image/')) {
          imageUrls.push(att.proxy_url || att.url)
        } else {
          fileLines.push(`[${att.filename}](${att.url})`)
        }
      }
    }

    return { text, imageUrls, fileLines }
  }

  private isAllowed(chatId: string, rawChannelId?: string): boolean {
    if (this.allowedChannelIds.length === 0) return true
    return (
      this.allowedChannelIds.includes(chatId) ||
      (rawChannelId !== undefined && this.allowedChannelIds.includes(rawChannelId))
    )
  }

  private isCommand(text: string): boolean {
    return /^\/(new|compact|help|whoami)\b/.test(text)
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
      logger.error('Failed to send whoami', {
        agentId: this.agentId,
        chatId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // ─── Message Sending (REST API) ──────────────────────────────

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    const chunks = splitMessage(text)
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

  // oxlint-disable-next-line no-unused-vars -- no-op abstract method
  async sendMessageDraft(_chatId: string, _draftId: number, _text: string): Promise<void> {
    // Discord does not have a native draft/streaming API like Telegram
    // This is a no-op; final message is sent via sendMessage
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

  // ─── REST API Helper ─────────────────────────────────────────

  private async apiRequest(
    url: string,
    options?: { method?: string; body?: Record<string, unknown> }
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
      this.markDisconnected()
      logger.error('Max reconnect attempts reached', { agentId: this.agentId })
      return
    }

    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)]
    this.reconnectAttempts++

    logger.info('Scheduling Discord reconnect', {
      agentId: this.agentId,
      attempt: this.reconnectAttempts,
      delay
    })

    setTimeout(() => {
      if (!this.shouldStop) {
        this.startGateway().catch((err) => {
          logger.error('Reconnect failed', {
            agentId: this.agentId,
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
    }, delay)
  }
}

// Self-registration
registerAdapterFactory('discord', (channel: CherryClawChannel, agentId: string) => {
  return new DiscordAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
