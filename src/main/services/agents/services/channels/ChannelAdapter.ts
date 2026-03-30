import { loggerService } from '@logger'
import { net } from 'electron'
import { EventEmitter } from 'events'

const logger = loggerService.withContext('ChannelAdapter')

/** Pre-downloaded, base64-encoded image ready for multimodal AI input. */
export type ImageAttachment = {
  data: string // base64-encoded image bytes
  media_type: string // e.g. 'image/png', 'image/jpeg', 'image/gif', 'image/webp'
}

/**
 * Download an image URL via Electron's net.fetch (respects system proxy) and
 * return base64-encoded data. Returns null on failure.
 */
export async function downloadImageAsBase64(url: string): Promise<ImageAttachment | null> {
  try {
    const response = await net.fetch(url)
    if (!response.ok) {
      logger.warn('Failed to download image', { url, status: response.status })
      return null
    }
    const contentType = response.headers.get('content-type') || 'image/png'
    const mediaType = contentType.split(';')[0].trim()
    const buffer = Buffer.from(await response.arrayBuffer())
    return { data: buffer.toString('base64'), media_type: mediaType }
  } catch (error) {
    logger.warn('Failed to fetch image', {
      url,
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}

export type ChannelMessageEvent = {
  chatId: string
  userId: string
  userName: string
  text: string
  /** Pre-downloaded base64 images attached to the message. */
  images?: ImageAttachment[]
}

export type ChannelCommandEvent = {
  chatId: string
  userId: string
  userName: string
  command: 'new' | 'compact' | 'help' | 'whoami'
  args?: string
}

export type SendMessageOptions = {
  parseMode?: 'MarkdownV2' | 'HTML'
  replyToMessageId?: number
}

export type ChannelAdapterConfig = {
  channelId: string
  channelType: string
  agentId: string
  channelConfig: Record<string, unknown>
}

/**
 * Base class for all channel adapters.
 *
 * Unified connect lifecycle:
 *   connect()
 *     ├─ checkReady() → true  → await performConnect(signal)    [blocking]
 *     └─ checkReady() → false → performConnect(signal) in background [non-blocking]
 *
 *   disconnect()
 *     ├─ aborts any in-progress performConnect via AbortSignal
 *     └─ calls performDisconnect()
 *
 * Subclasses implement three hooks:
 *   - checkReady()         — can we connect right now? (e.g. credentials cached)
 *   - performConnect(signal) — do the actual connection (login, QR flow, WebSocket, etc.)
 *   - performDisconnect()  — tear down connection resources
 */
export abstract class ChannelAdapter extends EventEmitter {
  readonly channelId: string
  readonly channelType: string
  readonly agentId: string
  /** Chat IDs that this adapter can send notifications to (set by subclass). */
  notifyChatIds: string[] = []

  private connectAbort: AbortController | null = null
  private _connected = false

  constructor(protected readonly config: ChannelAdapterConfig) {
    super()
    this.channelId = config.channelId
    this.channelType = config.channelType
    this.agentId = config.agentId
  }

  /** Whether the adapter has completed performConnect successfully and not since disconnected. */
  get connected(): boolean {
    return this._connected
  }

  /**
   * Mark the adapter as disconnected when the underlying connection drops unexpectedly.
   * Subclasses should call this from error handlers (e.g. WebSocket close, polling failure).
   */
  protected markDisconnected(): void {
    this._connected = false
  }

  /**
   * Mark the adapter as connected after a successful reconnection.
   * Subclasses with auto-reconnect logic should call this when the connection is re-established.
   */
  protected markConnected(): void {
    this._connected = true
  }

  /**
   * Connect the adapter. If checkReady() returns true, awaits performConnect.
   * Otherwise, runs performConnect in the background so connect() returns immediately.
   */
  async connect(): Promise<void> {
    this.connectAbort = new AbortController()
    const signal = this.connectAbort.signal

    const ready = await this.checkReady()
    if (ready) {
      await this.performConnect(signal)
      this._connected = true
    } else {
      // Background connect — fire and forget
      this.performConnect(signal)
        .then(() => {
          if (!signal.aborted) {
            this._connected = true
            logger.info('Background connect completed', {
              agentId: this.agentId,
              channelId: this.channelId,
              type: this.channelType
            })
          }
        })
        .catch((err) => {
          if (!signal.aborted) {
            logger.error('Background connect failed', {
              agentId: this.agentId,
              channelId: this.channelId,
              type: this.channelType,
              error: err instanceof Error ? err.message : String(err)
            })
          }
        })
    }
  }

  /**
   * Disconnect the adapter. Aborts any in-progress connect, then calls performDisconnect.
   */
  async disconnect(): Promise<void> {
    if (this.connectAbort) {
      this.connectAbort.abort()
      this.connectAbort = null
    }
    this._connected = false
    await this.performDisconnect()
  }

  /**
   * Check if the adapter has everything it needs to connect immediately.
   * Return true if credentials/config are available (e.g. cached token exists).
   * Return false to trigger background connect (e.g. needs QR scan).
   * Default: true (most adapters connect immediately or fail fast).
   */
  protected async checkReady(): Promise<boolean> {
    return true
  }

  /**
   * Perform the actual connection. May include login, QR scan, WebSocket setup, etc.
   * Must respect the AbortSignal — check signal.aborted periodically and abort early.
   */
  protected abstract performConnect(signal: AbortSignal): Promise<void>

  /**
   * Tear down the connection. Release resources, stop polling, close sockets.
   */
  protected abstract performDisconnect(): Promise<void>

  abstract sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void>
  /** Stream a partial/draft message to the chat. Same draftId updates the existing draft in-place. */
  abstract sendMessageDraft(chatId: string, draftId: number, text: string): Promise<void>
  abstract sendTypingIndicator(chatId: string): Promise<void>
  async finalizeStream(_draftId: number, _finalText: string): Promise<boolean> {
    void _draftId
    void _finalText
    return false
  }

  // Typed event emitter overrides
  override emit(event: 'message', data: ChannelMessageEvent): boolean
  override emit(event: 'command', data: ChannelCommandEvent): boolean
  override emit(event: 'qr', url: string): boolean
  override emit(event: 'credentials', data: { appId: string; appSecret: string }): boolean
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }

  override on(event: 'message', listener: (data: ChannelMessageEvent) => void): this
  override on(event: 'command', listener: (data: ChannelCommandEvent) => void): this
  override on(event: 'qr', listener: (url: string) => void): this
  override on(event: 'credentials', listener: (data: { appId: string; appSecret: string }) => void): this
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }
}
