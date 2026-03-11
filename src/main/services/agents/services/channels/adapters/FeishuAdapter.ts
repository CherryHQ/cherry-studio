import * as Lark from '@larksuiteoapi/node-sdk'
import { loggerService } from '@logger'
import type { CherryClawChannel, FeishuDomain } from '@types'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../ChannelAdapter'
import { registerAdapterFactory } from '../ChannelManager'

const logger = loggerService.withContext('FeishuAdapter')

const FEISHU_MAX_LENGTH = 4000

// Feishu message event shape (im.message.receive_v1)
type FeishuMessageEvent = {
  sender: {
    sender_id: { open_id?: string; user_id?: string; union_id?: string }
    sender_type?: string
  }
  message: {
    message_id: string
    chat_id: string
    chat_type: 'p2p' | 'group'
    message_type: string
    content: string // JSON-encoded
    mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>
  }
}

function resolveDomain(domain: FeishuDomain): Lark.Domain {
  switch (domain) {
    case 'lark':
      return Lark.Domain.Lark
    case 'feishu':
    default:
      return Lark.Domain.Feishu
  }
}

function resolveApiBase(domain: FeishuDomain): string {
  switch (domain) {
    case 'lark':
      return 'https://open.larksuite.com/open-apis'
    case 'feishu':
    default:
      return 'https://open.feishu.cn/open-apis'
  }
}

function splitMessage(text: string): string[] {
  if (text.length <= FEISHU_MAX_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= FEISHU_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', FEISHU_MAX_LENGTH)
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('\n', FEISHU_MAX_LENGTH)
    }
    if (splitIndex <= 0) {
      splitIndex = FEISHU_MAX_LENGTH
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '')
  }

  return chunks
}

/**
 * Build a Feishu "post" message payload with markdown element.
 * Feishu's post format with md tag renders markdown natively.
 */
function buildPostPayload(text: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text }]]
    }
  })
}

/**
 * Build a Feishu interactive card with markdown content (schema 2.0).
 */
function buildMarkdownCard(text: string): string {
  return JSON.stringify({
    schema: '2.0',
    config: { wide_screen_mode: true },
    body: {
      elements: [{ tag: 'markdown', content: text }]
    }
  })
}

/**
 * Manages a streaming card session using Feishu's CardKit API.
 * Creates a card with streaming_mode, updates content incrementally, and closes when done.
 */
class FeishuStreamingSession {
  private cardId: string | null = null
  private elementId = 'streaming_content'
  private sequence = 0
  private lastUpdateTime = 0
  private updateQueue: Promise<void> = Promise.resolve()
  private readonly throttleMs = 150

  constructor(
    private readonly apiBase: string,
    private readonly tenantToken: string
  ) {}

  async create(): Promise<string | null> {
    try {
      const res = await fetch(`${this.apiBase}/cardkit/v1/cards`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tenantToken}`
        },
        body: JSON.stringify({
          type: 'card_json',
          data: JSON.stringify({
            schema: '2.0',
            config: { wide_screen_mode: true, streaming_mode: true },
            body: {
              elements: [{ tag: 'markdown', content: '...', element_id: this.elementId }]
            }
          })
        })
      })

      const json = (await res.json()) as { code?: number; data?: { card_id?: string } }
      if (json.code === 0 && json.data?.card_id) {
        this.cardId = json.data.card_id
        return this.cardId
      }
      logger.warn('Failed to create streaming card', { response: json })
      return null
    } catch (error) {
      logger.error('Error creating streaming card', {
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  getCardContent(): string {
    return JSON.stringify({ type: 'card', data: { card_id: this.cardId } })
  }

  async update(text: string): Promise<void> {
    if (!this.cardId) return

    // Throttle updates
    const now = Date.now()
    if (now - this.lastUpdateTime < this.throttleMs) {
      return
    }

    // Queue sequential updates
    this.updateQueue = this.updateQueue.then(async () => {
      this.lastUpdateTime = Date.now()
      this.sequence++
      try {
        await fetch(`${this.apiBase}/cardkit/v1/cards/${this.cardId}/elements/${this.elementId}/content`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.tenantToken}`
          },
          body: JSON.stringify({
            content: JSON.stringify({ tag: 'markdown', content: text }),
            sequence: this.sequence
          })
        })
      } catch {
        // Swallow update errors to avoid blocking the stream
      }
    })

    await this.updateQueue
  }

  async close(): Promise<void> {
    if (!this.cardId) return

    // Wait for pending updates to flush
    await this.updateQueue

    try {
      await fetch(`${this.apiBase}/cardkit/v1/cards/${this.cardId}/settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.tenantToken}`
        },
        body: JSON.stringify({ settings: { streaming_mode: false } })
      })
    } catch (error) {
      logger.warn('Error closing streaming card', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

class FeishuAdapter extends ChannelAdapter {
  private client: Lark.Client | null = null
  private wsClient: Lark.WSClient | null = null
  private readonly appId: string
  private readonly appSecret: string
  private readonly allowedChatIds: string[]
  private readonly domain: FeishuDomain
  private tenantToken: string | null = null
  private tenantTokenExpiry = 0
  // Track active streaming sessions: draftId -> { session, chatId }
  private readonly streamingSessions = new Map<
    number,
    { session: FeishuStreamingSession; chatId: string; messageId?: string }
  >()

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { app_id, app_secret, allowed_chat_ids, domain } = config.channelConfig
    this.appId = (app_id as string) ?? ''
    this.appSecret = (app_secret as string) ?? ''
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.domain = ((domain as string) ?? 'feishu') as FeishuDomain
    this.notifyChatIds = [...this.allowedChatIds]
  }

  async connect(): Promise<void> {
    if (!this.appId || !this.appSecret) {
      throw new Error('Feishu app_id and app_secret are required')
    }

    const larkDomain = resolveDomain(this.domain)

    this.client = new Lark.Client({
      appId: this.appId,
      appSecret: this.appSecret,
      appType: Lark.AppType.SelfBuild,
      domain: larkDomain
    })

    const eventDispatcher = new Lark.EventDispatcher({}).register({
      'im.message.receive_v1': async (data: unknown) => {
        const event = data as FeishuMessageEvent
        this.handleMessageEvent(event)
      }
    })

    this.wsClient = new Lark.WSClient({
      appId: this.appId,
      appSecret: this.appSecret,
      domain: larkDomain,
      loggerLevel: Lark.LoggerLevel.warn
    })

    await this.wsClient.start({ eventDispatcher })

    logger.info('Feishu bot started (WebSocket)', { agentId: this.agentId, channelId: this.channelId })
  }

  async disconnect(): Promise<void> {
    // Clean up streaming sessions
    for (const [, entry] of this.streamingSessions) {
      await entry.session.close().catch(() => {})
    }
    this.streamingSessions.clear()

    // WSClient doesn't expose a stop method in all SDK versions.
    // Setting to null allows GC.
    this.wsClient = null
    this.client = null
    this.tenantToken = null
    logger.info('Feishu bot stopped', { agentId: this.agentId, channelId: this.channelId })
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Client is not connected')
    }

    const chunks = splitMessage(text)

    for (let i = 0; i < chunks.length; i++) {
      await this.client.im.message.create({
        params: { receive_id_type: 'chat_id' },
        data: {
          receive_id: chatId,
          msg_type: 'post',
          content: buildPostPayload(chunks[i])
        }
      })

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  async sendMessageDraft(chatId: string, draftId: number, text: string): Promise<void> {
    if (!this.client) {
      throw new Error('Client is not connected')
    }

    let entry = this.streamingSessions.get(draftId)

    // Create a new streaming card session on the first draft call
    if (!entry) {
      const token = await this.getTenantToken()
      if (!token) {
        // Fallback: no streaming support, skip drafts
        return
      }

      const apiBase = resolveApiBase(this.domain)
      const session = new FeishuStreamingSession(apiBase, token)
      const cardId = await session.create()
      if (!cardId) return

      // Send the card as an interactive message
      try {
        const res = await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'interactive',
            content: session.getCardContent()
          }
        })
        const messageId = (res as { data?: { message_id?: string } })?.data?.message_id
        entry = { session, chatId, messageId }
        this.streamingSessions.set(draftId, entry)
      } catch (error) {
        logger.warn('Failed to send streaming card message', {
          error: error instanceof Error ? error.message : String(error)
        })
        return
      }
    }

    // Update the streaming card with new content
    await entry.session.update(text)
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    // Feishu doesn't have a native typing indicator API.
    // The streaming card itself serves as a visual indicator.
    // No-op to satisfy the abstract interface.
  }

  /**
   * Finalize a streaming session: close the streaming card and optionally
   * update the message to a normal post for long-term readability.
   */
  async finalizeStream(draftId: number, finalText: string): Promise<void> {
    const entry = this.streamingSessions.get(draftId)
    if (!entry) return

    await entry.session.close()
    this.streamingSessions.delete(draftId)

    // Replace the interactive card message with a clean post message
    if (entry.messageId && this.client) {
      try {
        await this.client.im.message.update({
          path: { message_id: entry.messageId },
          data: {
            msg_type: 'interactive',
            content: buildMarkdownCard(finalText)
          }
        })
      } catch {
        // If update fails (e.g., message too old), that's acceptable
      }
    }
  }

  private handleMessageEvent(event: FeishuMessageEvent): void {
    const chatId = event.message.chat_id?.trim()
    if (!chatId) return

    // Auth guard
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(chatId)) {
      logger.debug('Dropping message from unauthorized chat', { chatId })
      return
    }

    // Only handle text messages
    if (event.message.message_type !== 'text') return

    let text: string
    try {
      const parsed = JSON.parse(event.message.content) as { text?: string }
      text = parsed.text ?? ''
    } catch {
      return
    }

    // Strip @mention tags (e.g., @_user_1 in group chats)
    text = text.replace(/@_user_\d+/g, '').trim()
    if (!text) return

    const userId = event.sender.sender_id.open_id ?? event.sender.sender_id.user_id ?? ''

    // Check for commands (Feishu doesn't have native bot commands, use text prefix)
    if (text.startsWith('/')) {
      const parts = text.split(/\s+/)
      const cmd = parts[0].slice(1).toLowerCase()
      if (cmd === 'new' || cmd === 'compact' || cmd === 'help') {
        this.emit('command', {
          chatId,
          userId,
          userName: '',
          command: cmd as 'new' | 'compact' | 'help',
          args: parts.slice(1).join(' ') || undefined
        })
        return
      }
    }

    this.emit('message', {
      chatId,
      userId,
      userName: '',
      text
    })
  }

  /**
   * Obtain (or refresh) the tenant_access_token needed for CardKit API calls.
   * Caches the token and refreshes 5 minutes before expiry.
   */
  private async getTenantToken(): Promise<string | null> {
    const now = Date.now()
    if (this.tenantToken && now < this.tenantTokenExpiry) {
      return this.tenantToken
    }

    try {
      const apiBase = resolveApiBase(this.domain)
      const res = await fetch(`${apiBase}/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret })
      })

      const json = (await res.json()) as {
        code?: number
        tenant_access_token?: string
        expire?: number
      }

      if (json.code === 0 && json.tenant_access_token) {
        this.tenantToken = json.tenant_access_token
        // Refresh 5 minutes before actual expiry
        this.tenantTokenExpiry = now + ((json.expire ?? 7200) - 300) * 1000
        return this.tenantToken
      }

      logger.warn('Failed to obtain tenant_access_token', { response: json })
      return null
    } catch (error) {
      logger.error('Error obtaining tenant_access_token', {
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }
}

// Self-registration
registerAdapterFactory('feishu', (channel: CherryClawChannel, agentId: string) => {
  return new FeishuAdapter({
    channelId: channel.id,
    agentId,
    channelConfig: channel.config
  })
})
