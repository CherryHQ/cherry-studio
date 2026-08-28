import { application } from '@application'
import * as Lark from '@larksuiteoapi/node-sdk'
import { WindowType } from '@main/core/window/types'
import { type FileAttachment, type ImageAttachment, MAX_FILE_SIZE_BYTES } from '@main/utils/downloadAsBase64'
import type { FeishuDomain } from '@shared/data/types/channel'
import { clampSurrogateBoundary } from '@shared/utils/text'
import { fileTypeFromBuffer } from 'file-type'

import { ChannelAdapter, type ChannelAdapterConfig, type SendMessageOptions } from '../../ChannelAdapter'
import { registerAdapterFactory } from '../../ChannelManager'
import { isSlashCommand } from '../../constants'
import { FILE_EXTENSION_MIME_MAP } from '../../utils'
import { registrationBegin, registrationPoll } from './FeishuAppRegistration'
import { createFeishuHttpInstance } from './FeishuHttpInstance'

const FEISHU_MAX_LENGTH = 4000
const FEISHU_PING_TIMEOUT_SECONDS = 10
const REACTION_THINKING = 'Typing'
const REACTION_DONE = 'OK'
const REACTION_ERROR = 'CRY'

type ChatReaction = {
  messageId: string
  reactionId: string
  emoji: string
}

function resolveDomain(domain: FeishuDomain): Lark.Domain {
  return domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu
}

function replyOptions(opts?: SendMessageOptions) {
  const replyTo = typeof opts?.replyToMessageId === 'string' ? opts.replyToMessageId : undefined
  return replyTo ? { replyTo, ...(opts?.replyInThread && { replyInThread: true }) } : undefined
}

function splitThreadMarkdown(text: string): string[] {
  if (text.length <= FEISHU_MAX_LENGTH) return [text]

  // Leave room to close and reopen a code fence so the SDK never splits a chunk itself.
  const contentLimit = FEISHU_MAX_LENGTH - 8
  const rawChunks: string[] = []
  let remaining = text
  while (remaining.length > contentLimit) {
    let splitIndex = remaining.lastIndexOf('\n\n', contentLimit - 2)
    if (splitIndex >= 0) splitIndex += 2
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf('\n', contentLimit - 1)
      if (splitIndex >= 0) splitIndex += 1
    }
    if (splitIndex <= 0) {
      splitIndex = remaining.lastIndexOf(' ', contentLimit - 1)
      if (splitIndex >= 0) splitIndex += 1
    }
    if (splitIndex <= 0) splitIndex = clampSurrogateBoundary(remaining, contentLimit)
    rawChunks.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex)
  }
  rawChunks.push(remaining)

  let fenceLanguage: string | null = null
  return rawChunks.map((chunk) => {
    const incomingFenceLanguage = fenceLanguage
    for (const line of chunk.split('\n')) {
      const match = /^```(\w*)\r?$/.exec(line)
      if (match) fenceLanguage = fenceLanguage === null ? match[1] : null
    }

    const suffix = fenceLanguage === null ? '' : chunk.endsWith('\n') ? '```' : '\n```'
    const preferredPrefix = incomingFenceLanguage === null ? '' : `\`\`\`${incomingFenceLanguage}\n`
    const prefix =
      preferredPrefix.length <= FEISHU_MAX_LENGTH - chunk.length - suffix.length ? preferredPrefix : '```\n'
    return `${prefix}${chunk}${suffix}`
  })
}

class FeishuStreamSession {
  private currentText = ''
  private disposed = false
  private resolveController!: (controller: Lark.MarkdownStreamController) => void
  private resolveCompletion!: () => void
  private readonly controllerReady: Promise<Lark.MarkdownStreamController>
  private readonly completion: Promise<void>
  private readonly stream: Promise<Lark.SendResult>

  constructor(channel: Lark.LarkChannel, chatId: string, opts?: SendMessageOptions) {
    this.controllerReady = new Promise((resolve) => {
      this.resolveController = resolve
    })
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve
    })
    this.stream = channel.stream(
      chatId,
      {
        markdown: async (controller) => {
          this.resolveController(controller)
          await this.completion
        }
      },
      replyOptions(opts)
    )
    void this.stream.catch(() => undefined)
  }

  async update(text: string): Promise<void> {
    if (this.disposed) return
    const controller = await Promise.race([
      this.controllerReady,
      this.stream.then(() => {
        throw new Error('Feishu stream completed before its controller became ready')
      })
    ])
    if (this.disposed) return
    this.currentText = text
    await controller.setContent(text)
  }

  async complete(text: string): Promise<void> {
    try {
      await this.update(text)
    } finally {
      this.resolveCompletion()
    }
    await this.stream
  }

  async error(message: string): Promise<void> {
    const displayText = this.currentText ? `${this.currentText}\n\n---\n**Error**: ${message}` : `**Error**: ${message}`
    try {
      await this.update(displayText)
    } catch {
      // The original agent error is already being reported; this best-effort card update must not replace it.
    } finally {
      this.resolveCompletion()
    }
    await this.stream.catch(() => undefined)
  }

  dispose(): void {
    this.disposed = true
    this.resolveCompletion()
  }
}

class FeishuAdapter extends ChannelAdapter {
  private channel: Lark.LarkChannel | null = null
  private appId: string
  private appSecret: string
  private readonly encryptKey: string
  private readonly verificationToken: string
  private readonly allowedChatIds: string[]
  private readonly domain: FeishuDomain
  private readonly streams = new Map<string, FeishuStreamSession>()
  private readonly chatReactions = new Map<string, ChatReaction>()

  constructor(config: ChannelAdapterConfig<'feishu'>) {
    super(config)
    const { app_id, app_secret, encrypt_key, verification_token, allowed_chat_ids, domain } = config.channelConfig
    this.appId = app_id
    this.appSecret = app_secret
    this.encryptKey = encrypt_key
    this.verificationToken = verification_token
    this.allowedChatIds = allowed_chat_ids ?? []
    this.domain = domain
    this.notifyChatIds = [...this.allowedChatIds]
  }

  protected override async checkReady(): Promise<boolean> {
    return !!(this.appId && this.appSecret)
  }

  protected override async performConnect(signal: AbortSignal): Promise<void> {
    if (!this.appId || !this.appSecret) {
      this.startRegistrationInBackground(signal)
      return
    }

    const sdkLogger: Lark.Logger = {
      error: (...args) => this.log.error('Feishu SDK error', { detail: args.map(String).join(' ') }),
      warn: (...args) => this.log.warn('Feishu SDK warning', { detail: args.map(String).join(' ') }),
      info: (...args) => this.log.info('Feishu SDK', { detail: args.map(String).join(' ') }),
      debug: (...args) => this.log.debug('Feishu SDK', { detail: args.map(String).join(' ') }),
      trace: (...args) => this.log.debug('Feishu SDK trace', { detail: args.map(String).join(' ') })
    }

    const channel = Lark.createLarkChannel({
      appId: this.appId,
      appSecret: this.appSecret,
      transport: 'websocket',
      ...((this.encryptKey || this.verificationToken) && {
        webhook: {
          ...(this.encryptKey && { encryptKey: this.encryptKey }),
          ...(this.verificationToken && { verificationToken: this.verificationToken })
        }
      }),
      domain: resolveDomain(this.domain),
      source: 'cherry-studio',
      logger: sdkLogger,
      loggerLevel: Lark.LoggerLevel.info,
      httpInstance: createFeishuHttpInstance(),
      policy: {
        dmMode: 'open',
        requireMention: true,
        respondToMentionAll: false
      },
      safety: { batch: { text: { delayMs: 0 } } },
      outbound: { textChunkLimit: FEISHU_MAX_LENGTH },
      wsConfig: { pingTimeout: FEISHU_PING_TIMEOUT_SECONDS }
    })
    this.channel = channel

    channel.on({
      message: (message) => {
        void this.handleMessage(message).catch((error) => {
          this.log.error('Failed to handle Feishu message', {
            chatId: message.chatId,
            messageId: message.messageId,
            error: error instanceof Error ? error.message : String(error)
          })
        })
      },
      reconnecting: () => {
        this.log.warn('Feishu WebSocket reconnecting')
      },
      reconnected: () => {
        this.markConnected()
        this.log.info('Feishu WebSocket reconnected')
      },
      reject: (event) => {
        this.log.debug('Feishu message rejected', { chatId: event.chatId, reason: event.reason })
      },
      error: (error) => {
        this.log.error('Feishu channel error', { error: error.message, code: error.code })
      }
    })

    try {
      await channel.connect()
    } catch (error) {
      await this.disconnectChannel(channel)
      if (signal.aborted || this.channel !== channel) return
      this.channel = null
      throw new Error(`Feishu WebSocket connection failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (signal.aborted || this.channel !== channel) {
      await this.disconnectChannel(channel)
      return
    }

    this.markConnected()
    this.log.info('Feishu bot connected (WebSocket)')
  }

  private startRegistrationInBackground(signal: AbortSignal): void {
    this.log.info('Starting Feishu app registration flow (background)', { domain: this.domain })
    this.sendQrToRenderer('', 'pending')

    registrationBegin(this.domain)
      .then(({ deviceCode, verificationUri, interval, expiresIn }) => {
        if (signal.aborted) return
        this.emit('qr', verificationUri)
        this.sendQrToRenderer(verificationUri, 'pending')
        return registrationPoll(this.domain, deviceCode, { interval, expiresIn, signal })
      })
      .then((result) => {
        if (!result || signal.aborted) return
        this.appId = result.appId
        this.appSecret = result.appSecret
        this.emit('credentials', { appId: result.appId, appSecret: result.appSecret })
        this.sendQrToRenderer('', 'confirmed', result.appId, result.appSecret)
        this.log.info('Feishu app registration completed')
      })
      .catch((error) => {
        if (signal.aborted) return
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.sendQrToRenderer('', /expired|timed out/i.test(errorMessage) ? 'expired' : 'error')
        this.log.warn(`Registration failed: ${errorMessage}`)
      })
  }

  private sendQrToRenderer(
    url: string,
    status: 'pending' | 'confirmed' | 'expired' | 'disconnected' | 'error',
    appId?: string,
    appSecret?: string
  ): void {
    application.get('IpcApiService').broadcastToType(WindowType.Main, 'channel.feishu.qr_login', {
      channelId: this.channelId,
      url,
      status,
      appId,
      appSecret
    })
  }

  protected override async performDisconnect(): Promise<void> {
    for (const stream of this.streams.values()) stream.dispose()
    this.streams.clear()
    this.chatReactions.clear()

    const channel = this.channel
    this.channel = null
    if (channel) {
      await this.disconnectChannel(channel)
    }
    this.sendQrToRenderer('', 'disconnected')
    this.log.info('Feishu bot stopped')
  }

  async sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void> {
    if (opts?.replyToMessageId) {
      await this.transitionChatReaction(chatId, REACTION_DONE, [REACTION_THINKING], opts)
      this.chatReactions.delete(this.responseKey(chatId, opts))
    }
    const options = replyOptions(opts)
    const messages = opts?.replyInThread && options ? splitThreadMarkdown(text) : [text]
    for (const message of messages) {
      await this.getChannel().send(chatId, { markdown: message }, options)
    }
  }

  override async sendFile(chatId: string, file: FileAttachment): Promise<void> {
    const source = Buffer.from(file.data, 'base64')
    if (file.media_type.startsWith('image/')) {
      await this.getChannel().send(chatId, { image: { source } })
    } else {
      await this.getChannel().send(chatId, { file: { source, fileName: file.filename } })
    }
    this.log.info('Sent file', { chatId, filename: file.filename, size: file.size, mediaType: file.media_type })
  }

  async sendTypingIndicator(chatId: string, opts?: SendMessageOptions): Promise<void> {
    if (!opts?.replyToMessageId) return
    await this.setChatReaction(chatId, REACTION_THINKING, opts)
  }

  private responseKey(chatId: string, opts?: SendMessageOptions): string {
    return typeof opts?.replyToMessageId === 'string' ? `${chatId}:${opts.replyToMessageId}` : chatId
  }

  private async setChatReaction(chatId: string, emoji: string, opts?: SendMessageOptions): Promise<void> {
    const messageId = typeof opts?.replyToMessageId === 'string' ? opts.replyToMessageId : undefined
    if (!messageId || !this.channel) return

    const reactionKey = this.responseKey(chatId, opts)
    const existing = this.chatReactions.get(reactionKey)
    if (existing?.messageId === messageId && existing.emoji === emoji) return
    if (existing) await this.clearChatReaction(reactionKey)

    try {
      const reactionId = await this.channel.addReaction(messageId, emoji)
      this.chatReactions.set(reactionKey, { messageId, reactionId, emoji })
    } catch (error) {
      this.log.debug('Failed to add status reaction', {
        chatId,
        messageId,
        emoji,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async transitionChatReaction(
    chatId: string,
    emoji: string,
    from: string[],
    opts?: SendMessageOptions
  ): Promise<void> {
    const existing = this.chatReactions.get(this.responseKey(chatId, opts))
    if (existing && from.includes(existing.emoji)) await this.setChatReaction(chatId, emoji, opts)
  }

  private async clearChatReaction(reactionKey: string): Promise<void> {
    const reaction = this.chatReactions.get(reactionKey)
    if (!reaction) return
    this.chatReactions.delete(reactionKey)
    if (!this.channel) return

    try {
      await this.channel.removeReaction(reaction.messageId, reaction.reactionId)
    } catch (error) {
      this.log.debug('Failed to remove status reaction', {
        reactionKey,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  override async onTextUpdate(chatId: string, fullText: string, opts?: SendMessageOptions): Promise<void> {
    const streamKey = this.responseKey(chatId, opts)
    let stream = this.streams.get(streamKey)
    if (!stream) {
      stream = new FeishuStreamSession(this.getChannel(), chatId, opts)
      this.streams.set(streamKey, stream)
    }
    await stream.update(fullText)
  }

  override async onStreamComplete(chatId: string, finalText: string, opts?: SendMessageOptions): Promise<boolean> {
    const streamKey = this.responseKey(chatId, opts)
    if (opts?.replyToMessageId) {
      await this.transitionChatReaction(chatId, REACTION_DONE, [REACTION_THINKING], opts)
      this.chatReactions.delete(streamKey)
    }
    const stream = this.streams.get(streamKey)
    if (!stream) return false
    try {
      await stream.complete(finalText)
      return true
    } catch (error) {
      this.log.warn('Failed to finalize Feishu stream, falling back to a message', {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      })
      return false
    } finally {
      this.streams.delete(streamKey)
    }
  }

  override async onStreamError(chatId: string, error: string, opts?: SendMessageOptions): Promise<void> {
    const streamKey = this.responseKey(chatId, opts)
    if (opts?.replyToMessageId) {
      await this.transitionChatReaction(chatId, REACTION_ERROR, [REACTION_THINKING, REACTION_DONE], opts)
      this.chatReactions.delete(streamKey)
    }
    const stream = this.streams.get(streamKey)
    if (stream) {
      try {
        await stream.error(error)
      } finally {
        this.streams.delete(streamKey)
      }
      return
    }
    await this.getChannel().send(chatId, { markdown: `**Error**: ${error}` }, replyOptions(opts))
  }

  private async handleMessage(message: Lark.NormalizedMessage): Promise<void> {
    if (this.allowedChatIds.length > 0 && !this.allowedChatIds.includes(message.chatId)) {
      this.log.debug('Dropping message from unauthorized chat', { chatId: message.chatId })
      return
    }

    const text = message.content.trim()
    const conversationId = message.threadId
    const conversation = conversationId ? { conversationId: `thread:${conversationId}`, replyInThread: true } : {}
    if (isSlashCommand(text)) {
      const parts = text.split(/\s+/)
      this.emit('command', {
        chatId: message.chatId,
        ...conversation,
        userId: message.senderId,
        userName: message.senderName ?? '',
        messageId: message.messageId,
        command: parts[0].slice(1).toLowerCase() as 'new' | 'compact' | 'help' | 'whoami',
        args: parts.slice(1).join(' ') || undefined
      })
      return
    }

    const { images, files } = await this.downloadResources(message)
    if (!text && images.length === 0 && files.length === 0) return
    this.emit('message', {
      chatId: message.chatId,
      ...conversation,
      userId: message.senderId,
      userName: message.senderName ?? '',
      messageId: message.messageId,
      text,
      ...(images.length > 0 ? { images } : {}),
      ...(files.length > 0 ? { files } : {})
    })
  }

  private async downloadResources(
    message: Lark.NormalizedMessage
  ): Promise<{ images: ImageAttachment[]; files: FileAttachment[] }> {
    const images: ImageAttachment[] = []
    const files: FileAttachment[] = []

    for (const resource of message.resources) {
      if (resource.type === 'sticker') {
        this.log.debug('Skipping unsupported Feishu sticker resource', { fileKey: resource.fileKey })
        continue
      }
      try {
        const resourceResponse = await this.getChannel().rawClient.im.v1.messageResource.get({
          path: { message_id: message.messageId, file_key: resource.fileKey },
          params: { type: resource.type === 'image' ? 'image' : 'file' }
        })
        const chunks: Buffer[] = []
        let size = 0
        for await (const chunk of resourceResponse.getReadableStream()) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          size += buffer.length
          if (size > MAX_FILE_SIZE_BYTES) {
            this.log.warn('Feishu resource too large', { fileKey: resource.fileKey, size })
            break
          }
          chunks.push(buffer)
        }
        const buffer = Buffer.concat(chunks)
        if (size > MAX_FILE_SIZE_BYTES) continue

        const detected = await fileTypeFromBuffer(buffer)
        if (resource.type === 'image') {
          images.push({ data: buffer.toString('base64'), media_type: detected?.mime ?? 'image/png' })
          continue
        }

        const filename = resource.fileName ?? `${resource.type}${detected?.ext ? `.${detected.ext}` : ''}`
        const extension = filename.includes('.') ? filename.split('.').pop()!.toLowerCase() : ''
        files.push({
          filename,
          data: buffer.toString('base64'),
          media_type: detected?.mime ?? FILE_EXTENSION_MIME_MAP[extension] ?? 'application/octet-stream',
          size: buffer.length
        })
      } catch (error) {
        this.log.warn('Failed to download Feishu resource', {
          fileKey: resource.fileKey,
          resourceType: resource.type,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    return { images, files }
  }

  private getChannel(): Lark.LarkChannel {
    if (!this.channel) throw new Error('Feishu channel is not connected')
    return this.channel
  }

  private async disconnectChannel(channel: Lark.LarkChannel): Promise<void> {
    await channel.disconnect().catch(() => undefined)
    channel.rawWsClient?.close({ force: true })
  }
}

registerAdapterFactory('feishu', (channel, agentId) => {
  return new FeishuAdapter({
    channelId: channel.id,
    channelType: channel.type,
    agentId,
    channelConfig: channel.config
  })
})
