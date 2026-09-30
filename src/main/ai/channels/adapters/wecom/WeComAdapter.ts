import { randomUUID } from 'node:crypto'
import { setMaxListeners } from 'node:events'

import {
  decryptFile,
  WSAuthFailureError,
  WSClient,
  WSReconnectExhaustedError,
  type BaseMessage,
  type WsFrame
} from '@wecom/aibot-node-sdk'
import { delay } from 'es-toolkit'
import { fileTypeFromBuffer } from 'file-type'
import { LRUCache } from 'lru-cache'
import PQueue from 'p-queue'

import { t } from '@main/i18n'
import { filenameFromContentDisposition, type FileAttachment, type ImageAttachment } from '@main/utils/downloadAsBase64'
import { fetchRemoteBytes } from '@main/utils/remoteFetch'
import { sanitizeFilename } from '@shared/utils/file'

import {
  ChannelAdapter,
  type ChannelAdapterConfig,
  type ChannelStreamErrorOptions,
  type ChannelStreamOutcome,
  type SendMessageOptions
} from '../../ChannelAdapter'
import { FlushController } from '../../FlushController'

// Conservative limits until the deployed bot's stream/markdown limits are verified.
const TEXT_BYTES = 2048
const STREAM_WINDOW_MS = 170_000
// Ordinary-file upload bounds: https://developer.work.weixin.qq.com/document/path/101463
const MIN_UPLOAD_FILE_BYTES = 5
const FILE_BYTES = 20 * 1024 * 1024
const MESSAGE_BYTES = 40 * 1024 * 1024

type ResponseContext = {
  chatId: string
  reqId: string
  streamId: string
  expiresAt: number
  text: string
  lastFlush: number
  started: boolean
  active: boolean
  finished: boolean
  timer?: ReturnType<typeof setTimeout>
  flusher?: FlushController
}

function textChunks(text: string): string[] {
  if (Buffer.byteLength(text) <= TEXT_BYTES) return [text]
  const chunks: string[] = []
  let chunk = ''
  let bytes = 0
  for (const character of text) {
    const size = Buffer.byteLength(character)
    if (bytes + size > TEXT_BYTES - 64) {
      const newline = chunk.lastIndexOf('\n')
      const boundary = newline >= 0 ? newline + 1 : chunk.length
      chunks.push(chunk.slice(0, boundary))
      chunk = chunk.slice(boundary)
      bytes = Buffer.byteLength(chunk)
    }
    chunk += character
    bytes += size
  }
  if (chunk) chunks.push(chunk)
  let fence: string | null = null
  return chunks.map((part, index) => {
    const prefix = fence ? `${fence}\n` : ''
    for (const line of part.split('\n')) {
      const marker = /^ {0,3}(```|~~~)/.exec(line)?.[1]
      if (marker) fence = fence === marker ? null : (fence ?? marker)
    }
    const suffix = fence ? `\n${fence}` : ''
    return `[${index + 1}/${chunks.length}]\n${prefix}${part}${suffix}`
  })
}

export class WeComAdapter extends ChannelAdapter {
  private client: WSClient | null = null
  private lifetime = new AbortController()
  private alive = false
  private readonly cfg: ChannelAdapterConfig<'wecom'>['channelConfig']
  private readonly seen = new LRUCache<string, true>({ max: 1000, ttl: 10 * 60_000 })
  private readonly responses = new LRUCache<string, ResponseContext>({
    max: 1000,
    ttl: 10 * 60_000,
    ttlAutopurge: true,
    dispose: (context) => {
      context.finished = true
      clearTimeout(context.timer)
      context.flusher?.complete()
      context.flusher?.cancelPendingFlush()
    }
  })
  private readonly deliveries = new Map<string, { queue: PQueue; sent: number[] }>()
  private waiting = 0
  private waitingBytes = 0
  private readonly downloads = new PQueue({ concurrency: 4 })

  constructor(config: ChannelAdapterConfig<'wecom'>) {
    super(config)
    this.cfg = config.channelConfig
    this.notifyChatIds = [...this.cfg.allowed_chat_ids]
  }

  override isStreamListenerAlive(): boolean {
    return this.alive
  }

  protected async performConnect(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    this.lifetime = new AbortController()
    setMaxListeners(256, this, this.lifetime.signal)
    this.alive = true
    const client = new WSClient({
      botId: this.cfg.bot_id,
      secret: this.cfg.secret,
      // SDK diagnostics can contain callback bodies and attachment decryption keys.
      logger: { debug() {}, info() {}, warn() {}, error() {} }
    })
    this.client = client
    client.on('authenticated', () => {
      if (!this.alive || this.client !== client) return
      this.markConnected()
      this.log.info('WeCom authenticated')
      for (const context of this.responses.values()) {
        if (!context.started || context.finished || context.active) continue
        const resumed = Date.now() < context.expiresAt ? this.flush(context, false) : this.transfer(context)
        void resumed.catch(() => this.log.warn('WeCom stream resume failed'))
      }
    })
    client.on('disconnected', () => {
      if (this.alive) this.markDisconnected(t('common.wecom_connection_lost'))
    })
    client.on('error', (error) => {
      if (!this.alive) return
      if (error instanceof WSAuthFailureError || error instanceof WSReconnectExhaustedError) {
        this.retire(t('common.wecom_connection_failed'))
      } else {
        this.log.warn('WeCom transport error')
      }
    })
    client.on('event.disconnected_event', () => this.retire(t('common.wecom_replaced')))
    client.on('message', (frame) => {
      void this.receive(frame).catch(() => this.log.warn('WeCom inbound message failed'))
    })
    const connected = this.waitConnected(30_000, signal)
    try {
      client.connect()
      await connected
    } catch {
      this.retire(t('common.wecom_connection_failed'))
      await connected.catch(() => {})
      throw new Error(t('common.wecom_connection_failed'))
    }
  }

  private retire(reason: string): void {
    this.alive = false
    this.lifetime.abort()
    this.client?.disconnect()
    this.client?.removeAllListeners()
    this.client = null
    this.responses.clear()
    this.downloads.clear()
    this.deliveries.clear()
    this.markDisconnected(reason)
  }

  protected async performDisconnect(): Promise<void> {
    this.retire(t('common.wecom_connection_lost'))
    this.seen.clear()
  }

  private async waitConnected(timeoutMs = 5 * 60_000, signal?: AbortSignal, bytes = 0): Promise<void> {
    if (!this.alive || this.waiting >= 100 || this.waitingBytes + bytes > MESSAGE_BYTES)
      throw new Error(t('common.wecom_connection_failed'))
    if (this.connected) return
    const abort = signal ? AbortSignal.any([signal, this.lifetime.signal]) : this.lifetime.signal
    abort.throwIfAborted()
    this.waiting++
    this.waitingBytes += bytes
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          this.off('statusChange', changed)
          abort.removeEventListener('abort', failed)
        }
        const failed = () => {
          cleanup()
          reject(new Error(t('common.wecom_connection_failed')))
        }
        const changed = () => {
          if (this.connected) {
            cleanup()
            resolve()
          }
        }
        const timer = setTimeout(failed, timeoutMs)
        timer.unref()
        abort.addEventListener('abort', failed, { once: true })
        this.on('statusChange', changed)
      })
    } finally {
      this.waiting--
      this.waitingBytes -= bytes
    }
  }

  private allowed(chatId: string, userId?: string): boolean {
    if (!/^(dm|group):\S+$/.test(chatId)) return false
    if (this.cfg.allowed_chat_ids.length && !this.cfg.allowed_chat_ids.includes(chatId)) return false
    const recipient = userId ?? (chatId.startsWith('dm:') ? chatId.slice(3) : undefined)
    return !recipient || !this.cfg.allowed_user_ids.length || this.cfg.allowed_user_ids.includes(recipient)
  }

  private key(chatId: string, opts?: SendMessageOptions): string {
    return JSON.stringify([chatId, opts?.replyToMessageId])
  }

  private async receive(frame: WsFrame<BaseMessage>): Promise<void> {
    const body = frame.body
    if (
      !this.alive ||
      !body ||
      !body.msgid ||
      !frame.headers.req_id ||
      !body.from?.userid ||
      body.aibotid !== this.cfg.bot_id
    )
      return
    const chatId =
      body.chattype === 'single'
        ? `dm:${body.from.userid}`
        : body.chattype === 'group' && body.chatid
          ? `group:${body.chatid}`
          : ''
    if (!this.allowed(chatId, body.from.userid) || this.seen.has(body.msgid)) return
    this.seen.set(body.msgid, true)
    if (this.responses.size >= 1000) {
      this.log.warn('WeCom response capacity reached')
      await this.sendToChat(chatId, () =>
        this.client!.replyStreamNonBlocking(
          { headers: { req_id: frame.headers.req_id } },
          randomUUID(),
          t('common.channel_message_dropped'),
          true
        )
      )
      return
    }
    const opts = { replyToMessageId: body.msgid }
    const context: ResponseContext = {
      chatId,
      reqId: frame.headers.req_id,
      streamId: randomUUID(),
      expiresAt: Date.now() + STREAM_WINDOW_MS,
      text: '',
      lastFlush: 0,
      started: false,
      active: false,
      finished: false
    }
    context.flusher = new FlushController(async () => {
      if (context.finished || context.active || !this.connected) return
      try {
        if (Date.now() >= context.expiresAt) await this.transfer(context)
        else await this.flush(context, false)
      } catch {
        this.log.warn('WeCom stream update failed')
      }
    })
    this.responses.set(this.key(chatId, opts), context)
    const images: ImageAttachment[] = []
    const files: FileAttachment[] = []
    let text = ''
    let total = 0
    const controller = new AbortController()
    const signal = AbortSignal.any([this.lifetime.signal, controller.signal])
    const download = async (media: { url: string; aeskey?: string }, image: boolean, index = 0) => {
      if (this.downloads.size >= 32) throw new Error('Attachment queue full')
      const result = await this.downloads.add(
        () =>
          fetchRemoteBytes(media.url, {
            maxBytes: Math.min(FILE_BYTES + 32, MESSAGE_BYTES - total + 32),
            maxRedirects: 3,
            signal
          }),
        { signal, throwOnTimeout: true }
      )
      signal.throwIfAborted()
      const bytes = media.aeskey ? decryptFile(result.body, media.aeskey) : result.body
      total += bytes.length
      if (bytes.length > FILE_BYTES || total > MESSAGE_BYTES) throw new Error('Attachment limit exceeded')
      const type = await fileTypeFromBuffer(bytes)
      if (image) {
        if (!type?.mime.startsWith('image/')) throw new Error('Invalid image')
        images[index] = { data: bytes.toString('base64'), media_type: type.mime }
      } else {
        const disposition = result.headers['content-disposition']
        const filename = filenameFromContentDisposition(typeof disposition === 'string' ? disposition : null)
        files.push({
          data: bytes.toString('base64'),
          size: bytes.length,
          media_type: type?.mime ?? 'application/octet-stream',
          filename: sanitizeFilename(filename ?? `attachment.${type?.ext ?? 'bin'}`)
        })
      }
    }
    try {
      switch (body.msgtype) {
        case 'text':
          text = body.text.content
          break
        case 'image':
          await download(body.image, true)
          break
        case 'file':
          await download(body.file, false)
          break
        case 'mixed': {
          if (body.mixed.msg_item.length > 20) throw new Error('Too many attachments')
          let imageIndex = 0
          await Promise.all(
            body.mixed.msg_item.map(async (item) => {
              if (item.msgtype === 'text') text += item.text.content
              else if (item.msgtype === 'image') await download(item.image, true, imageIndex++)
              else throw new Error('Unsupported mixed message')
            })
          )
          break
        }
        default:
          await this.sendMessage(chatId, t('common.wecom_unsupported_message'), opts)
          return
      }
    } catch {
      controller.abort()
      if (!this.lifetime.signal.aborted) await this.sendMessage(chatId, t('common.wecom_attachment_failed'), opts)
      return
    }
    if (signal.aborted) return
    const identity = {
      chatId,
      conversationId: chatId,
      userId: body.from.userid,
      userName: body.from.userid,
      messageId: body.msgid
    }
    const command = /^\/(new|compact|help|whoami)(?:\s+(.*))?$/s.exec(text.trim())
    if (command && !images.length && !files.length) {
      if (command[1] === 'whoami') {
        await this.sendMessage(chatId, t('common.wecom_identity', { chatId, userId: body.from.userid }), opts)
      } else {
        this.emit('command', { ...identity, command: command[1] as 'new' | 'compact' | 'help', args: command[2] })
      }
    } else if (text.trim() || images.length || files.length) {
      this.emit('message', { ...identity, text, images, files })
    } else {
      this.responses.delete(this.key(chatId, opts))
    }
  }

  private async sendToChat(chatId: string, send: () => Promise<unknown>, intermediate = false): Promise<void> {
    const signal = this.lifetime.signal
    signal.throwIfAborted()
    let delivery = this.deliveries.get(chatId)
    if (!delivery) {
      for (const [id, entry] of this.deliveries) {
        if (!entry.queue.size && !entry.queue.pending && (entry.sent.at(-1) ?? 0) <= Date.now() - 3_600_000) {
          this.deliveries.delete(id)
        }
      }
      if (this.deliveries.size >= 1000) throw new Error('Delivery capacity reached')
      delivery = { queue: new PQueue({ concurrency: 1 }), sent: [] }
      this.deliveries.set(chatId, delivery)
    }
    if (intermediate && (delivery.queue.size || delivery.queue.pending)) return
    if (delivery.queue.size >= 100) throw new Error('Delivery queue full')
    const state = delivery
    await state.queue.add(
      async () => {
        while (true) {
          signal.throwIfAborted()
          const now = Date.now()
          state.sent = state.sent.filter((time) => time > now - 3_600_000)
          const minute = state.sent.filter((time) => time > now - 60_000)
          // Intermediate updates leave two slots for notifications and terminal replies.
          if (intermediate && (minute.length >= 28 || state.sent.length >= 998)) return
          const wait = Math.max(
            minute.length >= 30 ? minute[minute.length - 30] + 60_000 - now : 0,
            state.sent.length >= 1000 ? state.sent[state.sent.length - 1000] + 3_600_000 - now : 0
          )
          if (!wait) break
          await delay(wait, { signal })
        }
        await this.waitConnected(undefined, signal)
        signal.throwIfAborted()
        state.sent.push(Date.now())
        await send()
      },
      { priority: intermediate ? 0 : 1 }
    )
  }

  private async flush(context: ResponseContext, finish: boolean): Promise<boolean> {
    if (!this.client || !this.connected) return false
    let sent = false
    await this.sendToChat(
      context.chatId,
      async () => {
        if (Date.now() > context.expiresAt || (!finish && (context.finished || context.active))) return
        await this.client!.replyStreamNonBlocking(
          { headers: { req_id: context.reqId } },
          context.streamId,
          context.text,
          finish
        )
        sent = true
      },
      !finish
    )
    return sent
  }

  private async transfer(context: ResponseContext): Promise<void> {
    if (context.active || context.finished) return
    context.active = true
    context.flusher?.complete()
    context.flusher?.cancelPendingFlush()
    clearTimeout(context.timer)
    if (context.started && this.connected) {
      context.text = t('common.wecom_continued')
      await this.flush(context, true)
    }
  }

  async sendTypingIndicator(chatId: string, opts?: SendMessageOptions): Promise<void> {
    const context = this.responses.get(this.key(chatId, opts))
    if (!context || context.started || context.finished || !this.allowed(chatId)) return
    if (Date.now() >= context.expiresAt) {
      context.active = true
      return
    }
    this.responses.set(this.key(chatId, opts), context, { ttl: 0, noDisposeOnSet: true })
    context.started = true
    context.text = t('common.wecom_processing')
    context.timer = setTimeout(() => {
      void this.transfer(context).catch(() => this.log.warn('WeCom stream handoff failed'))
    }, context.expiresAt - Date.now())
    context.timer.unref()
    await this.flush(context, false)
  }

  async onTextUpdate(chatId: string, fullText: string, opts?: SendMessageOptions): Promise<void> {
    const context = this.responses.get(this.key(chatId, opts))
    if (!context || context.finished || context.active || !this.allowed(chatId)) return
    if (Buffer.byteLength(fullText) > TEXT_BYTES || Date.now() >= context.expiresAt) {
      await this.transfer(context)
      return
    }
    context.text = fullText
    context.started = true
    context.lastFlush = Date.now()
    await context.flusher?.throttledUpdate(500)
  }

  async onStreamComplete(
    chatId: string,
    finalText: string,
    opts?: SendMessageOptions,
    outcome?: ChannelStreamOutcome
  ): Promise<boolean> {
    if (!opts?.replyToMessageId) return false
    const key = this.key(chatId, opts)
    const context = this.responses.get(key)
    if (context?.finished) return true
    if (context) {
      context.finished = true
      clearTimeout(context.timer)
      context.flusher?.complete()
      context.flusher?.cancelPendingFlush()
      await context.flusher?.waitForFlush()
    }
    const text =
      outcome?.status === 'paused'
        ? `${finalText}\n\n${t('common.channel_stopped')}`.trim()
        : finalText || t('common.wecom_empty_response')
    try {
      if (!this.allowed(chatId)) return true
      await this.waitConnected(undefined, undefined, Buffer.byteLength(text))
      if (context && !context.active && Date.now() < context.expiresAt && Buffer.byteLength(text) <= TEXT_BYTES) {
        context.text = text
        if (!(await this.flush(context, true))) await this.sendActive(chatId, text)
      } else {
        if (context && context.started && !context.active && Date.now() < context.expiresAt) {
          context.text = t('common.wecom_continued')
          await this.flush(context, true)
        }
        await this.sendActive(chatId, text)
      }
      return true
    } catch {
      throw new Error(t('common.wecom_delivery_failed'))
    } finally {
      this.responses.delete(key)
    }
  }

  async onStreamError(
    chatId: string,
    _error: string,
    opts?: SendMessageOptions,
    options?: ChannelStreamErrorOptions
  ): Promise<boolean> {
    if (options?.suppressDelivery) {
      this.responses.delete(this.key(chatId, opts))
      return true
    }
    const context = this.responses.get(this.key(chatId, opts))
    const partial = context && context.lastFlush && !context.active ? context.text : ''
    await this.sendMessage(
      chatId,
      [partial, t('common.channel_message_processing_error')].filter(Boolean).join('\n\n'),
      opts
    )
    return true
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    if (opts?.replyToMessageId) {
      await this.onStreamComplete(chatId, text, opts)
      return
    }
    try {
      await this.sendActive(chatId, text)
    } catch {
      throw new Error(t('common.wecom_delivery_failed'))
    }
  }

  private async sendActive(chatId: string, text: string): Promise<void> {
    if (!this.allowed(chatId)) return
    await this.waitConnected(undefined, undefined, Buffer.byteLength(text))
    for (const chunk of textChunks(text)) {
      this.lifetime.signal.throwIfAborted()
      await this.sendToChat(chatId, () =>
        this.client!.sendMessage(chatId.slice(chatId.indexOf(':') + 1), {
          msgtype: 'markdown',
          markdown: { content: chunk }
        })
      )
    }
  }

  async sendFile(chatId: string, file: FileAttachment): Promise<void> {
    if (!this.allowed(chatId)) return
    if (file.size > FILE_BYTES || file.data.length > Math.ceil(FILE_BYTES / 3) * 4)
      throw new Error(t('common.wecom_attachment_failed'))
    const buffer = Buffer.from(file.data, 'base64')
    if (buffer.length < MIN_UPLOAD_FILE_BYTES || buffer.length > FILE_BYTES)
      throw new Error(t('common.wecom_attachment_failed'))
    try {
      await this.waitConnected()
      const client = this.client!
      const media = await client.uploadMedia(buffer, { type: 'file', filename: sanitizeFilename(file.filename) })
      this.lifetime.signal.throwIfAborted()
      await this.sendToChat(chatId, () =>
        client.sendMediaMessage(chatId.slice(chatId.indexOf(':') + 1), 'file', media.media_id)
      )
    } catch {
      throw new Error(t('common.wecom_delivery_failed'))
    }
  }
}

export function createWeComAdapter(config: ChannelAdapterConfig<'wecom'>): WeComAdapter {
  return new WeComAdapter(config)
}
