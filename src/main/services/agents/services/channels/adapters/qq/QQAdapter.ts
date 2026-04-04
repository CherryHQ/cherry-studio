import { net } from 'electron'
import WebSocket from 'ws'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  type FileAttachment,
  type ImageAttachment,
  MAX_FILE_SIZE_BYTES,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand } from '../../constants'
import { splitMessage } from '../../utils'

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

type QQAttachment = {
  content_type?: string
  filename?: string
  height?: number
  width?: number
  size?: number
  url: string
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
  attachments?: QQAttachment[]
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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private rapidDisconnects = 0
  private connectedAt = 0
  private isConnecting = false
  private shouldStop = false

  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000]
  private readonly maxReconnectAttempts = 100
  /** Minimum connection duration (ms) to consider stable */
  private readonly stableConnectionThreshold = 30_000
  /** Number of rapid disconnects before invalidating session */
  private readonly maxRapidDisconnects = 3

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { app_id, client_secret, allowed_chat_ids } = config.channelConfig
    this.appId = (app_id as string) ?? ''
    this.clientSecret = (client_secret as string) ?? ''
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!(this.appId && this.clientSecret)
  }

  protected override async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.appId || !this.clientSecret) {
      throw new Error('QQ Bot AppID and ClientSecret are required')
    }

    this.shouldStop = false
    await this.startGateway()

    this.log.info('QQ bot started')
  }

  protected override async performDisconnect(): Promise<void> {
    this.shouldStop = true
    this.cleanup()
    this.log.info('QQ bot stopped')
  }

  private async getAccessToken(): Promise<string> {
    // Check cache
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60000) {
      return this.tokenCache.accessToken
    }

    const response = await net.fetch('https://bots.qq.com/app/getAppAccessToken', {
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

    const data = (await response.json()) as { access_token?: string; expires_in?: number }
    if (!data.access_token || !data.expires_in) {
      const errorText = JSON.stringify(data)
      throw new Error(`Invalid token response from QQ API: ${errorText}`)
    }

    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000
    }

    return data.access_token
  }

  private async apiRequest(
    endpoint: string,
    options?: { method?: string; body?: Record<string, unknown> }
  ): Promise<Response> {
    const token = await this.getAccessToken()
    const response = await net.fetch(endpoint, {
      method: options?.method ?? 'GET',
      headers: {
        Authorization: `QQBot ${token}`,
        'Content-Type': 'application/json',
        'X-Union-Appid': this.appId
      },
      ...(options?.body ? { body: JSON.stringify(options.body) } : {})
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`QQ API request failed ${endpoint}: HTTP ${response.status} - ${errorText}`)
    }

    return response
  }

  private async getGatewayUrl(): Promise<string> {
    const response = await this.apiRequest(`${QQ_API_BASE}/gateway`)
    const data = (await response.json()) as { url: string }
    return data.url
  }

  private async startGateway(): Promise<void> {
    if (this.isConnecting || this.shouldStop) return
    this.isConnecting = true

    try {
      this.cleanup()

      const gatewayUrl = await this.getGatewayUrl()
      this.log.info('Connecting to QQ gateway', { url: gatewayUrl })

      const ws = new WebSocket(gatewayUrl)
      this.ws = ws

      ws.on('open', () => {
        this.log.info('QQ WebSocket connected')
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
        this.log.info('QQ WebSocket closed', {
          code,
          reason: reason.toString()
        })
        this.scheduleReconnect()
      })

      ws.on('error', (err) => {
        this.log.error('QQ WebSocket error', {
          error: err.message
        })
      })
    } catch (error) {
      this.log.error('Failed to start QQ gateway', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.scheduleReconnect()
    } finally {
      this.isConnecting = false
    }
  }

  private async handleWsMessage(data: Buffer): Promise<void> {
    let payload: { op: number; d?: unknown; s?: number; t?: string }
    try {
      payload = JSON.parse(data.toString())
    } catch {
      this.log.warn('Invalid JSON from QQ WebSocket')
      return
    }

    if (payload.s !== undefined) {
      this.lastSeq = payload.s
    }

    switch (payload.op) {
      case OP_HELLO:
        await this.handleHello(payload.d as { heartbeat_interval: number })
        break
      case OP_DISPATCH:
        if (payload.t) {
          await this.handleDispatch(payload.t, payload.d)
        }
        break
      case OP_HEARTBEAT_ACK:
        // Heartbeat acknowledged
        break
      case OP_RECONNECT:
        this.log.info('QQ gateway requested reconnect')
        this.scheduleReconnect()
        break
      case OP_INVALID_SESSION:
        this.log.warn('QQ invalid session')
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
        this.rapidDisconnects = 0
        this.connectedAt = Date.now()
        this.markConnected()
        this.log.info(`QQ bot ready (user: ${readyData.user.username})`)
        this.log.info('QQ bot ready', {
          sessionId: this.sessionId,
          botUser: readyData.user.username
        })
        break
      }
      case 'RESUMED':
        this.connectedAt = Date.now()
        this.markConnected()
        this.log.info('QQ session resumed')
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
    await this.processMessage(msg, chatId, msg.author.user_openid ?? msg.author.id, msg.author.username ?? '')
  }

  private async handleGroupMessage(msg: QQMessage): Promise<void> {
    const chatId = `group:${msg.group_openid}`
    if (!this.isAllowed(chatId, msg.group_openid)) return
    await this.processMessage(msg, chatId, msg.author.member_openid ?? msg.author.id, msg.author.username ?? '')
  }

  private async handleGuildMessage(msg: QQMessage): Promise<void> {
    const chatId = `channel:${msg.channel_id}`
    if (!this.isAllowed(chatId, msg.channel_id)) return
    await this.processMessage(msg, chatId, msg.author.id, msg.author.username ?? '')
  }

  private async handleDirectMessage(msg: QQMessage): Promise<void> {
    const chatId = `dm:${msg.guild_id}`
    if (!this.isAllowed(chatId, msg.guild_id)) return
    await this.processMessage(msg, chatId, msg.author.id, msg.author.username ?? '')
  }

  private async processMessage(msg: QQMessage, chatId: string, userId: string, userName: string): Promise<void> {
    const text = this.parseContent(msg.content)

    if (isSlashCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      this.emitCommand(chatId, userId, userName, text)
      return
    }

    const { images, files } = await this.downloadAttachments(msg.attachments)
    if (!text && !images && !files) return

    this.emit('message', {
      chatId,
      userId,
      userName,
      text,
      images,
      files
    })
  }

  /**
   * Download QQ attachments, splitting into images and files.
   * QQ CDN URLs may require the QQBot auth header.
   */
  private async downloadAttachments(
    attachments?: QQAttachment[]
  ): Promise<{ images?: ImageAttachment[]; files?: FileAttachment[] }> {
    if (!attachments || attachments.length === 0) return {}

    const images: ImageAttachment[] = []
    const files: FileAttachment[] = []
    const token = await this.getAccessToken()

    await Promise.all(
      attachments
        .filter((att) => !att.size || att.size <= MAX_FILE_SIZE_BYTES)
        .map(async (att) => {
          try {
            const url = att.url.startsWith('http') ? att.url : `https://${att.url}`
            const response = await net.fetch(url, {
              headers: { Authorization: `QQBot ${token}`, 'X-Union-Appid': this.appId }
            })
            if (!response.ok) {
              // Retry without auth header (some CDN URLs are public)
              const retry = await net.fetch(url)
              if (!retry.ok) return
              const buffer = Buffer.from(await retry.arrayBuffer())
              this.pushAttachment(att, buffer, images, files)
            } else {
              const buffer = Buffer.from(await response.arrayBuffer())
              this.pushAttachment(att, buffer, images, files)
            }
          } catch {
            this.log.warn('Failed to download QQ attachment', { filename: att.filename, url: att.url })
          }
        })
    )

    return {
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {})
    }
  }

  private pushAttachment(att: QQAttachment, buffer: Buffer, images: ImageAttachment[], files: FileAttachment[]): void {
    const mediaType = att.content_type || 'application/octet-stream'
    if (mediaType.startsWith('image/')) {
      images.push({ data: buffer.toString('base64'), media_type: mediaType })
    } else {
      files.push({
        filename: att.filename || 'file',
        data: buffer.toString('base64'),
        media_type: mediaType,
        size: buffer.length
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

  private emitCommand(chatId: string, userId: string, userName: string, text: string): void {
    const cmd = text.split(/\s+/)[0].slice(1) as 'new' | 'compact' | 'help'
    this.emit('command', { chatId, userId, userName, command: cmd })
  }

  private async sendWhoami(chatId: string): Promise<void> {
    const [type] = chatId.split(':')
    const typeLabel =
      type === 'c2c' ? 'Private' : type === 'group' ? 'Group' : type === 'channel' ? 'Guild Channel' : 'Direct Message'

    const message = [
      `📍 Chat Info`,
      ``,
      `Type: ${typeLabel}`,
      `Chat ID: ${chatId}`,
      ``,
      `To enable notifications for this chat:`,
      `1. Go to Agent Settings → Channels → QQ`,
      `2. Add "${chatId}" to Allowed Chat IDs`,
      `3. Enable "Receive Notifications"`,
      ``,
      `Then use the notify tool or scheduled tasks will send messages here.`
    ].join('\n')

    try {
      await this.sendMessage(chatId, message)
    } catch (err) {
      this.log.error('Failed to send whoami response', {
        chatId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    const chunks = splitMessage(text, QQ_MAX_LENGTH)

    for (let i = 0; i < chunks.length; i++) {
      await this.sendToChat(chatId, chunks[i])

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  private async sendToChat(chatId: string, text: string): Promise<void> {
    const [type, id] = chatId.split(':')

    let endpoint: string
    let body: Record<string, unknown>

    switch (type) {
      case 'c2c':
        endpoint = `${QQ_API_BASE}/v2/users/${id}/messages`
        body = { markdown: { content: text }, msg_type: 2 }
        break
      case 'group':
        endpoint = `${QQ_API_BASE}/v2/groups/${id}/messages`
        body = { markdown: { content: text }, msg_type: 2 }
        break
      case 'channel':
        endpoint = `${QQ_API_BASE}/channels/${id}/messages`
        body = { markdown: { content: text }, msg_type: 2 }
        break
      case 'dm':
        endpoint = `${QQ_API_BASE}/dms/${id}/messages`
        body = { markdown: { content: text }, msg_type: 2 }
        break
      default:
        throw new Error(`Unknown chat type: ${type}`)
    }

    await this.apiRequest(endpoint, { method: 'POST', body })
  }

  // oxlint-disable-next-line no-unused-vars -- no-op abstract method
  async sendTypingIndicator(_chatId: string): Promise<void> {
    // QQ Bot API does not support typing indicators for most message types
    // For C2C, there's sendC2CInputNotify but it requires message_id context
    // This is a no-op
  }

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
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
    this.tokenCache = null
  }

  private scheduleReconnect(): void {
    if (this.shouldStop) return

    // Detect rapid disconnects: if the connection lasted less than the threshold, it's unstable
    const connectionDuration = this.connectedAt > 0 ? Date.now() - this.connectedAt : 0
    if (this.connectedAt > 0 && connectionDuration < this.stableConnectionThreshold) {
      this.rapidDisconnects++
      // After repeated rapid disconnects, the session is likely stale — force fresh IDENTIFY
      if (this.rapidDisconnects >= this.maxRapidDisconnects && this.sessionId) {
        this.log.warn('Too many rapid disconnects after resume, invalidating session', {
          rapidDisconnects: this.rapidDisconnects
        })
        this.sessionId = null
        this.lastSeq = null
        this.rapidDisconnects = 0
      }
    } else if (connectionDuration >= this.stableConnectionThreshold) {
      // Connection was stable — reset counters
      this.reconnectAttempts = 0
      this.rapidDisconnects = 0
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.markDisconnected('Max reconnect attempts reached')
      this.log.error('Max reconnect attempts reached, giving up')
      return
    }

    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)]
    this.reconnectAttempts++

    this.log.info(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
    this.log.info('Scheduling QQ reconnect', {
      attempt: this.reconnectAttempts,
      delay
    })

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
registerAdapterFactory('qq', (channel, agentId) => {
  return new QQAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
