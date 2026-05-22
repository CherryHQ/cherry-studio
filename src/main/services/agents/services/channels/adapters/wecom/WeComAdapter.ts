import { app } from 'electron'

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
import { WeComClient } from './WeComClient'
import type {
  GetMessageResponse,
  GetMsgMediaResponse,
  SendMessageArgs,
  WeComChatType,
  WeComMessageItem
} from './WeComTypes'

/** WeCom send_message content limit (2048 bytes, per send-message.md). Conservative char limit. */
const WECOM_MAX_LENGTH = 1800

/** Polling cadence. */
const POLL_INTERVAL_MS = 30_000

/** Lookback window on first connect — avoid flooding the agent with a week of history. */
const INITIAL_LOOKBACK_MS = 60_000

/** Window for echo-suppression of our own outgoing text. */
const ECHO_SUPPRESS_MS = 60_000

/** Encoded chat id format: "<chat_type>:<chatid>" — e.g. "1:zhangsan" or "2:wrxxxx". */
function decodeChatId(encoded: string): { chatType: WeComChatType; chatid: string } | null {
  const idx = encoded.indexOf(':')
  if (idx <= 0) return null
  const typeStr = encoded.slice(0, idx)
  const chatid = encoded.slice(idx + 1)
  if (!chatid) return null
  if (typeStr === '1') return { chatType: 1, chatid }
  if (typeStr === '2') return { chatType: 2, chatid }
  return null
}

/** WeCom uses Beijing time strings (`YYYY-MM-DD HH:mm:ss`) in UTC+8. */
function toWeComTime(date: Date): string {
  const beijing = new Date(date.getTime() + 8 * 60 * 60 * 1000)
  return beijing.toISOString().slice(0, 19).replace('T', ' ')
}

function parseWeComTime(s: string | undefined): number {
  if (!s) return 0
  // Treat as UTC+8 → convert to epoch ms.
  const utcIso = `${s.replace(' ', 'T')}+08:00`
  const t = Date.parse(utcIso)
  return Number.isNaN(t) ? 0 : t
}

class WeComAdapter extends ChannelAdapter {
  private client: WeComClient | null = null
  private readonly botId: string
  private readonly botSecret: string
  private readonly allowedChatIds: string[]

  private pollTimer: ReturnType<typeof setInterval> | null = null
  private polling = false

  /** Per-encoded-chat: last-seen `send_time` (epoch ms). Messages at or before this are dropped. */
  private lastSeen = new Map<string, number>()

  /** Recently-sent text contents (epoch ms expiry). Used to suppress echoes of our own replies. */
  private readonly outgoingEchoes = new Map<string, number>()

  constructor(config: ChannelAdapterConfig) {
    super(config)
    const { bot_id, bot_secret, allowed_chat_ids } = config.channelConfig
    this.botId = (bot_id as string) ?? ''
    this.botSecret = (bot_secret as string) ?? ''
    const rawIds = allowed_chat_ids as string[] | undefined
    this.allowedChatIds = Array.isArray(rawIds) ? rawIds.map(String) : []
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!(this.botId && this.botSecret)
  }

  protected override async performConnect(signal: AbortSignal): Promise<void> {
    if (!this.botId || !this.botSecret) {
      throw new Error('Missing bot_id or bot_secret')
    }

    const client = new WeComClient({
      botId: this.botId,
      botSecret: this.botSecret,
      clientVersion: `CherryStudio/${getAppVersion()} ${process.platform}/${process.arch}`
    })
    this.client = client

    await client.bootstrap()
    if (signal.aborted) return

    // Seed lastSeen to "now - INITIAL_LOOKBACK_MS" so we don't replay a week of history on first connect.
    const seed = Date.now() - INITIAL_LOOKBACK_MS
    for (const encoded of this.allowedChatIds) {
      if (!this.lastSeen.has(encoded)) this.lastSeen.set(encoded, seed)
    }

    if (this.allowedChatIds.length === 0) {
      this.log.warn(
        'No allowed_chat_ids configured — WeCom polling is disabled. Add entries like "1:zhangsan" or "2:wrxxxx" to receive messages.'
      )
    }

    this.markConnected()
    this.log.info('WeCom bot connected', { chatCount: this.allowedChatIds.length })

    this.pollTimer = setInterval(() => {
      void this.runPoll()
    }, POLL_INTERVAL_MS)
    // Kick off the first poll immediately for responsiveness.
    void this.runPoll()
  }

  protected override async performDisconnect(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.client = null
    this.outgoingEchoes.clear()
    this.log.info('WeCom bot disconnected')
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendMessage(chatId: string, text: string, _opts?: SendMessageOptions): Promise<void> {
    if (!this.client) throw new Error('WeCom client is not connected')
    const target = decodeChatId(chatId)
    if (!target) throw new Error(`Invalid WeCom chat id: ${chatId}`)

    const chunks = splitMessage(text, WECOM_MAX_LENGTH)
    for (let i = 0; i < chunks.length; i++) {
      const content = chunks[i]
      const args: SendMessageArgs = {
        chat_type: target.chatType,
        chatid: target.chatid,
        msgtype: 'text',
        text: { content }
      }
      await this.client.callTool('msg', 'send_message', args)
      this.rememberOutgoing(content)

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }

  // oxlint-disable-next-line no-unused-vars -- abstract method signature
  async sendTypingIndicator(_chatId: string): Promise<void> {
    // WeCom has no typing API — no-op.
  }

  // ---- Polling ----

  private async runPoll(): Promise<void> {
    if (!this.client || this.polling) return
    if (this.allowedChatIds.length === 0) return
    this.polling = true
    try {
      for (const encoded of this.allowedChatIds) {
        const target = decodeChatId(encoded)
        if (!target) {
          this.log.warn(`Skipping invalid allowed_chat_id "${encoded}" (expected format "1:userid" or "2:groupid")`)
          continue
        }
        await this.pollChat(encoded, target.chatType, target.chatid).catch((err) => {
          const msg = err instanceof Error ? err.message : String(err)
          this.log.warn(`Poll failed for ${encoded}: ${msg}`)
        })
      }
    } finally {
      this.polling = false
    }
  }

  private async pollChat(encoded: string, chatType: WeComChatType, chatid: string): Promise<void> {
    if (!this.client) return

    const last = this.lastSeen.get(encoded) ?? Date.now() - INITIAL_LOOKBACK_MS
    const beginMs = Math.max(last + 1000, Date.now() - 6 * 24 * 60 * 60 * 1000) // never go past WeCom's 7-day limit
    const endMs = Date.now()
    if (beginMs >= endMs) return

    const res = await this.client.callTool<unknown, GetMessageResponse>('msg', 'get_message', {
      chat_type: chatType,
      chatid,
      begin_time: toWeComTime(new Date(beginMs)),
      end_time: toWeComTime(new Date(endMs))
    })

    const messages = res.messages ?? []
    if (messages.length === 0) {
      this.lastSeen.set(encoded, endMs)
      return
    }

    let newestSeen = last
    for (const msg of messages) {
      const ts = parseWeComTime(msg.send_time)
      if (ts > newestSeen) newestSeen = ts
      await this.dispatchIncoming(encoded, msg).catch((err) => {
        this.log.warn(`Failed to dispatch WeCom message: ${err instanceof Error ? err.message : String(err)}`)
      })
    }
    this.lastSeen.set(encoded, newestSeen || endMs)
  }

  private async dispatchIncoming(encoded: string, msg: WeComMessageItem): Promise<void> {
    const userId = msg.userid?.trim() ?? ''
    const userName = userId
    const msgType = msg.msgtype

    if (msgType === 'text') {
      const content = msg.text?.content ?? ''
      const text = content.trim()
      if (!text) return
      if (this.isEcho(text)) {
        this.log.debug('Suppressing echoed outgoing message', { content: text.slice(0, 64) })
        return
      }

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

    if (msgType === 'image' || msgType === 'file' || msgType === 'voice' || msgType === 'video') {
      const ref = msg[msgType] as { media_id?: string; name?: string } | undefined
      const mediaId = ref?.media_id
      const name = ref?.name ?? `${msgType}`
      if (!mediaId) {
        this.emit('message', { chatId: encoded, userId, userName, text: `[${msgType}: ${name} — no media_id]` })
        return
      }

      const media = await this.downloadMedia(mediaId).catch((err) => {
        this.log.warn(`Failed to download media ${mediaId}: ${err instanceof Error ? err.message : String(err)}`)
        return null
      })

      if (!media) {
        this.emit('message', { chatId: encoded, userId, userName, text: `[${msgType}: ${name} — download failed]` })
        return
      }

      if (msgType === 'image') {
        const image: ImageAttachment = {
          data: media.base64,
          media_type: media.contentType || 'image/png'
        }
        this.emit('message', { chatId: encoded, userId, userName, text: '', images: [image] })
        return
      }

      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : ''
      const file: FileAttachment = {
        filename: media.name || name,
        data: media.base64,
        media_type: media.contentType || FILE_EXTENSION_MIME_MAP[ext] || 'application/octet-stream',
        size: media.size
      }
      this.emit('message', { chatId: encoded, userId, userName, text: `[${msgType}: ${file.filename}]`, files: [file] })
      return
    }

    // Unknown msgtype — surface as a plain text marker rather than dropping silently.
    this.emit('message', { chatId: encoded, userId, userName, text: `[unsupported WeCom msgtype: ${msgType}]` })
  }

  private async downloadMedia(
    mediaId: string
  ): Promise<{ base64: string; contentType: string; size: number; name: string } | null> {
    if (!this.client) return null
    const res = await this.client.callTool<unknown, GetMsgMediaResponse>('msg', 'get_msg_media', { media_id: mediaId })
    const item = res.media_item
    if (!item || !item.base64_data) return null

    // Enforce size cap before decoding (base64 is ~4/3 of raw).
    if (item.size && item.size > MAX_FILE_SIZE_BYTES) {
      this.log.warn(`WeCom media too large, skipping`, { mediaId, size: item.size })
      return null
    }

    return {
      base64: item.base64_data,
      contentType: item.content_type ?? '',
      size: item.size ?? 0,
      name: item.name ?? mediaId
    }
  }

  // ---- Echo suppression ----

  private rememberOutgoing(content: string): void {
    const now = Date.now()
    this.outgoingEchoes.set(content, now + ECHO_SUPPRESS_MS)
    // Opportunistic cleanup.
    if (this.outgoingEchoes.size > 256) {
      for (const [key, expiry] of this.outgoingEchoes) {
        if (expiry <= now) this.outgoingEchoes.delete(key)
      }
    }
  }

  private isEcho(content: string): boolean {
    const expiry = this.outgoingEchoes.get(content)
    if (!expiry) return false
    if (expiry <= Date.now()) {
      this.outgoingEchoes.delete(content)
      return false
    }
    return true
  }
}

function getAppVersion(): string {
  try {
    return app.getVersion()
  } catch {
    return 'unknown'
  }
}

// Self-registration
registerAdapterFactory('wecom', (channel, agentId) => {
  return new WeComAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})

export { WeComAdapter }
