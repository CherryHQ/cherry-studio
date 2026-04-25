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
import { FlushController } from '../../FlushController'
import { splitMessage } from '../../utils'
import { toSlackMarkdown } from './slackMarkdown'

const SLACK_API_BASE = 'https://slack.com/api'
const SLACK_MAX_LENGTH = 4000

/**
 * Slack rate limit for chat.update: ~1 per second per channel.
 * Use 1500ms throttle to stay safely within limits.
 */
const SLACK_STREAM_THROTTLE_MS = 1500

// ─── Slack Types ──────────────────────────────────────────────

type SlackFile = {
  id: string
  name: string
  mimetype: string
  size: number
  url_private: string
}

type SlackMessageEvent = {
  type: 'message'
  subtype?: string
  channel: string
  user?: string
  text?: string
  files?: SlackFile[]
  ts: string
  channel_type?: string // 'im' for DMs, 'channel'/'group' for channels
}

type SlackSocketEnvelope = {
  envelope_id: string
  type: 'events_api' | 'slash_commands' | 'interactive' | 'hello' | 'disconnect'
  payload?: {
    event?: SlackMessageEvent
    command?: string
    text?: string
    user_id?: string
    user_name?: string
    channel_id?: string
  }
  retry_attempt?: number
  retry_reason?: string
}

// ─── Streaming Controller ─────────────────────────────────────

/**
 * Manages a single streaming response by creating a message, then
 * editing it in-place with throttled updates via FlushController.
 */
class SlackStreamingController {
  private messageTs: string | null = null
  private currentText = ''
  private readonly flush: FlushController
  private messageCreationPromise: Promise<void> | null = null
  private _completed = false

  constructor(
    private readonly channelId: string,
    private readonly apiRequest: SlackAdapter['apiRequest'],
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
    if (this.messageTs) {
      await this.flush.throttledUpdate(SLACK_STREAM_THROTTLE_MS)
    }
  }

  async complete(finalText: string): Promise<boolean> {
    if (this._completed) return false
    this._completed = true
    this.flush.complete()

    if (this.messageCreationPromise) await this.messageCreationPromise
    if (!this.messageTs) return false

    await this.flush.waitForFlush()

    try {
      this.currentText = finalText
      await this.editMessage(finalText)
      return true
    } catch (error) {
      this.log.warn('Failed to finalize Slack stream', {
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
    if (!this.messageTs) return

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
    if (this.messageTs) return
    if (this.messageCreationPromise) {
      await this.messageCreationPromise
      return
    }
    this.messageCreationPromise = this.createMessage()
    await this.messageCreationPromise
  }

  private async createMessage(): Promise<void> {
    try {
      const data = await this.apiRequest('chat.postMessage', {
        channel: this.channelId,
        text: toSlackMarkdown(this.currentText) || '...'
      })
      this.messageTs = (data as { ts?: string }).ts ?? null
    } catch (error) {
      this.log.warn('Failed to create Slack streaming message', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async editMessage(text: string): Promise<void> {
    if (!this.messageTs) return
    const converted = toSlackMarkdown(text)
    const content = converted.length > SLACK_MAX_LENGTH ? converted.slice(0, SLACK_MAX_LENGTH - 3) + '...' : converted
    await this.apiRequest('chat.update', {
      channel: this.channelId,
      ts: this.messageTs,
      text: content
    })
  }

  private async performFlush(): Promise<void> {
    if (!this.messageTs || !this.currentText) return
    try {
      await this.editMessage(this.currentText)
    } catch {
      // Swallow flush errors — FlushController will reflush if needed
    }
  }
}

// ─── Slack Adapter ────────────────────────────────────────────

class SlackAdapter extends ChannelAdapter {
  private ws: WebSocket | null = null
  private readonly botToken: string
  private readonly appToken: string
  private readonly allowedChannelIds: string[]

  private botUserId: string | null = null
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private shouldStop = false
  private pingTimer: ReturnType<typeof setInterval> | null = null
  /** User info cache: Slack user ID → display name */
  private readonly userNameCache = new Map<string, string>()

  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000]
  private readonly maxReconnectAttempts = 50
  private readonly streamingControllers = new Map<string, SlackStreamingController>()
  /** Track the latest incoming message ts per chatId for reaction acknowledgment */
  private readonly pendingReactions = new Map<string, string>()

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { bot_token, app_token, allowed_channel_ids } = config.channelConfig
    this.botToken = (bot_token as string) ?? ''
    this.appToken = (app_token as string) ?? ''
    const rawIds = allowed_channel_ids as string[] | undefined
    this.allowedChannelIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChannelIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!(this.botToken && this.appToken)
  }

  protected override async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.botToken) throw new Error('Slack bot token (xoxb-...) is required')
    if (!this.appToken) throw new Error('Slack app-level token (xapp-...) is required for Socket Mode')
    this.shouldStop = false
    await this.fetchBotUserId()
    await this.startSocketMode()
    this.log.info('Slack bot started')
  }

  protected override async performDisconnect(): Promise<void> {
    this.shouldStop = true
    for (const controller of this.streamingControllers.values()) {
      controller.dispose()
    }
    this.streamingControllers.clear()
    this.pendingReactions.clear()
    this.cleanup()
    this.log.info('Slack bot stopped')
  }

  // ─── Socket Mode Connection ─────────────────────────────────

  private async fetchBotUserId(): Promise<void> {
    try {
      const data = (await this.apiRequest('auth.test', {})) as { user_id?: string }
      this.botUserId = data.user_id ?? null
      this.log.info('Slack bot identity resolved', { botUserId: this.botUserId })
    } catch (error) {
      this.log.warn('Failed to resolve bot user ID', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async getSocketModeUrl(): Promise<string> {
    const response = await net.fetch(`${SLACK_API_BASE}/apps.connections.open`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.appToken}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to open Socket Mode connection: HTTP ${response.status}`)
    }

    const data = (await response.json()) as { ok: boolean; url?: string; error?: string }
    if (!data.ok || !data.url) {
      throw new Error(`Socket Mode connection failed: ${data.error ?? 'no URL returned'}`)
    }

    return data.url
  }

  private async startSocketMode(): Promise<void> {
    if (this.shouldStop) return

    try {
      this.cleanup()

      const wsUrl = await this.getSocketModeUrl()
      this.log.info('Connecting to Slack Socket Mode')

      const ws = new WebSocket(wsUrl)
      this.ws = ws

      ws.on('open', () => {
        this.log.info('Slack WebSocket connected')
        // Slack Socket Mode requires periodic pings to keep alive
        this.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping()
          }
        }, 30_000)
      })

      ws.on('message', (data: Buffer) => {
        this.handleSocketMessage(data).catch((err) => {
          this.log.error('Error handling Socket Mode message', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
      })

      ws.on('close', (code, reason) => {
        this.markDisconnected(`WebSocket closed: ${code}`)
        this.log.warn(`WebSocket closed (code=${code}, reason=${reason.toString()})`)
        this.scheduleReconnect()
      })

      ws.on('error', (err) => {
        this.log.error('Slack WebSocket error', { error: err.message })
      })
    } catch (error) {
      this.log.error('Failed to start Slack Socket Mode', {
        error: error instanceof Error ? error.message : String(error)
      })
      this.scheduleReconnect()
    }
  }

  // ─── Socket Mode Message Handling ───────────────────────────

  private async handleSocketMessage(data: Buffer): Promise<void> {
    let envelope: SlackSocketEnvelope
    try {
      envelope = JSON.parse(data.toString())
    } catch {
      return
    }

    // Acknowledge the envelope immediately (Slack requires ACK within 3s)
    if (envelope.envelope_id) {
      this.send({ envelope_id: envelope.envelope_id })
    }

    switch (envelope.type) {
      case 'hello':
        this.reconnectAttempts = 0
        this.markConnected()
        this.log.info('Slack Socket Mode hello received')
        break
      case 'disconnect':
        this.log.info('Slack requested disconnect, will reconnect')
        this.ws?.close(1000, 'Server requested disconnect')
        break
      case 'events_api':
        if (envelope.payload?.event) {
          await this.handleEvent(envelope.payload.event)
        }
        break
      case 'slash_commands':
        if (envelope.payload) {
          await this.handleSlashCommand(envelope.payload)
        }
        break
    }
  }

  private async handleEvent(event: SlackMessageEvent): Promise<void> {
    if (event.type !== 'message') return
    // Ignore subtypes (edits, deletes, bot_message, etc.) but allow file_share
    if (event.subtype && event.subtype !== 'file_share') return
    // Ignore bot's own messages
    if (event.user && this.botUserId && event.user === this.botUserId) return

    const chatId = event.channel
    if (!this.isAllowed(chatId)) return

    // Add 👀 reaction to acknowledge receipt
    await this.addReaction(chatId, event.ts)

    const userId = event.user ?? ''
    const userName = await this.resolveUserName(userId)

    // Strip bot mentions from text
    const rawText = event.text ?? ''
    const text = rawText.replace(/<@[A-Z0-9]+>/g, '').trim()

    // Extract images and files from attachments
    const imageUrls: string[] = []
    const fileAttachments: Array<{ url: string; filename: string; size: number }> = []

    if (event.files?.length) {
      for (const file of event.files) {
        if (file.mimetype?.startsWith('image/')) {
          imageUrls.push(file.url_private)
        } else if (file.size <= MAX_FILE_SIZE_BYTES) {
          fileAttachments.push({ url: file.url_private, filename: file.name, size: file.size })
        }
      }
    }

    if (!text && imageUrls.length === 0 && fileAttachments.length === 0) return

    if (isSlashCommand(text)) {
      if (text.startsWith('/whoami')) {
        await this.sendWhoami(chatId)
        return
      }
      const cmd = text.split(/\s+/)[0].slice(1) as 'new' | 'compact' | 'help'
      this.emit('command', { chatId, userId, userName, command: cmd })
    } else {
      // Download images (with bot token auth for private files)
      let images: ImageAttachment[] | undefined
      if (imageUrls.length > 0) {
        const results = await Promise.all(imageUrls.map((url) => this.downloadSlackFile(url)))
        const downloaded = results.filter((r): r is ImageAttachment => r !== null)
        if (downloaded.length > 0) images = downloaded
      }

      let files: FileAttachment[] | undefined
      if (fileAttachments.length > 0) {
        const results = await Promise.all(
          fileAttachments.map((att) => this.downloadSlackFileAsAttachment(att.url, att.filename))
        )
        const downloaded = results.filter((r): r is FileAttachment => r !== null)
        if (downloaded.length > 0) files = downloaded
      }

      this.emit('message', { chatId, userId, userName, text, images, files })
    }
  }

  private async handleSlashCommand(payload: NonNullable<SlackSocketEnvelope['payload']>): Promise<void> {
    const command = payload.command?.replace('/', '') ?? ''
    const chatId = payload.channel_id ?? ''
    const userId = payload.user_id ?? ''
    const userName = payload.user_name ?? ''

    if (!chatId) return
    if (!this.isAllowed(chatId)) return

    if (command === 'whoami') {
      await this.sendWhoami(chatId)
      return
    }

    if (['new', 'compact', 'help'].includes(command)) {
      this.emit('command', { chatId, userId, userName, command: command as 'new' | 'compact' | 'help' })
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private isAllowed(chatId: string): boolean {
    if (this.allowedChannelIds.length === 0) return true
    return this.allowedChannelIds.includes(chatId)
  }

  private async resolveUserName(userId: string): Promise<string> {
    if (!userId) return ''
    const cached = this.userNameCache.get(userId)
    if (cached) return cached

    try {
      const data = (await this.apiRequest('users.info', { user: userId })) as {
        user?: { real_name?: string; name?: string }
      }
      const name = data.user?.real_name || data.user?.name || userId
      this.userNameCache.set(userId, name)
      return name
    } catch {
      return userId
    }
  }

  /**
   * Download a Slack private file URL using bot token authorization.
   * Slack file URLs (url_private) require Bearer auth.
   */
  private async downloadSlackFile(url: string): Promise<ImageAttachment | null> {
    try {
      const response = await net.fetch(url, {
        headers: { Authorization: `Bearer ${this.botToken}` }
      })
      if (!response.ok) return null
      const contentType = response.headers.get('content-type') || 'image/png'
      const mediaType = contentType.split(';')[0].trim()
      const buffer = Buffer.from(await response.arrayBuffer())
      return { data: buffer.toString('base64'), media_type: mediaType }
    } catch {
      return null
    }
  }

  private async downloadSlackFileAsAttachment(url: string, filename: string): Promise<FileAttachment | null> {
    try {
      const response = await net.fetch(url, {
        headers: { Authorization: `Bearer ${this.botToken}` }
      })
      if (!response.ok) return null
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length > MAX_FILE_SIZE_BYTES) return null
      const contentType = response.headers.get('content-type') || 'application/octet-stream'
      const mediaType = contentType.split(';')[0].trim()
      return { filename, data: buffer.toString('base64'), media_type: mediaType, size: buffer.length }
    } catch {
      return null
    }
  }

  private async sendWhoami(chatId: string): Promise<void> {
    const message = [
      `*Chat Info*`,
      ``,
      `Channel ID: \`${chatId}\``,
      ``,
      `To enable notifications for this chat:`,
      `1. Go to Agent Settings > Channels > Slack`,
      `2. Add \`${chatId}\` to Allowed Channel IDs`,
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

  // ─── Message Sending (Web API) ──────────────────────────────

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    await this.removeReaction(chatId)

    const mrkdwn = toSlackMarkdown(text)
    const chunks = splitMessage(mrkdwn, SLACK_MAX_LENGTH)

    for (let i = 0; i < chunks.length; i++) {
      await this.apiRequest('chat.postMessage', {
        channel: chatId,
        text: chunks[i]
      })

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendTypingIndicator(_chatId: string): Promise<void> {
    // Slack doesn't have a public "typing" API for bots.
    // Acknowledgment is handled via reactions in handleEvent() instead.
  }

  // ─── Streaming ─────────────────────────────────────────────

  override async onTextUpdate(chatId: string, fullText: string): Promise<void> {
    let controller = this.streamingControllers.get(chatId)
    if (!controller || controller.completed) {
      controller = new SlackStreamingController(chatId, this.apiRequest.bind(this), this.log)
      this.streamingControllers.set(chatId, controller)
    }
    await controller.onText(fullText)
  }

  override async onStreamComplete(chatId: string, finalText: string): Promise<boolean> {
    const controller = this.streamingControllers.get(chatId)
    if (!controller) return false
    try {
      await this.removeReaction(chatId)
      return await controller.complete(finalText)
    } finally {
      this.streamingControllers.delete(chatId)
    }
  }

  override async onStreamError(chatId: string, error: string): Promise<void> {
    const controller = this.streamingControllers.get(chatId)
    if (!controller) return
    try {
      await this.removeReaction(chatId)
      await controller.error(error)
    } finally {
      this.streamingControllers.delete(chatId)
    }
  }

  // ─── Reaction Acknowledgment ────────────────────────────────

  private async addReaction(chatId: string, ts: string): Promise<void> {
    try {
      await this.apiRequest('reactions.add', { channel: chatId, name: 'eyes', timestamp: ts })
      this.pendingReactions.set(chatId, ts)
    } catch {
      // Best-effort — don't fail message handling if reaction fails
    }
  }

  private async removeReaction(chatId: string): Promise<void> {
    const ts = this.pendingReactions.get(chatId)
    if (!ts) return
    this.pendingReactions.delete(chatId)
    try {
      await this.apiRequest('reactions.remove', { channel: chatId, name: 'eyes', timestamp: ts })
    } catch {
      // Best-effort removal
    }
  }

  // ─── Slack Web API Helper ──────────────────────────────────

  private async apiRequest(method: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await net.fetch(`${SLACK_API_BASE}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.botToken}`,
        'Content-Type': 'application/json; charset=utf-8'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => '')
      throw new Error(`Slack API error ${method}: HTTP ${response.status} - ${errorText}`)
    }

    const data = (await response.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      throw new Error(`Slack API error ${method}: ${data.error ?? 'unknown error'}`)
    }

    return data
  }

  // ─── WebSocket Helper ──────────────────────────────────────

  private send(payload: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  // ─── Lifecycle Helpers ──────────────────────────────────────

  private cleanup(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.pingTimer) {
      clearInterval(this.pingTimer)
      this.pingTimer = null
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
        this.startSocketMode().catch((err) => {
          this.log.error('Reconnect failed', {
            error: err instanceof Error ? err.message : String(err)
          })
        })
      }
    }, delay)
  }
}

// Self-registration
registerAdapterFactory('slack', (channel, agentId) => {
  return new SlackAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config as Record<string, unknown>
  })
})
