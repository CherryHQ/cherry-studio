import { windowService } from '@main/services/WindowService'
import { IpcChannel } from '@shared/IpcChannel'
import { DWClient, TOPIC_ROBOT } from 'dingtalk-stream'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  type FileAttachment,
  type ImageAttachment,
  MAX_FILE_SIZE_BYTES,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand } from '../../constants'
import { FILE_EXTENSION_MIME_MAP, splitMessage } from '../../utils'
import { DingTalkClient } from './DingTalkClient'
import { registrationBegin, registrationPoll } from './DingTalkDeviceRegistration'

/** DingTalk text message limit — conservative chunking to stay under the documented 5000-char cap. */
const DINGTALK_MAX_LENGTH = 4000

/** How long to remember a chat's `sessionWebhook` after the last inbound message (DingTalk gives ~5 min). */
const SESSION_WEBHOOK_TTL_MS = 4 * 60_000

/** Encoded chat id format: "p2p:<staffId>" (DM) or "group:<openConversationId>" (group). */
type DecodedChatId = { kind: 'p2p'; staffId: string } | { kind: 'group'; openConversationId: string }

function encodeChatId(msg: DingTalkInboundMessage): string {
  if (msg.conversationType === '1') return `p2p:${msg.senderStaffId ?? msg.senderId}`
  return `group:${msg.conversationId}`
}

function decodeChatId(encoded: string): DecodedChatId | null {
  if (encoded.startsWith('p2p:')) {
    const staffId = encoded.slice(4)
    return staffId ? { kind: 'p2p', staffId } : null
  }
  if (encoded.startsWith('group:')) {
    const openConversationId = encoded.slice(6)
    return openConversationId ? { kind: 'group', openConversationId } : null
  }
  return null
}

/** Subset of DingTalk's inbound payload we care about; matches the stream JSON shape. */
interface DingTalkInboundMessage {
  msgId?: string
  msgtype?: string
  conversationType?: string
  conversationId?: string
  senderId?: string
  senderStaffId?: string
  senderNick?: string
  sessionWebhook?: string
  text?: { content?: string }
  content?: { downloadCode?: string; fileName?: string; recognition?: string }
}

class DingTalkAdapter extends ChannelAdapter {
  private dw: DWClient | null = null
  private client: DingTalkClient | null = null
  private qrAbort: AbortController | null = null

  private readonly clientId: string
  private readonly clientSecret: string
  private readonly allowedChatIds: string[]

  /** Per-encoded-chat: most recent sessionWebhook + when it was observed. */
  private readonly sessionWebhooks = new Map<string, { url: string; expiresAt: number }>()

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { client_id, client_secret, allowed_chat_ids } = config.channelConfig
    this.clientId = (client_id as string) ?? ''
    this.clientSecret = (client_secret as string) ?? ''
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!(this.clientId && this.clientSecret)
  }

  protected override async performConnect(signal: AbortSignal): Promise<void> {
    if (!this.clientId || !this.clientSecret) {
      this.startRegistrationInBackground()
      return
    }

    this.client = new DingTalkClient({ clientId: this.clientId, clientSecret: this.clientSecret })

    const dw = new DWClient({
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      ua: 'CherryStudio',
      keepAlive: true
    })
    this.dw = dw

    dw.registerCallbackListener(TOPIC_ROBOT, (downstream) => {
      const messageId = downstream.headers?.messageId
      try {
        const msg = JSON.parse(downstream.data) as DingTalkInboundMessage
        // Ack first so DingTalk doesn't retry while we're processing.
        if (messageId) {
          try {
            dw.socketCallBackResponse(messageId, { success: true })
          } catch (err) {
            this.log.warn(`Failed to ack message ${messageId}`, {
              error: err instanceof Error ? err.message : String(err)
            })
          }
        }
        this.handleInbound(msg).catch((err) => {
          this.log.warn(`Inbound handler error: ${err instanceof Error ? err.message : String(err)}`)
        })
      } catch (err) {
        this.log.warn(`Failed to parse DingTalk inbound: ${err instanceof Error ? err.message : String(err)}`)
      }
    })

    try {
      await dw.connect()
    } catch (err) {
      this.dw = null
      throw new Error(`DingTalk stream connect failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (signal.aborted) return

    this.markConnected()
    this.log.info('DingTalk bot connected (stream)')
  }

  protected override async performDisconnect(): Promise<void> {
    if (this.qrAbort) {
      this.qrAbort.abort()
      this.qrAbort = null
    }
    if (this.dw) {
      try {
        this.dw.disconnect()
      } catch (err) {
        this.log.warn(`Error disconnecting DingTalk client: ${err instanceof Error ? err.message : String(err)}`)
      }
      this.dw = null
    }
    this.client = null
    this.sessionWebhooks.clear()
    this.sendQrToRenderer('', 'disconnected')
    this.log.info('DingTalk bot disconnected')
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) throw new Error('DingTalk client is not connected')
    const target = decodeChatId(chatId)
    if (!target) throw new Error(`Invalid DingTalk chat id: ${chatId}`)

    const chunks = splitMessage(text, DINGTALK_MAX_LENGTH)
    // Prefer the most recent sessionWebhook if it's still alive — DingTalk only
    // accepts replies via session webhook within ~5 min of an inbound message.
    const webhook = this.getFreshSessionWebhook(chatId)

    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]
      if (webhook) {
        await this.client.sendBySessionWebhook(webhook, { msgtype: 'text', text: { content } })
      } else if (target.kind === 'group') {
        await this.client.sendProactiveGroupText(target.openConversationId, content)
      } else {
        await this.client.sendProactiveP2PText([target.staffId], content)
      }
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendTypingIndicator(_chatId: string): Promise<void> {
    // DingTalk has no public typing API for stream bots — no-op.
  }

  // ---- QR registration ----

  private startRegistrationInBackground(): void {
    this.log.info('Starting DingTalk Device Flow registration (background)')
    this.sendQrToRenderer('', 'pending')

    registrationBegin()
      .then((begin) => {
        this.emit('qr', begin.verificationUrl)
        this.sendQrToRenderer(begin.verificationUrl, 'pending')

        this.qrAbort = new AbortController()
        return registrationPoll(begin, this.qrAbort.signal)
      })
      .then((result) => {
        this.qrAbort = null
        this.sendQrToRenderer('', 'confirmed', result.clientId, result.clientSecret)
        // ChannelManager.saveCredentialsAndReconnect dispatches by channel type,
        // writes client_id/client_secret for dingtalk, and triggers a fresh adapter.
        this.emit('credentials', { appId: result.clientId, appSecret: result.clientSecret })
        this.log.info('DingTalk registration completed')
      })
      .catch((err) => {
        this.qrAbort = null
        const msg = err instanceof Error ? err.message : String(err)
        this.sendQrToRenderer('', 'expired')
        this.log.warn(`DingTalk registration failed: ${msg}`)
      })
  }

  private sendQrToRenderer(
    url: string,
    status: 'pending' | 'confirmed' | 'expired' | 'disconnected',
    clientId?: string,
    clientSecret?: string
  ): void {
    const mainWindow = windowService.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IpcChannel.DingTalk_QrLogin, {
        channelId: this.channelId,
        url,
        status,
        clientId,
        clientSecret
      })
    }
  }

  // ---- Inbound ----

  private async handleInbound(msg: DingTalkInboundMessage): Promise<void> {
    const encoded = encodeChatId(msg)
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(encoded)) {
      this.log.debug('Dropping message from unauthorized chat', { encoded })
      return
    }

    // Capture sessionWebhook so subsequent replies stay in-thread.
    if (msg.sessionWebhook) {
      this.sessionWebhooks.set(encoded, {
        url: msg.sessionWebhook,
        expiresAt: Date.now() + SESSION_WEBHOOK_TTL_MS
      })
    }

    const userId = msg.senderStaffId ?? msg.senderId ?? ''
    const userName = msg.senderNick ?? userId

    if (msg.msgtype === 'text') {
      const text = (msg.text?.content ?? '').trim()
      if (!text) return

      if (isSlashCommand(text)) {
        const parts = text.split(/\s+/)
        const cmd = parts[0].slice(1).toLowerCase() as 'new' | 'compact' | 'help' | 'whoami'
        this.emit('command', {
          chatId: encoded,
          userId,
          userName,
          command: cmd,
          args: parts.slice(1).join(' ') || undefined
        })
        return
      }

      this.emit('message', { chatId: encoded, userId, userName, text })
      return
    }

    if (msg.msgtype === 'picture' || msg.msgtype === 'file' || msg.msgtype === 'audio' || msg.msgtype === 'video') {
      const downloadCode = msg.content?.downloadCode
      const fileName = msg.content?.fileName ?? msg.msgtype
      if (!downloadCode || !this.client) {
        this.emit('message', { chatId: encoded, userId, userName, text: `[${msg.msgtype}: ${fileName}]` })
        return
      }

      const media = await this.client.downloadMedia(downloadCode).catch((err) => {
        this.log.warn(`Failed to download DingTalk media: ${err instanceof Error ? err.message : String(err)}`)
        return null
      })

      if (!media) {
        this.emit('message', {
          chatId: encoded,
          userId,
          userName,
          text: `[${msg.msgtype}: ${fileName} — download failed]`
        })
        return
      }
      if (media.buffer.length > MAX_FILE_SIZE_BYTES) {
        this.log.warn('DingTalk media too large, skipping', { fileName, size: media.buffer.length })
        this.emit('message', {
          chatId: encoded,
          userId,
          userName,
          text: `[${msg.msgtype}: ${fileName} — too large]`
        })
        return
      }

      if (msg.msgtype === 'picture') {
        const image: ImageAttachment = {
          data: media.buffer.toString('base64'),
          media_type: media.contentType || 'image/png'
        }
        this.emit('message', { chatId: encoded, userId, userName, text: '', images: [image] })
        return
      }

      const ext = fileName.includes('.') ? fileName.split('.').pop()!.toLowerCase() : ''
      const file: FileAttachment = {
        filename: fileName,
        data: media.buffer.toString('base64'),
        media_type: media.contentType || FILE_EXTENSION_MIME_MAP[ext] || 'application/octet-stream',
        size: media.buffer.length
      }
      this.emit('message', {
        chatId: encoded,
        userId,
        userName,
        text: `[${msg.msgtype}: ${fileName}]`,
        files: [file]
      })
      return
    }

    // Unknown msgtype — emit a marker so the operator can see something arrived.
    this.emit('message', { chatId: encoded, userId, userName, text: `[unsupported DingTalk msgtype: ${msg.msgtype}]` })
  }

  private getFreshSessionWebhook(encoded: string): string | undefined {
    const entry = this.sessionWebhooks.get(encoded)
    if (!entry) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.sessionWebhooks.delete(encoded)
      return undefined
    }
    return entry.url
  }
}

// Self-registration
registerAdapterFactory('dingtalk', (channel, agentId) => {
  return new DingTalkAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})

export { DingTalkAdapter }
