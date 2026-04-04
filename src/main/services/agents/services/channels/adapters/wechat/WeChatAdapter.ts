import path from 'node:path'

import { getDataPath } from '@main/utils'
import { IpcChannel } from '@shared/IpcChannel'
import { parseDataUrl } from '@shared/utils'

import { windowService } from '../../../../../WindowService'
import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  type FileAttachment,
  type ImageAttachment,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand } from '../../constants'
import { FILE_EXTENSION_MIME_MAP, splitMessage } from '../../utils'
import { type IncomingMessage, WeixinBot } from './WeChatProtocol'

const WECHAT_MAX_LENGTH = 2000

class WeChatAdapter extends ChannelAdapter {
  private bot: WeixinBot | null = null
  private readonly tokenPath: string
  private readonly allowedChatIds: string[]

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { token_path, allowed_chat_ids } = config.channelConfig
    this.tokenPath = (token_path as string) || path.join(getDataPath('Channels'), `weixin_bot_${config.channelId}.json`)
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
        this.log.error('WeChat bot error', {
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
    this.registerMessageHandler(bot)
    this.markConnected()
    this.log.info('WeChat bot logged in and polling started', { userId: credentials.userId })

    // Start long-polling (fire-and-forget)
    bot.run().catch((err) => {
      if (!signal.aborted) {
        const msg = err instanceof Error ? err.message : String(err)
        this.markDisconnected(msg)
        this.log.error(`Polling stopped: ${msg}`)
      }
    })

    this.log.info('WeChat bot started')
  }

  protected override async performDisconnect(): Promise<void> {
    if (this.bot) {
      this.bot.stop()
      this.bot = null
      this.sendQrToRenderer('', 'disconnected')
      this.log.info('WeChat bot stopped')
    }
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.bot) {
      throw new Error('Bot is not connected')
    }

    const chunks = splitMessage(text, WECHAT_MAX_LENGTH)

    for (let i = 0; i < chunks.length; i++) {
      await this.bot.send(chatId, chunks[i])

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
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
        url,
        status,
        userId
      })
    }
  }

  private registerMessageHandler(bot: WeixinBot): void {
    bot.onMessage(async (msg: IncomingMessage) => {
      if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(msg.userId)) {
        this.log.debug('Dropping message from unauthorized user', { userId: msg.userId })
        return
      }

      // Download images from WeChat CDN (returns data URIs with base64)
      let images: ImageAttachment[] | undefined
      if (msg._imageItems && msg._imageItems.length > 0) {
        const dataUris = (await Promise.all(msg._imageItems.map((item) => bot.downloadImage(item)))).filter(
          (uri): uri is string => uri !== null
        )
        const parsed = dataUris
          .map((uri) => {
            const result = parseDataUrl(uri)
            if (!result || !result.isBase64 || !result.mediaType) return null
            return { media_type: result.mediaType, data: result.data } as ImageAttachment
          })
          .filter((img): img is ImageAttachment => img !== null)
        if (parsed.length > 0) images = parsed
      }

      // Download files from WeChat CDN
      let files: FileAttachment[] | undefined
      if (msg._fileItems && msg._fileItems.length > 0) {
        const results = await Promise.all(msg._fileItems.map((item) => bot.downloadFile(item)))
        const downloaded = results
          .filter((r): r is NonNullable<typeof r> => r !== null)
          .map((r) => {
            const ext = r.filename.includes('.') ? r.filename.split('.').pop()!.toLowerCase() : ''
            return {
              filename: r.filename,
              data: r.data.toString('base64'),
              media_type: FILE_EXTENSION_MIME_MAP[ext] || 'application/octet-stream',
              size: r.data.length
            } satisfies FileAttachment
          })
        if (downloaded.length > 0) files = downloaded
      }

      const text = msg.text.trim()
      if (!text && !images && !files) return

      if (isSlashCommand(text)) {
        if (text.startsWith('/whoami')) {
          this.sendWhoami(msg).catch((err) => {
            this.log.error('Failed to send whoami response', {
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
          text,
          images,
          files
        })
      }
    })
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
registerAdapterFactory('wechat', (channel, agentId) => {
  return new WeChatAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
