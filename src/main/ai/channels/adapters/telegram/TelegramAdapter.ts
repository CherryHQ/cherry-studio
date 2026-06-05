import {
  downloadFileAsBase64,
  downloadImageAsBase64,
  type FileAttachment,
  type ImageAttachment,
  MAX_FILE_SIZE_BYTES
} from '@main/utils/downloadAsBase64'
import { Bot } from 'grammy'
import { convert as toMarkdownV2 } from 'telegram-markdown-v2'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'

const TELEGRAM_MAX_LENGTH = 4096
/**
 * Plain-text chunk budget under MarkdownV2. We split the *plain* text (so each
 * chunk has an index-aligned plain fallback) and then escape it; escaping only
 * grows length, so this headroom keeps the formatted chunk within the 4096 hard
 * limit for normal prose. A pathological all-special-char chunk could still
 * overflow — Telegram then rejects it and the catch sends the plain chunk, which
 * is always within budget.
 */
const TELEGRAM_MARKDOWN_CHUNK_BUDGET = 3200

import { splitMessage } from '../../utils'

class TelegramAdapter extends ChannelAdapter {
  private bot: Bot | null = null
  private readonly botToken: string
  private readonly allowedChatIds: string[]

  // Long-polling reconnect with backoff. grammY rethrows fatal polling errors (401/409) out of
  // `bot.start()`; without this a recoverable 409/Conflict left the bot permanently down.
  // Mirrors the WebSocket adapters (Slack/Discord/QQ).
  private shouldStop = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null
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
    await this.startBot()
  }

  private async startBot(): Promise<void> {
    const bot = new Bot(this.botToken)
    this.bot = bot

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

    // Start long polling (fire-and-forget). `bot.start()` only resolves when the bot stops;
    // a fatal polling error (e.g. 409 Conflict) rejects here — schedule a backoff reconnect.
    bot.start().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.clearStabilityTimer()
      this.markDisconnected(msg)
      this.log.error(`Polling stopped: ${msg}`)
      this.scheduleReconnect()
    })

    this.markConnected()
    this.log.info('Telegram bot polling started')

    // Reset the reconnect budget once this connection has stayed up for the stability window.
    // The `this.bot === bot` guard ensures a stale timer from a superseded connection no-ops.
    this.clearStabilityTimer()
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = null
      if (!this.shouldStop && this.bot === bot) this.reconnectAttempts = 0
    }, this.stabilityResetMs)
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
    this.clearReconnectTimer()
    this.clearStabilityTimer()
    if (this.bot) {
      await this.bot.stop()
      this.bot = null
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
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    const parseMode = opts?.parseMode ?? 'MarkdownV2'
    const isMarkdown = parseMode === 'MarkdownV2'
    // Split the PLAIN text first and escape each chunk, so the MarkdownV2 send and
    // its plain-text fallback share one chunk boundary. (Splitting the *formatted*
    // text and then re-splitting the *raw* text by the same index misaligns — escaping
    // changes lengths/boundaries — dropping, duplicating, or passing `undefined` chunks.)
    const plainChunks = splitMessage(text, isMarkdown ? TELEGRAM_MARKDOWN_CHUNK_BUDGET : TELEGRAM_MAX_LENGTH)

    for (let i = 0; i < plainChunks.length; i++) {
      const plain = plainChunks[i]
      const formatted = isMarkdown ? toMarkdownV2(plain).trimEnd() : plain
      const replyParams =
        opts?.replyToMessageId && i === 0 ? { reply_parameters: { message_id: opts.replyToMessageId } } : {}

      try {
        await this.bot.api.sendMessage(chatId, formatted, {
          parse_mode: parseMode,
          ...replyParams
        })
      } catch (error) {
        // Fallback to plain text if MarkdownV2 parsing fails — same chunk content.
        if (isMarkdown) {
          this.log.warn('MarkdownV2 send failed, falling back to plain text', {
            chatId,
            error: error instanceof Error ? error.message : String(error)
          })
          await this.bot.api.sendMessage(chatId, plain, replyParams)
        } else {
          throw error
        }
      }

      // Small delay between chunks to avoid rate limiting
      if (i < plainChunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
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

// Self-registration
registerAdapterFactory('telegram', (channel, agentId) => {
  return new TelegramAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
