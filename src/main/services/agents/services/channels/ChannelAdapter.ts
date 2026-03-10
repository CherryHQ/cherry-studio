import { EventEmitter } from 'events'

export type ChannelMessageEvent = {
  chatId: string
  userId: string
  userName: string
  text: string
}

export type ChannelCommandEvent = {
  chatId: string
  userId: string
  userName: string
  command: 'new' | 'compact' | 'help'
  args?: string
}

export type SendMessageOptions = {
  parseMode?: 'MarkdownV2' | 'HTML'
  replyToMessageId?: number
}

export type ChannelAdapterConfig = {
  channelId: string
  agentId: string
  channelConfig: Record<string, unknown>
}

export abstract class ChannelAdapter extends EventEmitter {
  readonly channelId: string
  readonly agentId: string

  constructor(protected readonly config: ChannelAdapterConfig) {
    super()
    this.channelId = config.channelId
    this.agentId = config.agentId
  }

  abstract connect(): Promise<void>
  abstract disconnect(): Promise<void>
  abstract sendMessage(chatId: string, text: string, opts?: SendMessageOptions): Promise<void>
  /** Stream a partial/draft message to the chat. Same draftId updates the existing draft in-place. */
  abstract sendMessageDraft(chatId: string, draftId: number, text: string): Promise<void>
  abstract sendTypingIndicator(chatId: string): Promise<void>

  // Typed event emitter overrides
  override emit(event: 'message', data: ChannelMessageEvent): boolean
  override emit(event: 'command', data: ChannelCommandEvent): boolean
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args)
  }

  override on(event: 'message', listener: (data: ChannelMessageEvent) => void): this
  override on(event: 'command', listener: (data: ChannelCommandEvent) => void): this
  override on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener)
  }
}
