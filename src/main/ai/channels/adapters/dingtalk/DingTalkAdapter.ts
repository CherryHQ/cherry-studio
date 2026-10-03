import { randomUUID } from 'node:crypto'
import { setMaxListeners } from 'node:events'

import { DWClient, TOPIC_ROBOT, type DWClientDownStream, type RobotTextMessage } from 'dingtalk-stream'
import { fileTypeFromBuffer } from 'file-type'
import { LRUCache } from 'lru-cache'
import PQueue from 'p-queue'
import * as z from 'zod'

import { t } from '@main/i18n'
import type { FileAttachment, ImageAttachment } from '@main/utils/downloadAsBase64'
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
import { DINGTALK_FILE_BYTES, DingTalkApi, type DingTalkWebhook } from './DingTalkApi'

const TextContentSchema = z.object({ content: z.string() }) satisfies z.ZodType<RobotTextMessage['text']>

const IdentitySchema = z.object({
  msgId: z.string().min(1),
  robotCode: z.string().min(1),
  senderStaffId: z.string().regex(/^\S+$/),
  senderNick: z.string().default(''),
  conversationType: z.enum(['1', '2']),
  conversationId: z.string().regex(/^\S+$/),
  isInAtList: z.boolean().optional(),
  msgtype: z.string(),
  sessionWebhook: z.string().optional(),
  sessionWebhookExpiredTime: z.number().optional(),
  text: z.unknown().optional(),
  content: z.unknown().optional()
})
type IncomingMessage = z.infer<typeof IdentitySchema>
type ReplyContext = {
  webhook?: DingTalkWebhook
  expiresAt: number
  active: boolean
  finished: boolean
  text: string
  cardId?: string
  cardState: 'none' | 'delivering' | 'delivered' | 'uncertain'
  cardPromise?: Promise<void>
  flusher?: FlushController
}

export class DingTalkAdapter extends ChannelAdapter {
  private client?: DWClient
  private lifetime = new AbortController()
  private api!: DingTalkApi
  private alive = false
  private stopConnectWatch?: () => void
  private readonly cfg: ChannelAdapterConfig<'dingtalk'>['channelConfig']
  private readonly seen = new LRUCache<string, true>({ max: 1000, ttl: 10 * 60_000 })
  private readonly replies = new Map<string, ReplyContext>()
  private readonly downloads = new PQueue({ concurrency: 4 })
  private pending = 0
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(config: ChannelAdapterConfig<'dingtalk'>) {
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
    setMaxListeners(256, this.lifetime.signal)
    this.api = new DingTalkApi(this.cfg, this.lifetime.signal)
    this.alive = true
    const client = new DWClient({
      clientId: this.cfg.client_id,
      clientSecret: this.cfg.client_secret,
      subscriptions: [],
      keepAlive: true,
      autoReconnect: true,
      debug: false,
      maxPendingCallbackHandlers: 32,
      // Ignore SDK payloads and error objects: they can contain credentials or message bodies.
      logger: {
        info() {},
        warn: () => this.log.warn('DingTalk transport warning'),
        error: () => this.log.error('DingTalk transport error')
      }
    })
    this.client = client
    client.on('connectionState', (connected: boolean) => {
      if (!this.alive || this.client !== client) return
      if (connected) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = undefined
        this.markConnected()
      } else {
        this.markDisconnected(t('common.dingtalk_connection_lost'))
        this.reconnectTimer ??= setTimeout(() => this.retire(t('common.dingtalk_connection_failed')), 5 * 60_000)
        this.reconnectTimer.unref()
      }
    })
    client.on('connectionFailed', () => {
      if (this.alive && this.client === client) this.markDisconnected(t('common.dingtalk_connection_failed'))
    })
    client.registerCallbackListener(TOPIC_ROBOT, (frame) => this.admit(client, frame))
    const abort = () => this.retire()
    signal.addEventListener('abort', abort, { once: true })
    this.stopConnectWatch = () => signal.removeEventListener('abort', abort)
    try {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer)
          this.off('statusChange', changed)
          this.lifetime.signal.removeEventListener('abort', failed)
        }
        const failed = () => {
          cleanup()
          reject(new Error(t('common.dingtalk_connection_failed')))
        }
        const changed = () => {
          if (this.connected) {
            cleanup()
            resolve()
          }
        }
        const timer = setTimeout(failed, 30_000)
        timer.unref()
        this.on('statusChange', changed)
        this.lifetime.signal.addEventListener('abort', failed, { once: true })
        void client.connect().catch(failed)
      })
    } catch {
      this.retire()
      throw new Error(t('common.dingtalk_connection_failed'))
    }
  }

  private retire(reason?: string): void {
    this.alive = false
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
    this.stopConnectWatch?.()
    this.stopConnectWatch = undefined
    this.lifetime.abort()
    this.client?.disconnect()
    this.client?.removeAllListeners()
    this.client = undefined
    for (const context of this.replies.values()) this.closeContext(context)
    this.replies.clear()
    this.seen.clear()
    this.markDisconnected(reason)
  }

  protected async performDisconnect(): Promise<void> {
    this.retire()
  }

  private allowed(chatId: string, userId?: string): boolean {
    if (!/^(dm|group):\S+$/.test(chatId)) return false
    if (this.cfg.allowed_chat_ids.length && !this.cfg.allowed_chat_ids.includes(chatId)) return false
    const user = userId ?? (chatId.startsWith('dm:') ? chatId.slice(3) : undefined)
    return !user || !this.cfg.allowed_user_ids.length || this.cfg.allowed_user_ids.includes(user)
  }

  private key(chatId: string, messageId?: string | number): string {
    return JSON.stringify([chatId, messageId])
  }

  private admit(client: DWClient, frame: DWClientDownStream): void {
    if (!this.alive || this.client !== client || frame.headers.topic !== TOPIC_ROBOT) return
    const ack = () => client.socketCallBackResponse(frame.headers.messageId, { errcode: 0, errmsg: 'ok' })
    let parsed: ReturnType<typeof IdentitySchema.safeParse>
    try {
      if (frame.data.length > 256 * 1024) {
        ack()
        return
      }
      parsed = IdentitySchema.safeParse(JSON.parse(frame.data))
    } catch {
      ack()
      return
    }
    if (!parsed.success) {
      ack()
      return
    }
    const message = parsed.data
    const chatId = message.conversationType === '1' ? `dm:${message.senderStaffId}` : `group:${message.conversationId}`
    if (
      message.robotCode !== this.cfg.robot_code ||
      !this.allowed(chatId, message.senderStaffId) ||
      (message.conversationType === '2' && !message.isInAtList)
    ) {
      ack()
      return
    }
    const key = this.key(chatId, message.msgId)
    if (this.seen.has(key) || this.replies.has(key)) {
      ack()
      return
    }
    for (const [id, context] of this.replies) {
      if (!context.active && context.expiresAt <= Date.now()) this.replies.delete(id)
    }
    if (this.pending >= 32 || this.replies.size >= 1000) return
    this.replies.set(key, {
      webhook:
        message.sessionWebhook && message.sessionWebhookExpiredTime
          ? { url: message.sessionWebhook, expiresAt: message.sessionWebhookExpiredTime }
          : undefined,
      expiresAt: Date.now() + 10 * 60_000,
      active: false,
      finished: false,
      text: '',
      cardState: 'none'
    })
    this.seen.set(key, true)
    this.pending++
    ack()
    const signal = this.lifetime.signal
    void this.downloads
      .add(() => this.receive(chatId, message, signal), { signal })
      .catch(() => {
        if (!signal.aborted) this.log.warn('DingTalk inbound message failed')
      })
      .finally(() => {
        this.pending--
      })
  }

  private async receive(chatId: string, message: IncomingMessage, signal: AbortSignal): Promise<void> {
    const options = { replyToMessageId: message.msgId }
    let text = ''
    const images: ImageAttachment[] = []
    const files: FileAttachment[] = []
    const media: { downloadCode: string; image: boolean; filename?: string }[] = []
    const codeSchema = z.object({ downloadCode: z.string().min(1), fileName: z.string().optional() })
    try {
      switch (message.msgtype) {
        case 'text':
          text = TextContentSchema.parse(message.text).content
          break
        case 'audio': {
          const content = z.object({ recognition: z.string().trim().min(1) }).safeParse(message.content)
          if (!content.success) {
            await this.sendMessage(chatId, t('common.channel_voice_transcription_missing'), options)
            return
          }
          text = content.data.recognition
          break
        }
        case 'picture':
        case 'video':
        case 'file': {
          const item = codeSchema.parse(message.content)
          media.push({ downloadCode: item.downloadCode, image: message.msgtype === 'picture', filename: item.fileName })
          break
        }
        case 'richText': {
          const content = z
            .object({
              richText: z
                .array(
                  z.union([
                    z.object({ type: z.literal('picture'), downloadCode: z.string().min(1) }),
                    z.object({ type: z.literal('text').optional(), text: z.string() })
                  ])
                )
                .max(100)
            })
            .parse(message.content)
          for (const item of content.richText) {
            if ('text' in item) text += item.text
            else media.push({ downloadCode: item.downloadCode, image: true })
          }
          break
        }
        default:
          await this.sendMessage(chatId, t('common.dingtalk_unsupported_message'), options)
          return
      }
      if (media.length > 20) throw new Error('Too many attachments')
      let bytes = 0
      for (const item of media) {
        signal.throwIfAborted()
        const url = await this.api.downloadUrl(item.downloadCode)
        const result = await fetchRemoteBytes(url, {
          signal,
          timeoutMs: 30_000,
          maxBytes: Math.min(DINGTALK_FILE_BYTES, DINGTALK_FILE_BYTES * 2 - bytes),
          maxRedirects: 3
        })
        bytes += result.body.length
        if (!result.body.length) throw new Error('Empty attachment')
        const detected = await fileTypeFromBuffer(result.body)
        if (message.msgtype === 'video' && !detected?.mime.startsWith('video/')) throw new Error('Invalid video')
        if (item.image) {
          if (!detected?.mime.startsWith('image/')) throw new Error('Invalid image')
          images.push({ data: result.body.toString('base64'), media_type: detected.mime })
        } else {
          files.push({
            filename: sanitizeFilename(
              item.filename || (message.msgtype === 'video' ? `attachment.${detected!.ext}` : 'attachment')
            ),
            data: result.body.toString('base64'),
            media_type: detected?.mime ?? 'application/octet-stream',
            size: result.body.length
          })
        }
      }
    } catch {
      if (!signal.aborted) await this.sendMessage(chatId, t('common.dingtalk_attachment_failed'), options)
      return
    }
    if (signal.aborted || !this.alive) return
    text = text.trim()
    const identity = {
      chatId,
      conversationId: chatId,
      userId: message.senderStaffId,
      userName: message.senderNick,
      messageId: message.msgId
    }
    const command = /^\/(new|compact|help|whoami)(?:\s+(.*))?$/s.exec(text)
    if (command && message.msgtype !== 'audio' && !media.length) {
      const context = this.replies.get(this.key(chatId, message.msgId))
      if (context) this.closeContext(context)
      this.emit('command', {
        ...identity,
        command: command[1] as 'new' | 'compact' | 'help' | 'whoami',
        args: command[2]
      })
    } else if (text || media.length) this.emit('message', { ...identity, text, images, files })
  }

  private requireSend(chatId: string): void {
    if (!this.alive || !this.allowed(chatId)) throw new Error(t('common.dingtalk_delivery_failed'))
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    this.requireSend(chatId)
    const context = this.replies.get(this.key(chatId, opts?.replyToMessageId))
    // Keep UTF-8 code points intact; 1800 bytes leaves room under the text API's 2 KB limit.
    let chunk = ''
    for (const character of text) {
      if (Buffer.byteLength(chunk + character) > 1800) {
        await this.api.sendText(chatId, chunk, context?.webhook)
        chunk = ''
      }
      chunk += character
    }
    if (chunk) await this.api.sendText(chatId, chunk, context?.webhook)
  }

  override async sendFile(chatId: string, file: FileAttachment): Promise<void> {
    this.requireSend(chatId)
    await this.api.sendFile(chatId, file)
  }

  async sendTypingIndicator(chatId: string, opts?: SendMessageOptions): Promise<void> {
    this.requireSend(chatId)
    const context = this.replies.get(this.key(chatId, opts?.replyToMessageId))
    if (!context || context.finished || context.active) return
    context.active = true
    if (!this.cfg.card_template_id) return
    const api = this.api
    const signal = this.lifetime.signal
    context.cardId = randomUUID()
    context.cardPromise = (async () => {
      try {
        await api.createCard(context.cardId!)
      } catch {
        if (!signal.aborted) this.log.warn('DingTalk card creation failed; using text replies')
        return
      }
      if (signal.aborted || context.finished) return
      context.cardState = 'delivering'
      try {
        await api.deliverCard(chatId, context.cardId!)
        if (!signal.aborted) context.cardState = 'delivered'
      } catch {
        context.cardState = 'uncertain'
        if (!signal.aborted) this.log.warn('DingTalk card delivery failed; check the conversation before retrying')
      }
    })()
    await context.cardPromise
  }

  override async onTextUpdate(chatId: string, fullText: string, opts?: SendMessageOptions): Promise<void> {
    const context = this.replies.get(this.key(chatId, opts?.replyToMessageId))
    if (!context || context.finished || !this.alive) return
    context.text = fullText
    await this.sendTypingIndicator(chatId, opts)
    await context.cardPromise
    if (context.finished || context.cardState !== 'delivered') return
    context.flusher ??= new FlushController(async () => {
      if (context.finished || !this.alive) return
      try {
        await this.api.updateCard(context.cardId!, context.text, false)
      } catch {
        if (this.alive) this.log.warn('DingTalk card update failed')
      }
    })
    await context.flusher.throttledUpdate(500)
  }

  private closeContext(context: ReplyContext): void {
    context.finished = true
    context.flusher?.complete()
    context.flusher?.cancelPendingFlush()
  }

  private async finish(
    chatId: string,
    text: string,
    opts: SendMessageOptions | undefined,
    error: boolean,
    suppress = false
  ): Promise<boolean> {
    const context = this.replies.get(this.key(chatId, opts?.replyToMessageId))
    if (!context) return suppress
    this.closeContext(context)
    await context.cardPromise
    await context.flusher?.waitForFlush()
    context.active = false
    context.expiresAt = Date.now() + 10 * 60_000
    if (suppress || !this.alive) return true
    if (context.cardState === 'uncertain') throw new Error(t('common.dingtalk_delivery_failed'))
    if (context.cardState !== 'delivered') return false
    await this.api.updateCard(context.cardId!, text, true, error)
    return true
  }

  override async onStreamComplete(
    chatId: string,
    text: string,
    opts?: SendMessageOptions,
    outcome?: ChannelStreamOutcome
  ): Promise<boolean> {
    const content =
      outcome?.status === 'paused'
        ? `${text}\n\n${t('common.channel_stopped')}`.trim()
        : text || t('common.dingtalk_empty_response')
    if (!(await this.finish(chatId, content, opts, false))) await this.sendMessage(chatId, content, opts)
    return true
  }

  override async onStreamError(
    chatId: string,
    error: string,
    opts?: SendMessageOptions,
    options?: ChannelStreamErrorOptions
  ): Promise<boolean> {
    return this.finish(chatId, error, opts, true, options?.suppressDelivery)
  }
}

export function createDingTalkAdapter(config: ChannelAdapterConfig<'dingtalk'>): DingTalkAdapter {
  return new DingTalkAdapter(config)
}
