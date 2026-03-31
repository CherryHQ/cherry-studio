import { loggerService } from '@logger'
import type { ChannelLogEntry, ChannelLogLevel, ChannelStatusEvent } from '@shared/config/types'
import { net } from 'electron'
import { EventEmitter } from 'events'

const logger = loggerService.withContext('ChannelAdapter')

/** Pre-downloaded, base64-encoded image ready for multimodal AI input. */
export type ImageAttachment = {
  data: string // base64-encoded image bytes
  media_type: string // e.g. 'image/png', 'image/jpeg', 'image/gif', 'image/webp'
}

/** Pre-downloaded, base64-encoded file attachment from an IM channel. */
export type FileAttachment = {
  filename: string // original filename, e.g. 'report.pdf'
  data: string // base64-encoded file bytes
  media_type: string // MIME type, e.g. 'application/pdf', 'text/plain'
  size: number // raw byte size (before base64 encoding)
}

/** Maximum file size we'll download from IM channels (20 MB). */
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024

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

/**
 * Download a file URL via Electron's net.fetch and return base64-encoded data.
 * Enforces MAX_FILE_SIZE_BYTES. Returns null on failure or if the file is too large.
 */
export async function downloadFileAsBase64(url: string, filename: string): Promise<FileAttachment | null> {
  try {
    const response = await net.fetch(url)
    if (!response.ok) {
      logger.warn('Failed to download file', { url, filename, status: response.status })
      return null
    }

    const contentLength = response.headers.get('content-length')
    if (contentLength && parseInt(contentLength, 10) > MAX_FILE_SIZE_BYTES) {
      logger.warn('File too large, skipping download', { filename, size: contentLength })
      return null
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn('File too large after download', { filename, size: buffer.length })
      return null
    }

    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    const mediaType = contentType.split(';')[0].trim()

    return {
      filename,
      data: buffer.toString('base64'),
      media_type: mediaType,
      size: buffer.length
    }
  } catch (error) {
    logger.warn('Failed to fetch file', {
      url,
      filename,
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
  /** Pre-downloaded base64 files attached to the message. */
  files?: FileAttachment[]
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
  /**
   * Chat IDs that this adapter can send notifications/task results to.
   * Initialized from allowed_chat_ids config + DB activeChatIds.
   */
  notifyChatIds: string[] = []

  private connectAbort: AbortController | null = null
  private _connected = false

  /**
   * Dual-destination logger: writes to the file logger AND emits to the UI log panel.
   * Subclasses should use `this.log.*` instead of a module-level `logger.*` so that
   * gateway-level details are visible in the channel log modal.
   */
  protected readonly log: Record<ChannelLogLevel, (message: string, meta?: Record<string, unknown>) => void>

  constructor(protected readonly config: ChannelAdapterConfig) {
    super()
    this.channelId = config.channelId
    this.channelType = config.channelType
    this.agentId = config.agentId

    const fileLogger = loggerService.withContext(`Channel:${config.channelType}`)
    const baseMeta = { agentId: config.agentId, channelId: config.channelId }

    this.log = (['debug', 'info', 'warn', 'error'] as const).reduce(
      (acc, level) => {
        acc[level] = (message: string, meta?: Record<string, unknown>) => {
          fileLogger[level](message, { ...baseMeta, ...meta })
          // Append error detail from meta so the UI log shows the reason
          const errorDetail = meta?.error ? `: ${typeof meta.error === 'string' ? meta.error : String(meta.error)}` : ''
          this.emitLog(level, `${message}${errorDetail}`)
        }
        return acc
      },
      {} as Record<ChannelLogLevel, (message: string, meta?: Record<string, unknown>) => void>
    )
  }

  /** Whether the adapter has completed performConnect successfully and not since disconnected. */
  get connected(): boolean {
    return this._connected
  }

  /**
   * Mark the adapter as disconnected when the underlying connection drops unexpectedly.
   * Subclasses should call this from error handlers (e.g. WebSocket close, polling failure).
   */
  protected markDisconnected(error?: string): void {
    this._connected = false
    this.emitStatusChange(false, error)
  }

  /**
   * Mark the adapter as connected after a successful reconnection.
   * Subclasses with auto-reconnect logic should call this when the connection is re-established.
   */
  protected markConnected(): void {
    this._connected = true
    this.emitStatusChange(true)
  }

  /** Emit a log event for this channel. */
  protected emitLog(level: ChannelLogLevel, message: string): void {
    this.emit('log', { timestamp: Date.now(), level, message, channelId: this.channelId })
  }

  private emitStatusChange(connected: boolean, error?: string): void {
    const event: ChannelStatusEvent = { channelId: this.channelId, connected }
    if (error) event.error = error
    this.emit('statusChange', event)
  }

  /**
   * Connect the adapter. If checkReady() returns true, awaits performConnect.
   * Otherwise, runs performConnect in the background so connect() returns immediately.
   *
   * The base class does NOT set connected state. Subclasses must call
   * markConnected() / markDisconnected() themselves.
   */
  async connect(): Promise<void> {
    this.connectAbort = new AbortController()
    const signal = this.connectAbort.signal

    const ready = await this.checkReady()
    if (ready) {
      await this.performConnect(signal)
    } else {
      this.performConnect(signal).catch((err) => {
        if (!signal.aborted) {
          this.markDisconnected(err instanceof Error ? err.message : String(err))
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
  abstract sendTypingIndicator(chatId: string): Promise<void>

  /**
   * Called on every text update during streaming. The adapter decides
   * internally when/how to flush to the platform (throttle, mutex, etc.).
   * @param fullText - The full cumulative response text so far.
   */
  // oxlint-disable-next-line no-unused-vars
  async onTextUpdate(_chatId: string, _fullText: string): Promise<void> {
    // Default no-op — adapters that support streaming should override.
  }

  /**
   * Called when the stream is complete. The adapter should finalize the
   * streaming UI (close streaming card, send final message, etc.).
   * @returns true if the adapter handled the final delivery (e.g. updated the card).
   *          false means the caller should fall back to sendMessage().
   */
  // oxlint-disable-next-line no-unused-vars
  async onStreamComplete(_chatId: string, _finalText: string): Promise<boolean> {
    return false
  }

  /**
   * Called when the stream errors out. The adapter can update the streaming
   * UI to show an error state.
   */
  // oxlint-disable-next-line no-unused-vars
  async onStreamError(_chatId: string, _error: string): Promise<void> {
    // Default no-op.
  }

  // Typed event emitter overrides
  override emit(event: 'message', data: ChannelMessageEvent): boolean
  override emit(event: 'command', data: ChannelCommandEvent): boolean
  override emit(event: 'qr', url: string): boolean
  override emit(event: 'credentials', data: { appId: string; appSecret: string }): boolean
  override emit(event: 'log', data: ChannelLogEntry): boolean
  override emit(event: 'statusChange', data: ChannelStatusEvent): boolean
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }

  override on(event: 'message', listener: (data: ChannelMessageEvent) => void): this
  override on(event: 'command', listener: (data: ChannelCommandEvent) => void): this
  override on(event: 'qr', listener: (url: string) => void): this
  override on(event: 'credentials', listener: (data: { appId: string; appSecret: string }) => void): this
  override on(event: 'log', listener: (data: ChannelLogEntry) => void): this
  override on(event: 'statusChange', listener: (data: ChannelStatusEvent) => void): this
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }
}
