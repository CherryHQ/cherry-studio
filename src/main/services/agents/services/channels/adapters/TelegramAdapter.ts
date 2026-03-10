import { loggerService } from '@logger'
import type { CherryClawChannel } from '@types'
import { Bot } from 'grammy'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../ChannelAdapter'
import { registerAdapterFactory } from '../ChannelManager'

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
  }

  async connect(): Promise<void> {
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

    // Message handler
    bot.on('message:text', (ctx) => {
      this.emit('message', {
        chatId: ctx.chat.id.toString(),
        userId: ctx.from?.id?.toString() ?? '',
        userName: ctx.from?.first_name ?? '',
        text: ctx.message.text
      })
    })

    // Register bot commands with Telegram
    await bot.api.setMyCommands([
      { command: 'new', description: 'Start a new conversation' },
      { command: 'compact', description: 'Compact conversation history' },
      { command: 'help', description: 'Show help information' }
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
      logger.error('Bot polling stopped with error', {
        agentId: this.agentId,
        channelId: this.channelId,
        error: err instanceof Error ? err.message : String(err)
      })
    })

    logger.info('Telegram bot started', { agentId: this.agentId, channelId: this.channelId })
  }

  async disconnect(): Promise<void> {
    if (this.bot) {
      await this.bot.stop()
      this.bot = null
      logger.info('Telegram bot stopped', { agentId: this.agentId, channelId: this.channelId })
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
    agentId,
    channelConfig: channel.config as Record<string, unknown>
  })
})
