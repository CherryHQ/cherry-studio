import { loggerService } from '@logger'
import type { CherryClawChannel } from '@types'
import WebSocket from 'ws'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../ChannelAdapter'
import { registerAdapterFactory } from '../ChannelManager'

const logger = loggerService.withContext('QQAdapter')

const QQ_MAX_LENGTH = 2000
const QQ_API_BASE = 'https://api.sgroup.qq.com'

// QQ Bot WebSocket opcodes
const OP_DISPATCH = 0
const OP_HEARTBEAT = 1
const OP_IDENTIFY = 2
const OP_RESUME = 6
const OP_RECONNECT = 7
const OP_INVALID_SESSION = 9
const OP_HELLO = 10
const OP_HEARTBEAT_ACK = 11

// Intent flags
const INTENTS = {
  PUBLIC_GUILD_MESSAGES: 1 << 30,
  DIRECT_MESSAGE: 1 << 12,
  GROUP_AND_C2C: 1 << 25
}

type QQTokenCache = {
  accessToken: string
  expiresAt: number
}

type QQMessage = {
  id: string
  author: {
    id: string
    user_openid?: string
    member_openid?: string
    username?: string
  }
  content: string
  timestamp: string
  channel_id?: string
  guild_id?: string
  group_id?: string
  group_openid?: string
}

/**
 * Split a long message into chunks that fit within QQ's character limit.
 */
function splitMessage(text: string): string[] {
  if (text.length <= QQ_MAX_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= QQ_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', QQ_MAX_LENGTH)
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('\n', QQ_MAX_LENGTH)
    }
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(' ', QQ_MAX_LENGTH)
    }
    if (splitIndex <= 0) {
      splitIndex = QQ_MAX_LENGTH
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '').trimStart()
  }

  return chunks
}

class QQAdapter extends ChannelAdapter {
  private ws: WebSocket | null = null
  private readonly appId: string
  private readonly clientSecret: string
  private readonly allowedChatIds: string[]

  private tokenCache: QQTokenCache | null = null
  private sessionId: string | null = null
  private lastSeq: number | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private reconnectAttempts = 0
  private isConnecting = false
  private shouldStop = false

  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000]
  private readonly maxReconnectAttempts = 100

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { app_id, client_secret, allowed_chat_ids } = config.channelConfig
    this.appId = (app_id as string) ?? ''
    this.clientSecret = (client_secret as string) ?? ''
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    // Expose for notify tool
    this.notifyChatIds = [...this.allowedChatIds]
  }

  async connect(): Promise<void> {
    if (!this.appId || !this.clientSecret) {
      throw new Error('QQ Bot AppID and ClientSecret are required')
    }

    this.shouldStop = false
    await this.startGateway()

    logger.info('QQ bot started', { agentId: this.agentId, channelId: this.channelId })
  }

  async disconnect(): Promise<void> {
    this.shouldStop = true
    this.cleanup()
    logger.info('QQ bot stopped', { agentId: this.agentId, channelId: this.channelId })
  }

  private async getAccessToken(): Promise<string> {
    // Check cache
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60000) {
      return this.tokenCache.accessToken
    }

    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appId: this.appId,
        clientSecret: this.clientSecret
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to get access token: HTTP ${response.status}`)
    }

    const data = (await response.json()) as { access_token: string; expires_in: number }
    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000
    }

    return data.access_token
  }

  private async getGatewayUrl(): Promise<string> {
    const token = await this.getAccessToken()
    const response = await fetch(`${QQ_API_BASE}/gateway`, {
      headers: {
        Authorization: `QQBot ${token}`,
        'X-Union-Appid': this.appId
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to get gateway URL: HTTP ${response.status}`)
    }

    const data = (await response.json()) as { url: string }
    return data.url
  }

  private async startGateway(): Promise<void> {
    if (this.isConnecting || this.shouldStop) return
    this.isConnecting = true

    try {
      this.cleanup()

      const gatewayUrl = await this.getGatewayUrl()
      logger.info('Connecting to QQ gateway', { agentId: this.agentId, url: gatewayUrl })

      const ws = new WebSocket(gatewayUrl)
      this.ws = ws

      ws.on('open', () => {
        logger.info('QQ WebSocket connected', { agentId: this.agentId })
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
        logger.info('QQ WebSocket closed', {
          agentId: this.agentId,
          code,
          reason: reason.toString()
        })
        this.scheduleReconnect()
      })

      ws.on('error', (err) => {
        logger.error('QQ WebSocket error', {
          agentId: this.agentId,
          error: err.message
        })
      })
    } catch (error) {
      logger.error('Failed to start QQ gateway', {
        agentId: this.agentId,
        error: error instanceof Error ? error.message : String(error)
      })
      this.scheduleReconnect()
    } finally {
      this.isConnecting = false
    }
  }

  private async handleWsMessage(data: Buffer): Promise<void> {
    const payload = JSON.parse(data.toString()) as {
      op: number
      d?: unknown
      s?: number
      t?: string
    }

    if (payload.s !== undefined) {
      this.lastSeq = payload.s
    }

    switch (payload.op) {
      case OP_HELLO:
        await this.handleHello(payload.d as { heartbeat_interval: number })
        break
      case OP_DISPATCH:
        await this.handleDispatch(payload.t!, payload.d)
        break
      case OP_HEARTBEAT_ACK:
        // Heartbeat acknowledged
        break
      case OP_RECONNECT:
        logger.info('QQ gateway requested reconnect', { agentId: this.agentId })
        this.scheduleReconnect()
        break
      case OP_INVALID_SESSION:
        logger.warn('QQ invalid session', { agentId: this.agentId })
        this.sessionId = null
        this.lastSeq = null
        this.scheduleReconnect()
        break
    }
  }

  private async handleHello(data: { heartbeat_interval: number }): Promise<void> {
    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, data.heartbeat_interval)

    // Identify or resume
    if (this.sessionId && this.lastSeq !== null) {
      await this.sendResume()
    } else {
      await this.sendIdentify()
    }
  }

  private async sendIdentify(): Promise<void> {
    const token = await this.getAccessToken()
    const intents = INTENTS.PUBLIC_GUILD_MESSAGES | INTENTS.DIRECT_MESSAGE | INTENTS.GROUP_AND_C2C

    this.send({
      op: OP_IDENTIFY,
      d: {
        token: `QQBot ${token}`,
        intents,
        shard: [0, 1]
      }
    })
  }

  private async sendResume(): Promise<void> {
    const token = await this.getAccessToken()

    this.send({
      op: OP_RESUME,
      d: {
        token: `QQBot ${token}`,
        session_id: this.sessionId,
        seq: this.lastSeq
      }
    })
  }

  private sendHeartbeat(): void {
    this.send({
      op: OP_HEARTBEAT,
      d: this.lastSeq
    })
  }

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private async handleDispatch(eventType: string, data: unknown): Promise<void> {
    switch (eventType) {
      case 'READY': {
        const readyData = data as { session_id: string; user: { id: string; username: string } }
        this.sessionId = readyData.session_id
        this.reconnectAttempts = 0
        logger.info('QQ bot ready', {
          agentId: this.agentId,
          sessionId: this.sessionId,
          botUser: readyData.user.username
        })
        break
      }
      case 'RESUMED':
        this.reconnectAttempts = 0
        logger.info('QQ session resumed', { agentId: this.agentId })
        break
      case 'C2C_MESSAGE_CREATE':
        await this.handleC2CMessage(data as QQMessage)
        break
      case 'GROUP_AT_MESSAGE_CREATE':
        await this.handleGroupMessage(data as QQMessage)
        break
      case 'AT_MESSAGE_CREATE':
        await this.handleGuildMessage(data as QQMessage)
        break
      case 'DIRECT_MESSAGE_CREATE':
        await this.handleDirectMessage(data as QQMessage)
        break
    }
  }

  private async handleC2CMessage(msg: QQMessage): Promise<void> {
    const chatId = `c2c:${msg.author.user_openid}`

    if (!this.isAllowed(chatId, msg.author.user_openid)) return

    const text = this.parseContent(msg.content)
    if (this.isCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      this.emitCommand(chatId, msg.author.user_openid ?? '', '', text)
    } else {
      this.emit('message', {
        chatId,
        userId: msg.author.user_openid ?? msg.author.id,
        userName: msg.author.username ?? '',
        text
      })
    }
  }

  private async handleGroupMessage(msg: QQMessage): Promise<void> {
    const chatId = `group:${msg.group_openid}`

    if (!this.isAllowed(chatId, msg.group_openid)) return

    const text = this.parseContent(msg.content)
    if (this.isCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      this.emitCommand(chatId, msg.author.member_openid ?? '', '', text)
    } else {
      this.emit('message', {
        chatId,
        userId: msg.author.member_openid ?? msg.author.id,
        userName: msg.author.username ?? '',
        text
      })
    }
  }

  private async handleGuildMessage(msg: QQMessage): Promise<void> {
    const chatId = `channel:${msg.channel_id}`

    if (!this.isAllowed(chatId, msg.channel_id)) return

    const text = this.parseContent(msg.content)
    if (this.isCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      this.emitCommand(chatId, msg.author.id, msg.author.username ?? '', text)
    } else {
      this.emit('message', {
        chatId,
        userId: msg.author.id,
        userName: msg.author.username ?? '',
        text
      })
    }
  }

  private async handleDirectMessage(msg: QQMessage): Promise<void> {
    const chatId = `dm:${msg.guild_id}`

    if (!this.isAllowed(chatId, msg.guild_id)) return

    const text = this.parseContent(msg.content)
    if (this.isCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      this.emitCommand(chatId, msg.author.id, msg.author.username ?? '', text)
    } else {
      this.emit('message', {
        chatId,
        userId: msg.author.id,
        userName: msg.author.username ?? '',
        text
      })
    }
  }

  private parseContent(content: string): string {
    // Remove @bot mentions and trim
    return content.replace(/<@!\d+>/g, '').trim()
  }

  private isAllowed(chatId: string, rawId?: string): boolean {
    if (this.allowedChatIds.length === 0) return true
    return this.allowedChatIds.includes(chatId) || (rawId !== undefined && this.allowedChatIds.includes(rawId))
  }

  private isCommand(text: string): boolean {
    return (
      text.startsWith('/new') || text.startsWith('/compact') || text.startsWith('/help') || text.startsWith('/whoami')
    )
  }

  private emitCommand(chatId: string, userId: string, userName: string, text: string): void {
    const cmd = text.split(/\s+/)[0].slice(1) as 'new' | 'compact' | 'help'
    this.emit('command', { chatId, userId, userName, command: cmd })
  }

  private async sendWhoami(chatId: string): Promise<void> {
    const message = `Your chat ID: ${chatId}\n\nAdd this to "allowed_chat_ids" in channel settings to enable notifications.`
    try {
      await this.sendMessage(chatId, message)
    } catch (err) {
      logger.error('Failed to send whoami response', {
        agentId: this.agentId,
        chatId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    const chunks = splitMessage(text)

    for (let i = 0; i < chunks.length; i++) {
      await this.sendToChat(chatId, chunks[i])

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  private async sendToChat(chatId: string, text: string): Promise<void> {
    const token = await this.getAccessToken()
    const [type, id] = chatId.split(':')

    let endpoint: string
    let body: Record<string, unknown>

    switch (type) {
      case 'c2c':
        endpoint = `${QQ_API_BASE}/v2/users/${id}/messages`
        body = { content: text, msg_type: 0 }
        break
      case 'group':
        endpoint = `${QQ_API_BASE}/v2/groups/${id}/messages`
        body = { content: text, msg_type: 0 }
        break
      case 'channel':
        endpoint = `${QQ_API_BASE}/channels/${id}/messages`
        body = { content: text }
        break
      case 'dm':
        endpoint = `${QQ_API_BASE}/dms/${id}/messages`
        body = { content: text }
        break
      default:
        throw new Error(`Unknown chat type: ${type}`)
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.appId
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Failed to send message: HTTP ${response.status} - ${errorText}`)
    }
  }

  async sendMessageDraft(_chatId: string, _draftId: number, _text: string): Promise<void> {
    // QQ does not have a native draft/streaming API like Telegram
    // This is a no-op; final message is sent via sendMessage
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    // QQ Bot API does not support typing indicators for most message types
    // For C2C, there's sendC2CInputNotify but it requires message_id context
    // This is a no-op
  }

  private cleanup(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close()
      }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (this.shouldStop || this.reconnectAttempts >= this.maxReconnectAttempts) {
      if (!this.shouldStop) {
        logger.error('Max reconnect attempts reached', { agentId: this.agentId })
      }
      return
    }

    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)]
    this.reconnectAttempts++

    logger.info('Scheduling QQ reconnect', {
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
registerAdapterFactory('qq', (channel: CherryClawChannel, agentId: string) => {
  return new QQAdapter({
    channelId: channel.id,
    agentId,
    channelConfig: channel.config
  })
})
