import type { StreamMessage } from '../protocol/frames'
import { StreamChannel } from '../StreamChannel'
import type { UtilityProcessStream, UtilityProcessStreamFrame, UtilityProcessStreamOptions } from '../types'

/** Host ownership lasts through close acknowledgement, independently of the result promise. */
export class StreamRequest implements UtilityProcessStream<
  UtilityProcessStreamFrame,
  UtilityProcessStreamFrame,
  unknown
> {
  private readonly result = Promise.withResolvers<unknown>()
  private readonly cleanup = Promise.withResolvers<void>()
  readonly completed = this.result.promise
  readonly closed = this.cleanup.promise
  readonly channel: StreamChannel
  private terminal = false
  private cancelled = false
  private finished = false
  private failed = false
  private readonly onAbort: () => void

  constructor(
    private readonly options: UtilityProcessStreamOptions,
    send: (message: StreamMessage) => void,
    private cancelRemote: (() => void) | undefined
  ) {
    this.channel = new StreamChannel(options.input, options.output, send, () => this.cancel())
    this.completed.catch(() => {})
    this.onAbort = () => {
      this.cancelWith(options.signal?.reason)
    }
    options.signal?.addEventListener('abort', this.onAbort, { once: true })
  }

  get output(): AsyncIterable<UtilityProcessStreamFrame> {
    return this.channel.output
  }
  write(frame: UtilityProcessStreamFrame): Promise<void> {
    return this.channel.write(frame)
  }
  finishInput(): Promise<void> {
    return this.channel.finish()
  }

  cancel(): Promise<void> {
    this.cancelWith(new DOMException('Stream cancelled', 'AbortError'))
    return this.closed
  }

  private cancelWith(reason: unknown): void {
    if (this.cancelled || this.finished) return
    this.cancelled = true
    this.fail(reason)
    this.cancelRemote?.()
  }

  receiveTerminal(outcome: { value: unknown } | { error: unknown }): void {
    if (this.terminal) throw new Error('Duplicate stream terminal')
    this.terminal = true
    if (this.failed) return
    if ('error' in outcome) this.fail(outcome.error)
    else {
      if (!this.channel.ended) throw new Error('Stream result before output EOF')
      this.result.resolve(outcome.value)
    }
  }

  acknowledge(): void {
    if (!this.terminal) throw new Error('Stream closed before terminal')
    this.close()
  }

  fail(reason: unknown): void {
    this.failed = true
    this.result.reject(reason)
    this.channel.abort(reason)
  }

  close(): void {
    this.finished = true
    this.cancelRemote = undefined
    this.options.signal?.removeEventListener('abort', this.onAbort)
    this.channel.detach()
    this.cleanup.resolve()
  }
}
