import { type ApiCallFn, Bot, InputFile, type Transformer } from 'grammy'
import { convert as toMarkdownV2 } from 'telegram-markdown-v2'

import { t } from '@main/i18n'
import {
  downloadFileAsBase64,
  downloadImageAsBase64,
  type FileAttachment,
  type ImageAttachment,
  MAX_FILE_SIZE_BYTES
} from '@main/utils/downloadAsBase64'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../../ChannelAdapter'
import { splitMessage } from '../../utils'

const TELEGRAM_MAX_LENGTH = 4096
const TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 30
const TELEGRAM_GET_UPDATES_TIMEOUT_MS = 45_000
type GrammyAbortSignal = NonNullable<Parameters<ApiCallFn>[2]>
/**
 * Plain-text chunk budget under MarkdownV2. Escaping only grows length, so this
 * headroom keeps normal prose within Telegram's 4096-character limit. A chunk
 * whose escaped form still exceeds that limit is sent as plain text instead.
 */
const TELEGRAM_MARKDOWN_CHUNK_BUDGET = 3200

/** Backoff gaps after transient network send failures (initial attempt + these retries). */
const TELEGRAM_SEND_RETRY_DELAYS_MS = [5_000, 15_000, 60_000] as const

const TRANSIENT_NETWORK_MARKERS = [
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ECONNREFUSED',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_CLOSED',
  'ERR_CONNECTION_ABORTED',
  'ERR_CONNECTION_REFUSED',
  'ERR_NAME_NOT_RESOLVED',
  'ERR_TIMED_OUT',
  'socket hang up'
] as const

function isMarkdownParseError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'error_code' in error && 'description' in error) {
    const grammy = error
    if (
      grammy.error_code === 400 &&
      typeof grammy.description === 'string' &&
      /parse|entities|markdown/i.test(grammy.description)
    ) {
      return true
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return /can'?t parse|parse entities|Bad Request.*markdown/i.test(message)
}

/** Telegram rejects an over-4096 payload with 400 "message is too long", which is not a parse error. */
function isTelegramMessageTooLong(error: unknown): boolean {
  if (error && typeof error === 'object' && 'error_code' in error && 'description' in error) {
    const grammy = error
    if (
      grammy.error_code === 400 &&
      typeof grammy.description === 'string' &&
      /message is too long/i.test(grammy.description)
    ) {
      return true
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  return /message is too long/i.test(message)
}

function isTransientNetworkError(error: unknown): boolean {
  if (error && typeof error === 'object' && (error as { name?: string }).name === 'HttpError') {
    return true
  }
  const visit = (err: unknown, depth: number): boolean => {
    if (!err || depth > 4) return false
    if (typeof err === 'string') {
      return TRANSIENT_NETWORK_MARKERS.some((marker) => err.includes(marker))
    }
    if (typeof err !== 'object') return false
    const record = err as Record<string, unknown>
    if (typeof record.code === 'string' && TRANSIENT_NETWORK_MARKERS.some((marker) => marker === record.code)) {
      return true
    }
    const message = record.message
    if (typeof message === 'string' && TRANSIENT_NETWORK_MARKERS.some((marker) => message.includes(marker))) {
      return true
    }
    if (record.error !== undefined && visit(record.error, depth + 1)) return true
    if (record.cause !== undefined && visit(record.cause, depth + 1)) return true
    return false
  }
  return visit(error, 0)
}

const withGetUpdatesTimeout: Transformer = async (prev, method, payload, signal) => {
  if (method !== 'getUpdates') return prev(method, payload, signal)

  const controller = new AbortController()
  const abort = () => controller.abort((signal as unknown as { reason?: unknown } | undefined)?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(() => controller.abort(), TELEGRAM_GET_UPDATES_TIMEOUT_MS)

  try {
    return await prev(method, payload, controller.signal as unknown as GrammyAbortSignal)
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

class TelegramAdapter extends ChannelAdapter {
  private bot: Bot | null = null
  private pollingBot: Bot | null = null
  private pollingPromise: Promise<void> | null = null
  private readonly botToken: string
  private readonly allowedChatIds: string[]

  // Long-polling reconnect with backoff. grammY rethrows fatal polling errors (401/409) out of
  // `bot.start()`; without this a recoverable 409/Conflict left the bot permanently down.
  // Mirrors the WebSocket adapters (Slack/Discord/QQ).
  private shouldStop = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null
  private resumePromise: Promise<void> | null = null
  private deliveryAbort: AbortController | null = null
  private pollingGeneration = 0
  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000, 60000]
  private readonly maxReconnectAttempts = 50
  // Long polling has no "ready" event (a fatal 409 surfaces *after* `markConnected`), so
  // resetting the backoff budget on connect would let a persistent failure loop forever and
  // never hit the cap. Instead reset only after the bot has polled cleanly for this window —
  // so transient failures spread over the adapter's lifetime don't monotonically exhaust it.
  private readonly stabilityResetMs = 60_000

  constructor(config: ChannelAdapterConfig<'telegram'>) {
    super(config)
    const { bot_token, allowed_chat_ids } = config.channelConfig
    this.botToken = bot_token
    this.allowedChatIds = allowed_chat_ids ?? []
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!this.botToken
  }

  protected override async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.botToken) {
      throw new Error('Telegram bot token is required')
    }
    this.shouldStop = false
    this.reconnectAttempts = 0
    this.deliveryAbort?.abort()
    this.deliveryAbort = new AbortController()
    await this.startBot()
  }

  private async startBot(existingBot?: Bot): Promise<void> {
    if (existingBot) {
      this.bot = existingBot
      this.startPolling(existingBot)
      return
    }

    const bot = new Bot(this.botToken)
    this.bot = bot
    bot.api.config.use(withGetUpdatesTimeout)

    // Auth middleware — must be first
    bot.use(async (ctx, next) => {
      const chatId = ctx.chat?.id?.toString()
      if (this.allowedChatIds.length > 0 && (!chatId || !this.allowedChatIds.includes(chatId))) {
        this.log.debug('Dropping message from unauthorized chat', { chatId })
        return
      }
      await next()
    })

    // Command handlers
    bot.command('new', (ctx) => {
      this.emit('command', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        command: 'new'
      })
    })

    bot.command('compact', (ctx) => {
      this.emit('command', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        command: 'compact'
      })
    })

    bot.command('help', (ctx) => {
      this.emit('command', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        command: 'help'
      })
    })

    bot.command('whoami', (ctx) => {
      this.emit('command', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        command: 'whoami'
      })
    })

    // Text message handler
    bot.on('message:text', (ctx) => {
      this.emit('message', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        text: ctx.message.text
      })
    })

    // Photo message handler — download the largest resolution and emit with caption
    bot.on('message:photo', async (ctx) => {
      const photos = ctx.message.photo
      if (!photos || photos.length === 0) return

      // Last element is the highest resolution
      const largest = photos[photos.length - 1]
      const images = await this.downloadTelegramFile(largest.file_id)
      const text = ctx.message.caption?.trim() ?? ''

      if (!text && images.length === 0) return

      this.emit('message', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        text,
        ...(images.length > 0 ? { images } : {})
      })
    })

    // Document/file handler — download and emit as file attachment
    bot.on('message:document', async (ctx) => {
      const doc = ctx.message.document
      if (!doc) return

      // Skip files that are too large
      if (doc.file_size && doc.file_size > MAX_FILE_SIZE_BYTES) {
        this.log.warn('Document too large, skipping', { filename: doc.file_name, size: doc.file_size })
        return
      }

      const files = await this.downloadTelegramDocument(doc.file_id, doc.file_name ?? 'document', doc.mime_type)
      const text = ctx.message.caption?.trim() ?? ''

      if (!text && files.length === 0) return

      this.emit('message', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        text,
        ...(files.length > 0 ? { files } : {})
      })
    })

    // Register bot commands with Telegram
    await bot.api.setMyCommands([
      { command: 'new', description: 'Start a new conversation' },
      { command: 'compact', description: 'Compact conversation history' },
      { command: 'help', description: 'Show help information' },
      { command: 'whoami', description: 'Show the current chat ID' }
    ])

    // Error handler — err is a BotError wrapping the original cause in err.error
    bot.catch((err) => {
      const cause = err.error
      const msg = cause instanceof Error ? cause.message : String(cause)
      this.log.error(`Bot error: ${msg}`)
    })

    this.startPolling(bot)
  }

  private startPolling(bot: Bot): void {
    const generation = ++this.pollingGeneration
    this.pollingBot = bot
    this.pollingPromise = bot
      .start({
        timeout: TELEGRAM_LONG_POLL_TIMEOUT_SECONDS,
        onStart: () => {
          if (this.shouldStop || this.bot !== bot || this.pollingBot !== bot || this.pollingGeneration !== generation)
            return
          this.markConnected()
          this.log.info('Telegram bot polling started')
          this.startStabilityTimer(bot, generation)
        }
      })
      .catch((err) => {
        if (this.shouldStop || this.bot !== bot || this.pollingBot !== bot || this.pollingGeneration !== generation)
          return
        this.pollingBot = null
        const msg = err instanceof Error ? err.message : String(err)
        this.clearStabilityTimer()
        this.markDisconnected(msg)
        this.log.error(`Polling stopped: ${msg}`)
        this.scheduleReconnect()
      })
  }

  private startStabilityTimer(bot: Bot, generation: number): void {
    this.clearStabilityTimer()
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null
      if (!this.shouldStop && this.bot === bot && this.pollingBot === bot && this.pollingGeneration === generation)
        this.reconnectAttempts = 0
    }, this.stabilityResetMs)
  }

  override handleSystemResume(): void {
    if (this.shouldStop || !this.pollingBot || this.resumePromise) return

    const bot = this.pollingBot
    const resume = this.restartPollingAfterResume(bot)
    this.resumePromise = resume
    void resume.finally(() => {
      if (this.resumePromise === resume) this.resumePromise = null
    })
  }

  private async restartPollingAfterResume(bot: Bot): Promise<void> {
    const polling = this.pollingPromise
    this.pollingGeneration++
    this.pollingBot = null
    this.clearReconnectTimer()
    this.clearStabilityTimer()
    this.markDisconnected('System resumed; restarting Telegram polling')
    try {
      await bot.stop()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      this.log.warn(`Failed to stop stale Telegram poll after system resume: ${msg}`)
    }
    // grammY stop() does not wait for middleware or the old polling loop to finish.
    await polling
    if (this.shouldStop || this.bot !== bot) return
    await this.startBot(bot)
  }

  private clearStabilityTimer(): void {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer)
      this.stabilityTimer = null
    }
  }

  private scheduleReconnect(): void {
    if (this.shouldStop || this.reconnectTimer) return

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log.error('Telegram max reconnect attempts reached, giving up')
      return
    }

    const delay = this.reconnectDelays[Math.min(this.reconnectAttempts, this.reconnectDelays.length - 1)]
    this.reconnectAttempts++
    this.log.info(`Telegram reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.shouldStop) return
      this.startBot().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err)
        this.markDisconnected(msg)
        this.log.error(`Telegram reconnect failed: ${msg}`)
        this.scheduleReconnect()
      })
    }, delay)
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  protected override async performDisconnect(): Promise<void> {
    this.shouldStop = true
    this.pollingGeneration++
    this.pollingBot = null
    this.clearReconnectTimer()
    this.clearStabilityTimer()
    const bot = this.bot
    this.bot = null
    this.deliveryAbort?.abort()
    this.deliveryAbort = null
    if (bot) {
      await bot.stop()
      this.log.info('Telegram bot stopped')
    }
  }

  private async downloadTelegramFile(fileId: string): Promise<ImageAttachment[]> {
    if (!this.bot) return []
    try {
      const file = await this.bot.api.getFile(fileId)
      if (!file.file_path) return []
      const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`
      const attachment = await downloadImageAsBase64(url)
      return attachment ? [attachment] : []
    } catch (error) {
      this.log.warn('Failed to download Telegram file', {
        fileId,
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  private async downloadTelegramDocument(
    fileId: string,
    filename: string,
    mimeType?: string
  ): Promise<FileAttachment[]> {
    if (!this.bot) return []
    try {
      const file = await this.bot.api.getFile(fileId)
      if (!file.file_path) return []
      const url = `https://api.telegram.org/file/bot${this.botToken}/${file.file_path}`
      const attachment = await downloadFileAsBase64(url, filename)
      if (!attachment) return []
      // Override media_type with Telegram's reported mime_type if available
      if (mimeType) attachment.media_type = mimeType
      return [attachment]
    } catch (error) {
      this.log.warn('Failed to download Telegram document', {
        fileId,
        filename,
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    const signal = this.deliveryAbort?.signal
    if (!signal) {
      throw new Error('Bot is not connected')
    }

    try {
      await this.deliverMessageChunks(signal, chatId, text, opts)
    } catch (error) {
      await this.notifyDeliveryFailure(signal, chatId)
      throw error
    }
  }

  private async deliverMessageChunks(
    signal: AbortSignal,
    chatId: string,
    text: string,
    opts?: SendMessageOptions
  ): Promise<void> {
    const parseMode = opts?.parseMode ?? 'MarkdownV2'
    const isMarkdown = parseMode === 'MarkdownV2'
    // Split the PLAIN text first and escape each chunk, so the MarkdownV2 send and
    // its plain-text fallback share one chunk boundary. (Splitting the *formatted*
    // text and then re-splitting the *raw* text by the same index misaligns — escaping
    // changes lengths/boundaries — dropping, duplicating, or passing `undefined` chunks.)
    const plainChunks = splitMessage(text, isMarkdown ? TELEGRAM_MARKDOWN_CHUNK_BUDGET : TELEGRAM_MAX_LENGTH)

    for (let i = 0; i < plainChunks.length; i++) {
      this.getDeliveryBot(signal)
      const plain = plainChunks[i]
      const formatted = isMarkdown ? toMarkdownV2(plain).trimEnd() : plain
      // Telegram message ids are numeric; a string replyToMessageId (QQ's msg_id) isn't ours.
      const replyParams =
        typeof opts?.replyToMessageId === 'number' && i === 0
          ? { reply_parameters: { message_id: opts.replyToMessageId } }
          : {}

      const sendPlainText = () =>
        this.sendWithNetworkRetry(signal, chatId, (bot) => bot.api.sendMessage(chatId, plain, replyParams))

      // Escaping can exceed 4096. That 400 is not a parse error, so send the plain chunk
      // instead of letting the rejection drop the message.
      if (isMarkdown && formatted.length > TELEGRAM_MAX_LENGTH) {
        this.log.warn('MarkdownV2 payload exceeds Telegram length limit, falling back to plain text', {
          chatId,
          length: formatted.length
        })
        await sendPlainText()
      } else {
        try {
          await this.sendWithNetworkRetry(signal, chatId, (bot) =>
            bot.api.sendMessage(chatId, formatted, {
              parse_mode: parseMode,
              ...replyParams
            })
          )
        } catch (error) {
          // Format downgrade is only for MarkdownV2 parse rejections and length
          // rejections — never for network errors.
          if (isMarkdown && (isMarkdownParseError(error) || isTelegramMessageTooLong(error))) {
            this.log.warn('MarkdownV2 send failed, falling back to plain text', {
              chatId,
              error: error instanceof Error ? error.message : String(error)
            })
            await sendPlainText()
          } else {
            throw error
          }
        }
      }

      // Small delay between chunks to avoid rate limiting
      if (i < plainChunks.length - 1) {
        await this.waitForDelivery(100, signal)
      }
    }
  }

  private async sendWithNetworkRetry(
    signal: AbortSignal,
    chatId: string,
    send: (bot: Bot) => Promise<unknown>
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await send(this.getDeliveryBot(signal))
        this.getDeliveryBot(signal)
        return
      } catch (error) {
        this.getDeliveryBot(signal)
        const delayMs = TELEGRAM_SEND_RETRY_DELAYS_MS[attempt]
        if (!isTransientNetworkError(error) || delayMs === undefined) throw error
        this.log.warn('Transient Telegram send failure, retrying', {
          chatId,
          attempt: attempt + 1,
          delayMs,
          error: error instanceof Error ? error.message : String(error)
        })
        await this.waitForDelivery(delayMs, signal)
      }
    }
  }

  private getDeliveryBot(signal: AbortSignal): Bot {
    if (signal.aborted) throw signal.reason ?? new Error('Telegram delivery cancelled')
    if (this.shouldStop || this.deliveryAbort?.signal !== signal || !this.bot) {
      throw new Error('Bot is not connected')
    }
    return this.bot
  }

  private waitForDelivery(delayMs: number, signal: AbortSignal): Promise<void> {
    this.getDeliveryBot(signal)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        try {
          this.getDeliveryBot(signal)
          resolve()
        } catch (error) {
          reject(error)
        }
      }, delayMs)
      function onAbort() {
        clearTimeout(timer)
        reject(signal.reason ?? new Error('Telegram delivery cancelled'))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async notifyDeliveryFailure(signal: AbortSignal, chatId: string): Promise<void> {
    let bot: Bot
    try {
      bot = this.getDeliveryBot(signal)
    } catch {
      return
    }
    try {
      // Plain text, single attempt — do not recurse through sendMessage / MarkdownV2.
      await bot.api.sendMessage(chatId, t('common.channel_message_dropped'))
    } catch (error) {
      this.log.debug('Failed to send Telegram delivery-failure notice', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  override async sendFile(chatId: string, file: FileAttachment): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }
    const buffer = Buffer.from(file.data, 'base64')
    await this.bot.api.sendDocument(chatId, new InputFile(buffer, file.filename))
    this.log.info('Sent file', { chatId, filename: file.filename, size: file.size })
  }

  override async onTextUpdate(chatId: string, fullText: string): Promise<void> {
    if (!this.bot) return
    // Telegram's sendMessageDraft edits the message in-place. The bot library
    // handles its own throttle internally.
    await this.bot.api.sendMessageDraft(Number(chatId), 0, fullText)
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    await this.bot.api.sendChatAction(chatId, 'typing')
  }
}

export function createTelegramAdapter(config: ChannelAdapterConfig<'telegram'>) {
  return new TelegramAdapter({
    ...config
  })
}
