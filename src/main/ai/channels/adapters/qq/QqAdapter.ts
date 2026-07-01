import { type FileAttachment, type ImageAttachment, MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { net } from 'electron'
import WebSocket from 'ws'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand } from '../../constants'
import { splitMessage } from '../../utils'

const QQ_MAX_LENGTH = 2000
const QQ_API_BASE = 'https://api.sgroup.qq.com'
/**
 * QQ passive-reply window per chat type (ms): the inbound msg_id is rejected once it lapses.
 * Passive reply (against a recent msg_id) is the default delivery path and needs no opt-in.
 * Active group push reopened 2026-06-22 but only when the group owner enables "机器人主动在群聊内
 * 发言", and it is rate-limited (per-account 30-60 qpm, per-group 20 qpm). So once the window
 * lapses we omit msg_id and fall back to an active push, which is delivered only if that toggle
 * is on. Single chat (C2C) gets 60 min; group / guild subchannel / guild DM get 5 min.
 * See https://bot.q.qq.com/wiki/develop/api-v2/server-inter/message/send-receive/send.html
 */
const QQ_PASSIVE_REPLY_TTL: Record<string, number> = {
  c2c: 60 * 60 * 1000,
  group: 5 * 60 * 1000,
  channel: 5 * 60 * 1000,
  dm: 5 * 60 * 1000
}
const QQ_PASSIVE_REPLY_TTL_DEFAULT = 5 * 60 * 1000
/** QQ accepts at most 5 passive replies per inbound msg_id; the 6th is rejected. */
const QQ_MAX_PASSIVE_REPLIES = 5
/** Cap on tracked inbound ids; evict oldest beyond this so the map can't grow unbounded. */
const QQ_MAX_PASSIVE_ENTRIES = 1000

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

type QqTokenCache = {
  accessToken: string
  expiresAt: number
}

type QqAttachment = {
  content_type?: string
  filename?: string
  height?: number
  width?: number
  size?: number
  url: string
}

/** Passive-reply state for one inbound message, keyed by `chatId:msgId`. */
type PassiveReply = {
  chatId: string
  receivedAt: number
  /** Reply counter; QQ v2 dedupes repeat replies on one msg_id unless msg_seq differs. */
  seq: number
}

type QqMessage = {
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
  attachments?: QqAttachment[]
}

class QqAdapter extends ChannelAdapter {
  private ws: WebSocket | null = null
  private readonly appId: string
  private readonly clientSecret: string
  private readonly allowedChatIds: string[]

  /** Passive-reply state keyed by `chatId:msgId`, so a reply targets the exact message it answers. */
  private readonly passiveReplies = new Map<string, PassiveReply>()
  private tokenCache: QqTokenCache | null = null
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

  constructor(config: ChannelAdapterConfig<'qq'>) {
    super(config)
    const { app_id, client_secret, allowed_chat_ids } = config.channelConfig
    this.appId = app_id
    this.clientSecret = client_secret
    this.allowedChatIds = allowed_chat_ids ?? []
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

    if (payload.s !== undefined && payload.s !== null) {
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
        await this.handleC2CMessage(data as QqMessage)
        break
      case 'GROUP_AT_MESSAGE_CREATE':
        await this.handleGroupMessage(data as QqMessage)
        break
      case 'AT_MESSAGE_CREATE':
        await this.handleGuildMessage(data as QqMessage)
        break
      case 'DIRECT_MESSAGE_CREATE':
        await this.handleDirectMessage(data as QqMessage)
        break
    }
  }

  private async handleC2CMessage(msg: QqMessage): Promise<void> {
    const chatId = `c2c:${msg.author.user_openid}`
    if (!this.isAllowed(chatId, msg.author.user_openid)) return
    await this.processMessage(msg, chatId, msg.author.user_openid ?? msg.author.id, msg.author.username ?? '')
  }

  private async handleGroupMessage(msg: QqMessage): Promise<void> {
    const chatId = `group:${msg.group_openid}`
    if (!this.isAllowed(chatId, msg.group_openid)) return
    await this.processMessage(msg, chatId, msg.author.member_openid ?? msg.author.id, msg.author.username ?? '')
  }

  private async handleGuildMessage(msg: QqMessage): Promise<void> {
    const chatId = `channel:${msg.channel_id}`
    if (!this.isAllowed(chatId, msg.channel_id)) return
    await this.processMessage(msg, chatId, msg.author.id, msg.author.username ?? '')
  }

  private async handleDirectMessage(msg: QqMessage): Promise<void> {
    const chatId = `dm:${msg.guild_id}`
    if (!this.isAllowed(chatId, msg.guild_id)) return
    await this.processMessage(msg, chatId, msg.author.id, msg.author.username ?? '')
  }

  private async processMessage(msg: QqMessage, chatId: string, userId: string, userName: string): Promise<void> {
    // Record the inbound id at receive time (for the passive-reply window), keyed so a later
    // reply targets this exact message rather than whatever arrived most recently in the chat.
    // Passive reply is the default path and needs no group-owner opt-in; active group push works
    // only when the owner enables it (reopened 2026-06-22, rate-limited).
    this.recordInbound(chatId, msg.id)

    const text = this.parseContent(msg.content)

    if (isSlashCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId, msg.id)
        return
      }
      this.emitCommand(chatId, userId, userName, text, msg.id)
      return
    }

    const { images, files } = await this.downloadAttachments(msg.attachments)
    if (!text && !images && !files) return

    this.emit('message', {
      chatId,
      userId,
      userName,
      text,
      messageId: msg.id,
      images,
      files
    })
  }

  /** Record an inbound message id for passive replies, evicting the oldest entries past the cap. */
  private recordInbound(chatId: string, msgId: string): void {
    this.passiveReplies.set(`${chatId}:${msgId}`, { chatId, receivedAt: Date.now(), seq: 0 })
    while (this.passiveReplies.size > QQ_MAX_PASSIVE_ENTRIES) {
      const oldest = this.passiveReplies.keys().next().value
      if (oldest === undefined) break
      this.passiveReplies.delete(oldest)
    }
  }

  /**
   * Download QQ attachments, splitting into images and files.
   * QQ CDN URLs may require the QQBot auth header.
   */
  private async downloadAttachments(
    attachments?: QqAttachment[]
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
            // SSRF guard: reject local/private/credentialed/non-http(s) targets from the
            // inbound payload before we fetch with the bot token (and before the retry).
            const safeUrl = sanitizeRemoteUrl(url)
            const response = await net.fetch(safeUrl, {
              headers: { Authorization: `QQBot ${token}`, 'X-Union-Appid': this.appId }
            })
            if (!response.ok) {
              // Retry without auth header (some CDN URLs are public)
              const retry = await net.fetch(safeUrl)
              if (!retry.ok) return
              const buffer = Buffer.from(await retry.arrayBuffer())
              // `att.size` is attacker-supplied metadata; cap on the real downloaded bytes.
              if (buffer.length > MAX_FILE_SIZE_BYTES) return
              this.pushAttachment(att, buffer, images, files)
            } else {
              const buffer = Buffer.from(await response.arrayBuffer())
              if (buffer.length > MAX_FILE_SIZE_BYTES) return
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

  private pushAttachment(att: QqAttachment, buffer: Buffer, images: ImageAttachment[], files: FileAttachment[]): void {
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

  private emitCommand(chatId: string, userId: string, userName: string, text: string, messageId: string): void {
    const cmd = text.split(/\s+/)[0].slice(1) as 'new' | 'compact' | 'help'
    this.emit('command', { chatId, userId, userName, command: cmd, messageId })
  }

  private async sendWhoami(chatId: string, messageId: string): Promise<void> {
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
      await this.sendMessage(chatId, message, { replyToMessageId: messageId })
    } catch (err) {
      this.log.error('Failed to send whoami response', {
        chatId,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    const chunks = splitMessage(text, QQ_MAX_LENGTH)
    // Reply against the message being answered, if the caller threaded one. QQ ids are strings;
    // a numeric replyToMessageId (Telegram's shape) isn't a QQ msg_id, so ignore it.
    const replyToMsgId = typeof opts?.replyToMessageId === 'string' ? opts.replyToMessageId : undefined

    for (let i = 0; i < chunks.length; i++) {
      await this.sendToChat(chatId, chunks[i], replyToMsgId)

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  private async sendToChat(chatId: string, text: string, replyToMsgId?: string): Promise<void> {
    const [type, id] = chatId.split(':')

    let endpoint: string
    const body: Record<string, unknown> = { markdown: { content: text }, msg_type: 2 }

    switch (type) {
      case 'c2c':
        endpoint = `${QQ_API_BASE}/v2/users/${id}/messages`
        break
      case 'group':
        endpoint = `${QQ_API_BASE}/v2/groups/${id}/messages`
        break
      case 'channel':
        endpoint = `${QQ_API_BASE}/channels/${id}/messages`
        break
      case 'dm':
        endpoint = `${QQ_API_BASE}/dms/${id}/messages`
        break
      default:
        throw new Error(`Unknown chat type: ${type}`)
    }

    const seq = replyToMsgId ? this.nextPassiveSeq(chatId, type, replyToMsgId) : undefined
    if (seq !== undefined) {
      body.msg_id = replyToMsgId
      // v2 group/C2C dedupe repeat replies sharing one msg_id; a unique seq keeps every chunk.
      if (type === 'group' || type === 'c2c') {
        body.msg_seq = seq
      }
    }

    await this.apiRequest(endpoint, { method: 'POST', body })
  }

  /**
   * Claim the next passive-reply seq for the exact inbound message being answered, or undefined
   * to fall back to active push once the reply window has lapsed or the per-msg_id cap (5) is hit.
   * Advancing the seq keeps chunked replies from being deduped by QQ (same msg_id + msg_seq fails).
   */
  private nextPassiveSeq(chatId: string, type: string, msgId: string): number | undefined {
    const key = `${chatId}:${msgId}`
    const entry = this.passiveReplies.get(key)
    if (!entry) return undefined
    const ttl = QQ_PASSIVE_REPLY_TTL[type] ?? QQ_PASSIVE_REPLY_TTL_DEFAULT
    if (Date.now() - entry.receivedAt > ttl) {
      this.passiveReplies.delete(key)
      // The inbound msg_id has expired, so this reply degrades to an active push, which QQ
      // delivers to a group only if the owner enabled "机器人主动在群聊内发言". Surface it so a
      // silently-undelivered group reply is traceable.
      this.log.warn('QQ passive-reply window lapsed; falling back to active push', { chatId, ttl })
      return undefined
    }
    if (entry.seq >= QQ_MAX_PASSIVE_REPLIES) {
      this.passiveReplies.delete(key)
      this.log.warn('QQ passive-reply limit (5 per msg_id) reached; falling back to active push', { chatId })
      return undefined
    }
    entry.seq += 1
    return entry.seq
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
  return new QqAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
