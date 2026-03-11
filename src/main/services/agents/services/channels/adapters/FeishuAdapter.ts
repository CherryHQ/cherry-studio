import * as Lark from '@larksuiteoapi/node-sdk'
import { loggerService } from '@logger'
import type { CherryClawChannel, FeishuDomain } from '@types'
import { net } from 'electron'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../ChannelAdapter'
import { registerAdapterFactory } from '../ChannelManager'

const logger = loggerService.withContext('FeishuAdapter')

const FEISHU_MAX_LENGTH = 4000

type FeishuApiResponse<T = unknown> = {
  code?: number
  msg?: string
  message?: string
  data?: T
}

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

/**
 * A lightweight HttpInstance adapter that routes requests through Electron's net.fetch,
 * which respects system proxy settings. This ensures the Lark SDK works behind
 * corporate proxies where raw Node.js fetch/axios would fail.
 */
function createElectronHttpInstance(): Lark.HttpInstance {
  async function doRequest(method: string, url: string, data?: unknown, opts?: Record<string, any>): Promise<any> {
    const headers: Record<string, string> = { ...opts?.headers }
    let body: string | FormData | undefined

    if (data !== undefined && data !== null) {
      if (typeof data === 'string') {
        body = data
      } else if (data instanceof FormData) {
        body = data
      } else {
        body = JSON.stringify(data)
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json'
        }
      }
    }

    const fetchUrl = new URL(url)
    if (opts?.params) {
      for (const [key, value] of Object.entries(opts.params)) {
        fetchUrl.searchParams.set(key, String(value))
      }
    }

    const res = await net.fetch(fetchUrl.toString(), {
      method: method.toUpperCase(),
      headers,
      body
    })

    const isStream = opts?.responseType === 'stream'
    const responseData = isStream
      ? res.body
      : await res.text().then((text) => {
          if (!text) {
            return ''
          }

          try {
            return JSON.parse(text) as unknown
          } catch {
            return text
          }
        })
    const responseHeaders = Object.fromEntries(res.headers.entries())

    if (!res.ok) {
      const detail =
        typeof responseData === 'string'
          ? responseData
          : (responseData as { msg?: string; message?: string } | null)?.msg ||
            (responseData as { msg?: string; message?: string } | null)?.message ||
            res.statusText
      const error = new Error(`Feishu HTTP ${res.status}: ${detail}`)
      ;(error as Error & { response?: unknown }).response = {
        data: responseData,
        headers: responseHeaders,
        status: res.status,
        statusText: res.statusText
      }
      throw error
    }

    if (opts?.$return_headers) {
      return {
        data: responseData,
        headers: responseHeaders
      }
    }

    return responseData
  }

  return {
    request: (opts: any) => doRequest(opts.method || 'GET', opts.url, opts.data, opts),
    get: (url: string, opts?: any) => doRequest('GET', url, undefined, opts),
    delete: (url: string, opts?: any) => doRequest('DELETE', url, undefined, opts),
    head: (url: string, opts?: any) => doRequest('HEAD', url, undefined, opts),
    options: (url: string, opts?: any) => doRequest('OPTIONS', url, undefined, opts),
    post: (url: string, data?: any, opts?: any) => doRequest('POST', url, data, opts),
    put: (url: string, data?: any, opts?: any) => doRequest('PUT', url, data, opts),
    patch: (url: string, data?: any, opts?: any) => doRequest('PATCH', url, data, opts)
  } as Lark.HttpInstance
}

function unwrapFeishuResponse<T>(response: unknown): FeishuApiResponse<T> {
  if (response && typeof response === 'object' && 'code' in response) {
    return response as FeishuApiResponse<T>
  }

  if (
    response &&
    typeof response === 'object' &&
    'data' in response &&
    response.data &&
    typeof response.data === 'object' &&
    'code' in response.data
  ) {
    return response.data as FeishuApiResponse<T>
  }

  return { code: -1, msg: 'Unexpected Feishu API response' }
}

function ensureFeishuSuccess<T>(response: unknown, action: string): FeishuApiResponse<T> {
  const unwrapped = unwrapFeishuResponse<T>(response)
  if (unwrapped.code === 0) {
    return unwrapped
  }

  throw new Error(`${action} failed: ${unwrapped.msg || unwrapped.message || `code=${String(unwrapped.code)}`}`)
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

const STREAMING_ELEMENT_ID = 'streaming_content'

/**
 * Manages a streaming card session using the Lark SDK's CardKit API.
 * Creates a card with streaming_mode, updates content incrementally, and closes when done.
 */
class FeishuStreamingSession {
  private cardId: string | null = null
  private sequence = 0
  private lastUpdateTime = 0
  private updateQueue: Promise<void> = Promise.resolve()
  private readonly throttleMs = 150

  constructor(private readonly client: Lark.Client) {}

  async create(): Promise<string | null> {
    try {
      const res = ensureFeishuSuccess<{ card_id?: string }>(
        await this.client.cardkit.v1.card.create({
          data: {
            type: 'card_json',
            data: JSON.stringify({
              schema: '2.0',
              config: { wide_screen_mode: true, streaming_mode: true },
              body: {
                elements: [{ tag: 'markdown', content: '...', element_id: STREAMING_ELEMENT_ID }]
              }
            })
          }
        }),
        'Create streaming card'
      )

      if (res.data?.card_id) {
        this.cardId = res.data.card_id
        return this.cardId
      }

      logger.warn('Failed to create streaming card', { code: res.code, msg: res.msg })
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

    const now = Date.now()
    if (now - this.lastUpdateTime < this.throttleMs) {
      return
    }

    this.updateQueue = this.updateQueue.then(async () => {
      this.lastUpdateTime = Date.now()
      this.sequence++
      try {
        ensureFeishuSuccess(
          await this.client.cardkit.v1.cardElement.content({
            path: { card_id: this.cardId!, element_id: STREAMING_ELEMENT_ID },
            data: {
              content: JSON.stringify({ tag: 'markdown', content: text }),
              sequence: this.sequence
            }
          }),
          'Update streaming card'
        )
      } catch {
        // Swallow update errors to avoid blocking the stream
      }
    })

    await this.updateQueue
  }

  async close(): Promise<void> {
    if (!this.cardId) return

    await this.updateQueue

    try {
      this.sequence++
      ensureFeishuSuccess(
        await this.client.cardkit.v1.card.settings({
          path: { card_id: this.cardId },
          data: {
            settings: JSON.stringify({ streaming_mode: false }),
            sequence: this.sequence
          }
        }),
        'Close streaming card'
      )
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
  private readonly encryptKey: string
  private readonly verificationToken: string
  private readonly allowedChatIds: string[]
  private readonly domain: FeishuDomain
  // Track active streaming sessions: draftId -> { session, chatId, messageId }
  private readonly streamingSessions = new Map<
    number,
    { session: FeishuStreamingSession; chatId: string; messageId?: string }
  >()

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { app_id, app_secret, encrypt_key, verification_token, allowed_chat_ids, domain } = config.channelConfig
    this.appId = (app_id as string) ?? ''
    this.appSecret = (app_secret as string) ?? ''
    this.encryptKey = (encrypt_key as string) ?? ''
    this.verificationToken = (verification_token as string) ?? ''
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
      domain: larkDomain,
      httpInstance: createElectronHttpInstance()
    })

    const eventDispatcher = new Lark.EventDispatcher({
      encryptKey: this.encryptKey || undefined,
      verificationToken: this.verificationToken || undefined
    }).register({
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
    for (const [, entry] of this.streamingSessions) {
      await entry.session.close().catch(() => {})
    }
    this.streamingSessions.clear()

    this.wsClient = null
    this.client = null
    logger.info('Feishu bot stopped', { agentId: this.agentId, channelId: this.channelId })
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Client is not connected')
    }
    void _opts

    const chunks = splitMessage(text)

    for (let i = 0; i < chunks.length; i++) {
      ensureFeishuSuccess(
        await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: chatId,
            msg_type: 'post',
            content: buildPostPayload(chunks[i])
          }
        }),
        'Send Feishu message'
      )

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

    if (!entry) {
      const session = new FeishuStreamingSession(this.client)
      const cardId = await session.create()
      if (!cardId) return

      try {
        const res = ensureFeishuSuccess<{ message_id?: string }>(
          await this.client.im.message.create({
            params: { receive_id_type: 'chat_id' },
            data: {
              receive_id: chatId,
              msg_type: 'interactive',
              content: session.getCardContent()
            }
          }),
          'Send streaming card message'
        )
        const messageId = res.data?.message_id
        entry = { session, chatId, messageId }
        this.streamingSessions.set(draftId, entry)
      } catch (error) {
        logger.warn('Failed to send streaming card message', {
          error: error instanceof Error ? error.message : String(error)
        })
        return
      }
    }

    await entry.session.update(text)
  }

  async sendTypingIndicator(_chatId: string): Promise<void> {
    void _chatId
    // Feishu doesn't have a native typing indicator API.
    // The streaming card itself serves as a visual indicator.
  }

  /**
   * Finalize a streaming session: close the streaming card and optionally
   * update the message to a static markdown card for long-term readability.
   */
  override async finalizeStream(draftId: number, finalText: string): Promise<boolean> {
    const entry = this.streamingSessions.get(draftId)
    if (!entry) return false

    await entry.session.close()
    this.streamingSessions.delete(draftId)

    if (entry.messageId && this.client) {
      try {
        ensureFeishuSuccess(
          await this.client.im.message.update({
            path: { message_id: entry.messageId },
            data: {
              msg_type: 'interactive',
              content: buildMarkdownCard(finalText)
            }
          }),
          'Finalize Feishu streaming card'
        )
        return true
      } catch (error) {
        logger.warn('Failed to finalize streaming card', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return false
  }

  private handleMessageEvent(event: FeishuMessageEvent): void {
    const chatId = event.message.chat_id?.trim()
    if (!chatId) return

    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(chatId)) {
      logger.debug('Dropping message from unauthorized chat', { chatId })
      return
    }

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
      if (cmd === 'new' || cmd === 'compact' || cmd === 'help' || cmd === 'whoami') {
        this.emit('command', {
          chatId,
          userId,
          userName: '',
          command: cmd as 'new' | 'compact' | 'help' | 'whoami',
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
}

// Self-registration
registerAdapterFactory('feishu', (channel: CherryClawChannel, agentId: string) => {
  return new FeishuAdapter({
    channelId: channel.id,
    agentId,
    channelConfig: channel.config
  })
})
