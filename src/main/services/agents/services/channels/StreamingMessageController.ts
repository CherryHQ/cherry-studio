import { FlushController } from './FlushController'
import { splitMessage } from './utils'

/**
 * Per-platform bindings for posting and editing messages.
 *
 * The controller is API-agnostic — adapters supply how to talk to their
 * platform (Discord REST, Slack web API, etc.) and what content transform
 * to apply (e.g., Slack mrkdwn conversion) before splitting.
 */
export interface StreamingTransport<MessageId = string> {
  /** Post a new message with the given content. Return its id, or null if the post failed. */
  post(content: string): Promise<MessageId | null>
  /** Edit an existing message in place. */
  edit(messageId: MessageId, content: string): Promise<void>
  /** Optional content transform applied before chunking (e.g., markdown dialect conversion). */
  transformContent?(text: string): string
}

export interface StreamingMessageControllerOptions {
  /** Per-message character limit (e.g., Discord 2000, Slack 4000). */
  maxLength: number
  /** Minimum interval between flushes in ms — must respect platform rate limits. */
  throttleMs: number
}

/**
 * Minimal logger shape this controller needs. The adapter-level
 * `Record<ChannelLogLevel, ...>` log object satisfies this structurally.
 */
export interface StreamingControllerLogger {
  warn: (message: string, meta?: Record<string, unknown>) => void
}

const FALLBACK_PLACEHOLDER = '...'

/**
 * Manages a streaming response that may span multiple platform messages.
 *
 * Behavior:
 * - The first message is created lazily on first text update.
 * - On every flush, `splitMessage` recomputes the chunks. Earlier chunks
 *   are stable once a later chunk exists (they're sealed at safe boundaries),
 *   so only the latest growing chunk receives throttled edits.
 * - When a new chunk arrives, the previously-latest message is edited one
 *   last time with its now-sealed content, then the new chunk is posted as
 *   a follow-up message.
 */
export class StreamingMessageController<MessageId = string> {
  private readonly messageIds: MessageId[] = []
  private currentText = ''
  private readonly flush: FlushController
  private messageCreationPromise: Promise<void> | null = null
  private _completed = false

  constructor(
    private readonly transport: StreamingTransport<MessageId>,
    private readonly options: StreamingMessageControllerOptions,
    private readonly log: StreamingControllerLogger
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
    if (this.messageIds.length > 0) {
      await this.flush.throttledUpdate(this.options.throttleMs)
    }
  }

  async complete(finalText: string): Promise<boolean> {
    if (this._completed) return false
    this._completed = true
    this.flush.complete()

    if (this.messageCreationPromise) await this.messageCreationPromise
    if (this.messageIds.length === 0) return false

    await this.flush.waitForFlush()

    try {
      this.currentText = finalText
      await this.flushAllChunks()
      return true
    } catch (error) {
      this.log.warn('Failed to finalize streaming message', {
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
    if (this.messageIds.length === 0) return

    await this.flush.waitForFlush()

    try {
      const appendix = `\n\n---\n**Error**: ${errorMessage}`
      this.currentText = this.currentText ? `${this.currentText}${appendix}` : `**Error**: ${errorMessage}`
      await this.flushAllChunks()
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
    if (this.messageIds.length > 0) return
    if (this.messageCreationPromise) {
      await this.messageCreationPromise
      return
    }
    this.messageCreationPromise = this.createInitialMessage()
    await this.messageCreationPromise
  }

  private async createInitialMessage(): Promise<void> {
    try {
      const transformed = this.applyTransform(this.currentText)
      const initial =
        transformed.length > 0
          ? splitMessage(transformed, this.options.maxLength)[0] || FALLBACK_PLACEHOLDER
          : FALLBACK_PLACEHOLDER
      const id = await this.transport.post(initial)
      if (id !== null && id !== undefined) this.messageIds.push(id)
    } catch (error) {
      this.log.warn('Failed to create initial streaming message', {
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async performFlush(): Promise<void> {
    if (this.messageIds.length === 0) return
    try {
      await this.flushAllChunks()
    } catch {
      // Swallow flush errors — FlushController will reflush if needed
    }
  }

  /**
   * Re-split the current text and reconcile against previously-posted messages.
   *
   * - Sealed earlier chunks (i < messageIds.length - 1, i < chunks.length - 1) are skipped.
   * - The previously-latest chunk gets one final edit when a new chunk arrives,
   *   capturing its now-sealed content.
   * - The currently-latest chunk gets edited every flush (it's still growing).
   * - Any chunk index ≥ messageIds.length is posted as a new follow-up message.
   */
  private async flushAllChunks(): Promise<void> {
    const transformed = this.applyTransform(this.currentText)
    const chunks = splitMessage(transformed, this.options.maxLength)

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i] || FALLBACK_PLACEHOLDER
      if (i < this.messageIds.length) {
        const isCurrentLatestChunk = i === chunks.length - 1
        const isPreviousLatestMessage = i === this.messageIds.length - 1
        if (isCurrentLatestChunk || isPreviousLatestMessage) {
          await this.transport.edit(this.messageIds[i], content)
        }
      } else {
        const id = await this.transport.post(content)
        if (id === null || id === undefined) return
        this.messageIds.push(id)
      }
    }
  }

  private applyTransform(text: string): string {
    return this.transport.transformContent ? this.transport.transformContent(text) : text
  }
}
