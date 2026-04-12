import type { SerializedError } from '@shared/types/error'

import type { StreamDoneResult, StreamSink } from '../types'

/**
 * Placeholder for the Channel (Discord / Slack / Feishu) adapter sink.
 *
 * Will be implemented in Step 2.7 when ChannelMessageHandler integration lands.
 * The interface is defined now so that the Broker types compile and
 * ChannelMessageHandler can reference it in its planning.
 */

export interface ChannelAdapter {
  readonly channelId: string
  readonly connected: boolean
  sendMessage(platformChatId: string, text: string): Promise<void>
}

export class ChannelAdapterSink implements StreamSink {
  readonly id: string

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly platformChatId: string
  ) {
    this.id = `channel:${adapter.channelId}:${this.platformChatId}`
  }

  onChunk(): void {
    // Most IM platforms don't support message edit — no per-chunk push.
  }

  async onDone(_result: StreamDoneResult): Promise<void> {
    // TODO (Step 2.7): extract plain text from finalMessage, send to adapter
  }

  async onError(_error: SerializedError): Promise<void> {
    // TODO (Step 2.7): send error message to adapter
  }

  isAlive(): boolean {
    return this.adapter.connected
  }
}
