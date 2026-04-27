import { Bot } from 'grammy'
import { convert as toMarkdownV2 } from 'telegram-markdown-v2'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  downloadFileAsBase64,
  downloadImageAsBase64,
  type FileAttachment,
  type ImageAttachment,
  MAX_FILE_SIZE_BYTES,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'

const TELEGRAM_MAX_LENGTH = 4096

import { splitMessage } from '../../utils'

class TelegramAdapter extends ChannelAdapter {
  private bot: Bot | null = null
  private readonly botToken: string
  private readonly allowedChatIds: string[]

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { bot_token, allowed_chat_ids } = config.channelConfig
    this.botToken = (bot_token as string) ?? ''
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!this.botToken
  }

  protected override async performConnect(_signal: AbortSignal): Promise<void> {
    if (!this.botToken) {
      throw new Error('Telegram bot token is required')
    }

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

    // Start long polling (fire-and-forget)
    bot.start().catch((err) => {
      const msg = err instanceof Error ? err.message : String(err)
      this.markDisconnected(msg)
      this.log.error(`Polling stopped: ${msg}`)
    })

    this.markConnected()
    this.log.info('Telegram bot polling started')
  }

  protected override async performDisconnect(): Promise<void> {
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
    const formatted = parseMode === 'MarkdownV2' ? toMarkdownV2(text).trimEnd() : text
    const chunks = splitMessage(formatted, TELEGRAM_MAX_LENGTH)

    for (let i = 0; i < chunks.length; i++) {
      const replyParams =
        opts?.replyToMessageId && i === 0 ? { reply_parameters: { message_id: opts.replyToMessageId } } : {}

      try {
        await this.bot.api.sendMessage(chatId, chunks[i], {
          parse_mode: parseMode,
          ...replyParams
        })
      } catch (error) {
        // Fallback to plain text if MarkdownV2 parsing fails
        if (parseMode === 'MarkdownV2') {
          this.log.warn('MarkdownV2 send failed, falling back to plain text', {
            chatId,
            error: error instanceof Error ? error.message : String(error)
          })
          await this.bot.api.sendMessage(chatId, splitMessage(text, TELEGRAM_MAX_LENGTH)[i], replyParams)
        } else {
          throw error
        }
      }

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
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
