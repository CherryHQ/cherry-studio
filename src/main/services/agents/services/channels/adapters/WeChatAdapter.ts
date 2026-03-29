import path from 'node:path'

import { loggerService } from '@logger'
import { IpcChannel } from '@shared/IpcChannel'
import type { CherryClawChannel } from '@types'
import { app } from 'electron'

import { windowService } from '../../../../WindowService'
import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../ChannelAdapter'
import { registerAdapterFactory } from '../ChannelManager'
import { type IncomingMessage, WeixinBot } from './WeChatProtocol'

const logger = loggerService.withContext('WeChatAdapter')

const WECHAT_MAX_LENGTH = 2000

/**
 * Split a long message into chunks that fit within WeChat's 2000 character limit.
 * Tries to split on paragraph boundaries first, then line boundaries, then hard-splits.
 */
function splitMessage(text: string): string[] {
  if (text.length <= WECHAT_MAX_LENGTH) {
    return [text]
  }

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= WECHAT_MAX_LENGTH) {
      chunks.push(remaining)
      break
    }

    let splitIndex = remaining.lastIndexOf('\n\n', WECHAT_MAX_LENGTH)
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('\n', WECHAT_MAX_LENGTH)
    }
    if (splitIndex <= 0) {
      splitIndex = WECHAT_MAX_LENGTH
    }

    chunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).replace(/^\n+/, '')
  }

  return chunks
}

class WeChatAdapter extends ChannelAdapter {
  private bot: WeixinBot | null = null
  private readonly tokenPath: string
  private readonly allowedChatIds: string[]

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { token_path, allowed_chat_ids } = config.channelConfig
    this.tokenPath =
      (token_path as string) || path.join(app.getPath('userData'), 'Data', `weixin_bot_${config.channelId}.json`)
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    const bot = new WeixinBot({ tokenPath: this.tokenPath })
    const hasCreds = await bot.hasCredentials()
    return hasCreds
  }

  protected override async performConnect(signal: AbortSignal): Promise<void> {
    const bot = new WeixinBot({
      tokenPath: this.tokenPath,
      onError: (error) => {
        logger.error('WeChat bot error', {
          agentId: this.agentId,
          channelId: this.channelId,
          error: error instanceof Error ? error.message : String(error)
        })
      },
      onQrUrl: (url) => {
        this.emit('qr', url)
        this.sendQrToRenderer(url, 'pending')
      }
    })
    this.bot = bot

    // Abort guard — if disconnect() was called before login completes
    if (signal.aborted) return

    const credentials = await bot.login({ signal })
    if (signal.aborted) return

    this.sendQrToRenderer('', 'confirmed', credentials.userId)
    logger.info('WeChat bot logged in', { agentId: this.agentId, userId: credentials.userId })

    this.registerMessageHandler(bot)

    // Start long-polling (fire-and-forget)
    bot.run().catch((err) => {
      if (!signal.aborted) {
        logger.error('WeChat bot polling stopped with error', {
          agentId: this.agentId,
          channelId: this.channelId,
          error: err instanceof Error ? err.message : String(err)
        })
      }
    })

    logger.info('WeChat bot started', { agentId: this.agentId, channelId: this.channelId })
  }

  protected override async performDisconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop()
      this.bot = null
      this.sendQrToRenderer('', 'disconnected')
      logger.info('WeChat bot stopped', { agentId: this.agentId, channelId: this.channelId })
    }
  }

  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    const chunks = splitMessage(text)

    for (let i = 0; i < chunks.length; i++) {
      await this.bot.send(chatId, chunks[i])

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  async sendMessageDraft(_chatId: string, _draftId: number, _text: string): Promise<void> {
    // WeChat does not have a native draft/streaming API
  }

  async sendTypingIndicator(chatId: string): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    try {
      await this.bot.sendTyping(chatId)
    } catch {
      // sendTyping requires a cached context_token from a prior message;
      // silently ignore if not yet available
    }
  }

  private sendQrToRenderer(
    url: string,
    status: 'pending' | 'confirmed' | 'expired' | 'disconnected',
    userId?: string
  ): void {
    const mainWindow = windowService.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.WeChat_QrLogin, {
        channelId: this.channelId,
        agentId: this.agentId,
        url,
        status,
        userId
      })
    }
  }

  private registerMessageHandler(bot: WeixinBot): void {
    bot.onMessage((msg: IncomingMessage) => {
      if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(msg.userId)) {
        logger.debug('Dropping message from unauthorized user', { userId: msg.userId })
        return
      }

      const text = msg.text.trim()
      if (!text) return

      if (this.isCommand(text)) {
        if (text.startsWith('/whoami')) {
          this.sendWhoami(msg).catch((err) => {
            logger.error('Failed to send whoami response', {
              agentId: this.agentId,
              error: err instanceof Error ? err.message : String(err)
            })
          })
          return
        }

        // 'whoami' is handled above and returns early, so it won't reach here
        const cmd = text.split(/\s+/)[0].slice(1) as 'new' | 'compact' | 'help'
        this.emit('command', {
          chatId: msg.userId,
          userId: msg.userId,
          userName: msg.userId,
          command: cmd
        })
      } else {
        this.emit('message', {
          chatId: msg.userId,
          userId: msg.userId,
          userName: msg.userId,
          text
        })
      }
    })
  }

  private isCommand(text: string): boolean {
    return (
      text.startsWith('/new') || text.startsWith('/compact') || text.startsWith('/help') || text.startsWith('/whoami')
    )
  }

  private async sendWhoami(msg: IncomingMessage): Promise<void> {
    const message = [
      `Chat Info`,
      ``,
      `User ID: ${msg.userId}`,
      ``,
      `To enable notifications for this user:`,
      `1. Go to Agent Settings > Channels > WeChat`,
      `2. Add "${msg.userId}" to Allowed User IDs`,
      `3. Enable "Receive Notifications"`,
      ``,
      `Then use the notify tool or scheduled tasks will send messages here.`
    ].join('\n')

    await this.bot!.reply(msg, message)
  }
}

// Self-registration
registerAdapterFactory('wechat', (channel: CherryClawChannel, agentId: string) => {
  return new WeChatAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
