import { loggerService } from '@logger'
import type { CherryClawChannel } from '@types'
import { Bot } from 'grammy'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  downloadImageAsBase64,
  type ImageAttachment,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'

const logger = loggerService.withContext('TelegramAdapter')

const TELEGRAM_MAX_LENGTH = 4096

/**
 * Split a long message into chunks that fit within Telegram's 4096 character limit.
 * Tries to split on paragraph boundaries first, then line boundaries, then hard-splits.
 */
function splitMessage(text: string): string[] {
  if (text.length <= TELEGRAM_MAX_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= TELEGRAM_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    // Try to split on paragraph boundary
    let splitIndex = remaining.lastIndexOf('\n\n', TELEGRAM_MAX_LENGTH)
    if (splitIndex <= 0) {
      // Try to split on line boundary
      splitIndex = remaining.lastIndexOf('\n', TELEGRAM_MAX_LENGTH)
    }
    if (splitIndex <= 0) {
      // Hard split at max length
      splitIndex = TELEGRAM_MAX_LENGTH
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '')
  }

  return chunks
}

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
    // Expose for notify tool — all allowed chats receive notifications
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
        logger.debug('Dropping message from unauthorized chat', { chatId })
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
      logger.error('Bot error', {
        agentId: this.agentId,
        channelId: this.channelId,
        error: cause instanceof Error ? cause.message : String(cause)
      })
    })

    // Start long polling (fire-and-forget)
    bot.start().catch((err) => {
      this.markDisconnected()
      logger.error('Bot polling stopped with error', {
        agentId: this.agentId,
        channelId: this.channelId,
        error: err instanceof Error ? err.message : String(err)
      })
    })

    logger.info('Telegram bot started', { agentId: this.agentId, channelId: this.channelId })
  }

  protected override async performDisconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop()
      this.bot = null
      logger.info('Telegram bot stopped', { agentId: this.agentId, channelId: this.channelId })
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
      logger.warn('Failed to download Telegram file', {
        fileId,
        error: error instanceof Error ? error.message : String(error)
      })
      return []
    }
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    const chunks = splitMessage(text)

    for (let i = 0; i < chunks.length; i++) {
      await this.bot.api.sendMessage(chatId, chunks[i], {
        ...(opts?.parseMode ? { parse_mode: opts.parseMode } : {}),
        ...(opts?.replyToMessageId && i === 0 ? { reply_parameters: { message_id: opts.replyToMessageId } } : {})
      })

      // Small delay between chunks to avoid rate limiting
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  async sendMessageDraft(chatId: string, draftId: number, text: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    await this.bot.api.sendMessageDraft(Number(chatId), draftId, text)
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    await this.bot.api.sendChatAction(chatId, 'typing')
  }
}

// Self-registration
registerAdapterFactory('telegram', (channel: CherryClawChannel, agentId: string) => {
  return new TelegramAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
