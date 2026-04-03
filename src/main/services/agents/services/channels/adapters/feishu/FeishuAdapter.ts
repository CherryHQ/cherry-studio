import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import * as Lark from '@larksuiteoapi/node-sdk'
import type { FeishuDomain } from '@main/services/agents/database/schema'
import { windowService } from '@main/services/WindowService'
import { IpcChannel } from '@shared/IpcChannel'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  type FileAttachment,
  MAX_FILE_SIZE_BYTES,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand } from '../../constants'
import { FlushController } from '../../FlushController'
import { FILE_EXTENSION_MIME_MAP, splitMessage } from '../../utils'
import { registrationBegin, registrationPoll } from './FeishuAppRegistration'

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
 * A lightweight HttpInstance adapter for the Lark SDK using Node.js native fetch.
 * We use fetch instead of Electron's net.fetch because Lark SDK
 * sometimes sends GET requests with a body and non-ASCII header values,
 * both of which Electron's net.fetch rejects.
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

    const upperMethod = method.toUpperCase()

    // Use Node.js native fetch instead of Electron's net.fetch here because:
    // 1. net.fetch rejects GET requests with a body (Lark SDK sends payload on GET)
    // 2. net.fetch rejects header values with non-ASCII chars (Lark SDK sends Chinese filenames)
    const res = await fetch(fetchUrl.toString(), {
      method: upperMethod,
      headers,
      ...(upperMethod !== 'GET' && upperMethod !== 'HEAD' && body ? { body } : {})
    })

    const isStream = opts?.responseType === 'stream'
    const responseData = isStream
      ? res.body
        ? Readable.fromWeb(res.body as NodeReadableStream)
        : Readable.from([])
      : await res.text().then((text) => {
          if (!text) {
            return ''
          }

          try {
            return JSON.parse(text)
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

const STREAMING_ELEMENT_ID = 'streaming_content'

/** Throttle interval for CardKit streaming updates (ms). */
const CARDKIT_THROTTLE_MS = 200

/**
 * Manages the full lifecycle of a streaming CardKit card for one response.
 *
 * Uses FlushController for mutex-guarded, throttled flushing to the
 * CardKit API — no concurrent API calls, automatic reflush on conflict.
 *
 * Lifecycle: idle → created → streaming → completed/error
 */
class FeishuStreamingController {
  private cardId: string | null = null
  private messageId: string | null = null
  private sequence = 0
  private currentText = ''
  private readonly flush: FlushController
  private cardCreationPromise: Promise<void> | null = null
  private _completed = false

  constructor(
    private readonly client: Lark.Client,
    private readonly chatId: string,
    private readonly log: Record<string, (msg: string, meta?: Record<string, unknown>) => void>
  ) {
    this.flush = new FlushController(() => this.performFlush())
  }

  /** Whether this controller has finished (complete or error). */
  get completed(): boolean {
    return this._completed
  }

  /**
   * Update the text being streamed. The FlushController decides when to
   * actually call the CardKit API based on throttle and mutex.
   */
  async onText(text: string): Promise<void> {
    if (this._completed) return
    this.currentText = text
    await this.ensureCardCreated()
    if (this.cardId && this.messageId) {
      await this.flush.throttledUpdate(CARDKIT_THROTTLE_MS)
    }
  }

  /**
   * Finalize the streaming card: wait for pending flushes, close streaming
   * mode, and replace with a static markdown card.
   * @returns true if finalization succeeded.
   */
  async complete(finalText: string): Promise<boolean> {
    if (this._completed) return false
    this._completed = true
    this.flush.complete()

    // Wait for card creation if still in progress
    if (this.cardCreationPromise) await this.cardCreationPromise
    if (!this.cardId || !this.messageId) return false

    await this.flush.waitForFlush()

    try {
      // Close streaming mode
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

      // Replace with static markdown card
      this.sequence++
      ensureFeishuSuccess(
        await this.client.cardkit.v1.card.update({
          data: {
            card: {
              type: 'card_json',
              data: JSON.stringify({
                schema: '2.0',
                config: { wide_screen_mode: true },
                body: {
                  elements: [{ tag: 'markdown', content: finalText }]
                }
              })
            },
            sequence: this.sequence
          },
          path: { card_id: this.cardId }
        }),
        'Update final card'
      )

      return true
    } catch (error) {
      this.log.warn('Failed to finalize streaming card', {
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    }
  }

  /** Mark the streaming card as errored and close it. */
  async error(errorMessage: string): Promise<void> {
    if (this._completed) return
    this._completed = true
    this.flush.complete()

    if (this.cardCreationPromise) await this.cardCreationPromise
    if (!this.cardId || !this.messageId) return

    await this.flush.waitForFlush()

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
        'Close streaming card on error'
      )

      const displayText = this.currentText
        ? `${this.currentText}\n\n---\n**Error**: ${errorMessage}`
        : `**Error**: ${errorMessage}`

      this.sequence++
      ensureFeishuSuccess(
        await this.client.cardkit.v1.card.update({
          data: {
            card: {
              type: 'card_json',
              data: JSON.stringify({
                schema: '2.0',
                config: { wide_screen_mode: true },
                body: {
                  elements: [{ tag: 'markdown', content: displayText }]
                }
              })
            },
            sequence: this.sequence
          },
          path: { card_id: this.cardId }
        }),
        'Update error card'
      )
    } catch {
      // Best-effort error card update
    }
  }

  /** Abort and clean up without sending a final card. */
  dispose(): void {
    this._completed = true
    this.flush.cancelPendingFlush()
    this.flush.complete()
  }

  // ---- Internal ----

  private async ensureCardCreated(): Promise<void> {
    if (this.cardId) return
    if (this.cardCreationPromise) {
      await this.cardCreationPromise
      return
    }
    this.cardCreationPromise = this.createCard()
    await this.cardCreationPromise
  }

  private async createCard(): Promise<void> {
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

      if (!res.data?.card_id) {
        this.log.warn('Failed to create streaming card — no card_id returned')
        return
      }

      this.cardId = res.data.card_id

      // Send the card message to the chat
      const sendRes = ensureFeishuSuccess<{ message_id?: string }>(
        await this.client.im.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: this.chatId,
            msg_type: 'interactive',
            content: JSON.stringify({ type: 'card', data: { card_id: this.cardId } })
          }
        }),
        'Send streaming card message'
      )

      this.messageId = sendRes.data?.message_id ?? null
    } catch (error) {
      this.log.warn('Failed to create/send streaming card', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async performFlush(): Promise<void> {
    if (!this.cardId || !this.currentText) return

    this.sequence++
    try {
      ensureFeishuSuccess(
        await this.client.cardkit.v1.cardElement.content({
          path: { card_id: this.cardId, element_id: STREAMING_ELEMENT_ID },
          data: {
            content: this.currentText,
            sequence: this.sequence
          }
        }),
        'Stream card content'
      )
    } catch {
      // Swallow flush errors — FlushController will reflush if needed
    }
  }
}

class FeishuAdapter extends ChannelAdapter {
  private client: Lark.Client | null = null
  private wsClient: Lark.WSClient | null = null
  private appId: string
  private appSecret: string
  private readonly encryptKey: string
  private readonly verificationToken: string
  private readonly allowedChatIds: string[]
  private readonly domain: FeishuDomain
  private registrationAbort: AbortController | null = null
  /** Per-chat streaming controller. One stream at a time per chat. */
  private readonly streamingControllers = new Map<string, FeishuStreamingController>()

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

  protected override async checkReady(): Promise<boolean> {
    return !!(this.appId && this.appSecret)
  }

  protected override async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.appId || !this.appSecret) {
      // No credentials — start the QR registration flow in the background.
      // Return without connecting. The base class background branch will call
      // markConnected via .then(), but we override that below: checkReady()
      // returned false, so we explicitly mark as NOT connected. The adapter
      // will be recreated by syncAgent once credentials arrive.
      this.startRegistrationInBackground()
      return
    }

    await this.connectWebSocket()
  }

  private async connectWebSocket(): Promise<void> {
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
      loggerLevel: Lark.LoggerLevel.error
    })

    try {
      await this.wsClient.start({ eventDispatcher })
    } catch (error) {
      // Clean up so performDisconnect doesn't try to use a broken client
      this.wsClient = null
      throw new Error(`Feishu WebSocket connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    this.markConnected()
    this.log.info('Feishu bot started (WebSocket)')
  }

  /**
   * Start the Feishu App Registration Device Flow in the background.
   * Emits the QR URL immediately via 'qr' event and IPC, then polls
   * asynchronously.  Does NOT block the caller.
   */
  private startRegistrationInBackground(): void {
    this.log.info('Starting Feishu app registration flow (background)', {
      domain: this.domain
    })

    this.sendQrToRenderer('', 'pending')

    // Fire-and-forget — errors are logged, not thrown
    registrationBegin(this.domain)
      .then(({ deviceCode, verificationUri, interval, expiresIn }) => {
        // Emit QR URL for ChannelManager waiters and send to renderer
        this.emit('qr', verificationUri)
        this.sendQrToRenderer(verificationUri, 'pending')

        this.registrationAbort = new AbortController()

        return registrationPoll(this.domain, deviceCode, {
          interval,
          expiresIn,
          signal: this.registrationAbort.signal
        })
      })
      .then((result) => {
        this.appId = result.appId
        this.appSecret = result.appSecret
        this.registrationAbort = null

        this.sendQrToRenderer('', 'confirmed', result.appId, result.appSecret)
        this.emit('credentials', { appId: result.appId, appSecret: result.appSecret })
        this.log.info('Feishu app registration completed')
      })
      .catch((error) => {
        this.registrationAbort = null
        this.sendQrToRenderer('', 'expired')
        this.log.warn(`Registration failed: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  private sendQrToRenderer(
    url: string,
    status: 'pending' | 'confirmed' | 'expired' | 'disconnected',
    appId?: string,
    appSecret?: string
  ): void {
    const mainWindow = windowService.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.Feishu_QrLogin, {
        channelId: this.channelId,
        url,
        status,
        appId,
        appSecret
      })
    }
  }

  protected override async performDisconnect(): Promise<void> {
    if (this.registrationAbort) {
      this.registrationAbort.abort()
      this.registrationAbort = null
    }

    for (const [, controller] of this.streamingControllers) {
      controller.dispose()
    }
    this.streamingControllers.clear()

    if (this.wsClient) {
      this.wsClient.close()
      this.wsClient = null
    }
    this.client = null
    this.sendQrToRenderer('', 'disconnected')
    this.log.info('Feishu bot stopped')
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) {
      throw new Error('Client is not connected')
    }
    void _opts

    const chunks = splitMessage(text, FEISHU_MAX_LENGTH)

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

  async sendTypingIndicator(_chatId: string): Promise<void> {
    void _chatId
    // Feishu doesn't have a native typing indicator API.
    // The streaming card itself serves as a visual indicator.
  }

  override async onTextUpdate(chatId: string, fullText: string): Promise<void> {
    if (!this.client) return

    let controller = this.streamingControllers.get(chatId)
    if (!controller) {
      controller = new FeishuStreamingController(this.client, chatId, this.log)
      this.streamingControllers.set(chatId, controller)
    }

    await controller.onText(fullText)
  }

  override async onStreamComplete(chatId: string, finalText: string): Promise<boolean> {
    const controller = this.streamingControllers.get(chatId)
    if (!controller) return false

    this.streamingControllers.delete(chatId)
    return controller.complete(finalText)
  }

  override async onStreamError(chatId: string, error: string): Promise<void> {
    const controller = this.streamingControllers.get(chatId)
    if (!controller) return

    this.streamingControllers.delete(chatId)
    await controller.error(error)
  }

  private handleMessageEvent(event: FeishuMessageEvent): void {
    const chatId = event.message.chat_id?.trim()
    if (!chatId) return

    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(chatId)) {
      this.log.debug('Dropping message from unauthorized chat', { chatId })
      return
    }

    const messageType = event.message.message_type
    const userId = event.sender.sender_id.open_id ?? event.sender.sender_id.user_id ?? ''

    if (messageType === 'file') {
      this.handleFileMessage(event, chatId, userId)
      return
    }

    if (messageType !== 'text') return

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

    // Check for commands (Feishu doesn't have native bot commands, use text prefix)
    if (isSlashCommand(text)) {
      const parts = text.split(/\s+/)
      const cmd = parts[0].slice(1).toLowerCase() as 'new' | 'compact' | 'help' | 'whoami'
      this.emit('command', {
        chatId,
        userId,
        userName: '',
        command: cmd,
        args: parts.slice(1).join(' ') || undefined
      })
      return
    }

    this.emit('message', {
      chatId,
      userId,
      userName: '',
      text
    })
  }

  private handleFileMessage(event: FeishuMessageEvent, chatId: string, userId: string): void {
    let fileKey: string
    let fileName: string
    try {
      const parsed = JSON.parse(event.message.content) as { file_key?: string; file_name?: string }
      fileKey = parsed.file_key ?? ''
      fileName = parsed.file_name ?? 'file'
    } catch {
      return
    }
    if (!fileKey) return

    this.downloadFeishuFile(event.message.message_id, fileKey, fileName)
      .then((files) => {
        this.emit('message', {
          chatId,
          userId,
          userName: '',
          text: `[File: ${fileName}]`,
          ...(files.length > 0 ? { files } : {})
        })
      })
      .catch((error) => {
        this.log.warn('Failed to download Feishu file', {
          fileKey,
          error: error instanceof Error ? error.message : String(error)
        })
        // Emit text-only fallback
        this.emit('message', {
          chatId,
          userId,
          userName: '',
          text: `[File: ${fileName} — download failed]`
        })
      })
  }

  private async downloadFeishuFile(messageId: string, fileKey: string, fileName: string): Promise<FileAttachment[]> {
    if (!this.client) return []

    this.log.info('Downloading Feishu file', { messageId, fileKey, fileName })

    let resp: Awaited<ReturnType<typeof this.client.im.messageResource.get>>
    try {
      resp = await this.client.im.messageResource.get({
        params: { type: 'file' },
        path: { message_id: messageId, file_key: fileKey }
      })
    } catch (error) {
      this.log.error('Feishu messageResource.get failed', {
        messageId,
        fileKey,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      })
      throw error
    }

    const stream = resp.getReadableStream()
    const chunks: Buffer[] = []
    let totalSize = 0

    for await (const chunk of stream) {
      totalSize += chunk.length
      if (totalSize > MAX_FILE_SIZE_BYTES) {
        this.log.warn('Feishu file too large, aborting download', { fileName, size: totalSize })
        stream.destroy()
        return []
      }
      chunks.push(Buffer.from(chunk))
    }

    this.log.info('Feishu file downloaded', { fileName, totalSize })
    const buffer = Buffer.concat(chunks)
    const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
    const mediaType = FILE_EXTENSION_MIME_MAP[ext] || 'application/octet-stream'

    return [{ filename: fileName, data: buffer.toString('base64'), media_type: mediaType, size: buffer.length }]
  }
}

// Self-registration
registerAdapterFactory('feishu', (channel, agentId) => {
  return new FeishuAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
