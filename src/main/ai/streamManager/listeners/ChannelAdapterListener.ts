import type { UIMessageChunk } from 'ai'

import { loggerService } from '@logger'
import { type ChannelAdapter, sanitizeChannelOutput, type SendMessageOptions } from '@main/ai/channels'
import { t } from '@main/i18n'
import type { UniqueModelId } from '@shared/data/types/model'

import type { StreamDoneResult, StreamErrorResult, StreamListener, StreamPausedResult } from '../types'

const logger = loggerService.withContext('ChannelAdapterListener')
const INCOMPLETE_CITATION_MARKER_PATTERN = /[ \t]?\[(?:c(?:i(?:t(?:e(?::[\w-]*)?)?)?)?)?$/

/** Bucket for text whose chunks carried no attempt id (direct feeds outside the stream manager). */
const UNTAGGED_ATTEMPT = -1

/** One queued live-update slot per attempt; a newer delta supersedes it. */
interface PendingUpdate {
  superseded: boolean
}

/** IM-channel sink (Discord / Slack / Feishu / Telegram / etc). */
export class ChannelAdapterListener implements StreamListener {
  readonly id: string
  /**
   * Text still owed to the channel, keyed by producing attempt. Dispatch awaits recipients one at
   * a time, so a wake can emit through this carried listener before an older terminal has even run.
   */
  private readonly pendingTextByAttempt = new Map<number, string>()
  /**
   * Whether this turn's terminal has been handed to the adapter. Scoped to the turn, not to the
   * listener: a chain-hold gap (`isTopicDone: false`) keeps the topic alive so the next turn
   * arrives on this same listener, and new output re-arms it.
   */
  private delivered = false
  /** Attempt ids whose terminal was already handed to the adapter. */
  private readonly deliveredAttempts = new Set<number>()
  /**
   * The execution this listener was created for, taken from its first terminal. Suppression covers
   * only that execution's failure: a wake carried into this listener later must stay deliverable
   * even while the run's terminal dispatch (and the deferred `enableErrorDelivery`) still runs.
   */
  private originatingAttemptId?: number
  /** Live-update slot per attempt bucket; the newest delta for an attempt supersedes the rest. */
  private readonly liveUpdates = new Map<number, PendingUpdate>()
  /**
   * Tail of this listener's channel-update chain. A chain-hold gap and a background wake can both
   * carry one listener into a successor execution while its predecessor's finalize is still
   * pending, and every adapter keeps ONE stream controller per chat — so an overlapping update
   * lands on the predecessor's card (Feishu) or is deleted by the predecessor's cleanup (Discord).
   */
  private updateChain: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly adapter: ChannelAdapter,
    private readonly platformChatId: string,
    /**
     * Skip the generic `Error: …` channel message on failure. Scheduled-task runs
     * deliver a richer `[Task failed] …` summary themselves (see `runAgentTask`), so
     * leaving this on would double-notify every subscribed channel.
     */
    private suppressErrorMessage = false,
    /** Response context for the inbound message, including thread placement where supported. */
    private readonly responseOptions?: SendMessageOptions
  ) {
    const responseKey = this.responseOptions?.replyToMessageId ?? 'unthreaded'
    this.id = `channel:${adapter.channelId}:${this.platformChatId}:${responseKey}`
  }

  /**
   * Hand error reporting back to the stream. A listener retained across a foreground settle outlives
   * the handler that owned failure notices, so a later failure reaching it must be delivered
   * normally instead of suppressed behind a reporter that can no longer run.
   */
  enableErrorDelivery(): void {
    this.suppressErrorMessage = false
  }

  /** Deliver a final message using the inbound message's response context. */
  private deliver(text: string): Promise<void> {
    return this.adapter.sendMessage(this.platformChatId, text, this.responseOptions)
  }

  private updateStream(text: string): Promise<void> {
    return this.adapter.onTextUpdate(this.platformChatId, text, this.responseOptions)
  }

  /**
   * Detach the text one execution owns from the buffer. Called at the terminal so a wake emitting
   * through this carried listener while the predecessor's finalize is still awaited never reads — or
   * ships — that wake's text as part of the predecessor's reply.
   */
  private takeOwnText(attemptId: number | undefined): string {
    let text = ''
    for (const [key, value] of this.pendingTextByAttempt) {
      // Only this exact attempt's bucket: a newer terminal must not consume an older attempt's
      // still-undelivered text. Untagged text has no other claimant, so any terminal may ship it.
      if (key !== UNTAGGED_ATTEMPT && key !== attemptId) continue
      text += value
      this.pendingTextByAttempt.delete(key)
      // The terminal consumes this attempt's buffer, so its queued draft is already obsolete.
      const slot = this.liveUpdates.get(key)
      if (slot) slot.superseded = true
    }
    return text
  }

  /** Text the given attempt owns: its own bucket plus untagged text — never a newer attempt's. */
  private ownedText(attemptId: number | undefined): string {
    let text = ''
    for (const [key, value] of this.pendingTextByAttempt) {
      if (key !== UNTAGGED_ATTEMPT && key !== attemptId) continue
      text += value
    }
    return text
  }

  private completeStream(text: string, status: 'success' | 'paused'): Promise<boolean> {
    const complete = this.updateChain.then(() =>
      this.adapter.onStreamComplete(this.platformChatId, text, this.responseOptions, { status })
    )
    this.updateChain = complete.catch(() => undefined)
    return complete
  }

  // oxlint-disable-next-line no-unused-vars
  onChunk(chunk: UIMessageChunk, _sourceModelId?: UniqueModelId, _anchorMessageId?: string, attemptId?: number): void {
    if (chunk.type === 'text-delta' && chunk.delta) {
      const key = attemptId ?? UNTAGGED_ATTEMPT
      this.pendingTextByAttempt.set(key, (this.pendingTextByAttempt.get(key) ?? '') + chunk.delta)
      // Fresh output owes the channel a delivery — a listener outlives one settle (a chain-hold gap
      // keeps the topic alive so the next turn carries this same listener).
      this.delivered = false
      // Best-effort streaming update; adapter chooses to throttle. Sanitize here — this is
      // the live delivery path that reaches the IM platform, so secrets (keys/tokens) must
      // be redacted before they leave. Queued behind `updateChain` like the terminal: the
      // adapter keeps ONE live controller per chat, so an update emitted while a predecessor's
      // finalize is still awaited would rewrite that predecessor's card content.
      //
      // One live slot per attempt: a superseded slot skips without touching the adapter and the
      // snapshot text is read from the buffer when the slot runs — so generation faster than the
      // network leaves one draft, not one per delta. Different attempts keep their queue order
      // and their own buckets, so the chain never merges or reorders across attempts.
      const previous = this.liveUpdates.get(key)
      if (previous) previous.superseded = true
      const slot: PendingUpdate = { superseded: false }
      this.liveUpdates.set(key, slot)
      const update = this.updateChain.then(() => {
        if (slot.superseded) return
        const { text } = sanitizeChannelOutput(this.ownedText(attemptId))
        return this.updateStream(text.replace(INCOMPLETE_CITATION_MARKER_PATTERN, ''))
      })
      this.updateChain = update.catch(() => undefined)
    }
  }

  async onDone(result: StreamDoneResult): Promise<void> {
    await this.finish(result.status, result.attemptId)
  }

  // oxlint-disable-next-line no-unused-vars
  async onPaused(_result: StreamPausedResult): Promise<void> {
    await this.finish('paused', _result.attemptId)
  }

  /**
   * Whether this terminal owes the channel a delivery. Fresh output re-arms delivery; beyond that,
   * each attempt owes exactly one delivery of its own, so a late older terminal (a wake's terminal
   * outran the foreground dispatch on a slower recipient) still ships, while a replay of a settled
   * attempt (payload-free held-topic close) stays deduplicated.
   */
  private owesDelivery(attemptId: number | undefined): boolean {
    if (!this.delivered) return true
    if (attemptId === undefined) return false
    return !this.deliveredAttempts.has(attemptId)
  }

  /** Remember which execution this listener serves — the first terminal it dispatches. */
  private noteTerminalAttempt(attemptId: number | undefined): void {
    if (this.originatingAttemptId === undefined && attemptId !== undefined) this.originatingAttemptId = attemptId
  }

  /**
   * Whether this error terminal is the one the handler reports itself. Untagged terminals (direct
   * feeds) carry no identity, so they keep the listener-wide flag.
   */
  private suppressesErrorFor(attemptId: number | undefined): boolean {
    if (!this.suppressErrorMessage) return false
    if (attemptId === undefined || this.originatingAttemptId === undefined) return true
    return attemptId === this.originatingAttemptId
  }

  private async finish(status: 'success' | 'paused', attemptId?: number): Promise<void> {
    this.noteTerminalAttempt(attemptId)
    // Take this execution's text BEFORE yielding: a predecessor's finalize can still be in flight
    // when a wake emits through this carried listener, and text arriving during the await below
    // belongs to that wake, not to this execution.
    const text = sanitizeChannelOutput(this.takeOwnText(attemptId)).text.trim()
    // The delivery decision and the terminal's chain position are both taken synchronously: a wake
    // chunk arriving while the outstanding draft settles must queue behind this terminal, not slip
    // ahead of it (or flip this execution's dedup decision under it).
    if (!this.owesDelivery(attemptId)) {
      await this.updateChain
      return
    }
    this.delivered = true
    if (attemptId !== undefined) this.deliveredAttempts.add(attemptId)
    try {
      const handled = await this.completeStream(text, status)
      if (!handled && text) {
        await this.deliver(status === 'paused' ? `${text}\n\n_(${t('common.channel_stopped')})_` : text)
      }
    } catch (err) {
      logger.error('Failed to deliver terminal message to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  async onError(result: StreamErrorResult): Promise<void> {
    // The suppression decision is taken once, synchronously at entry: a retained run arms error
    // delivery for FUTURE terminals (after the dispatch settles), and an arm landing mid-await must
    // not flip the terminal that is already being dispatched.
    this.noteTerminalAttempt(result.attemptId)
    const suppress = this.suppressesErrorFor(result.attemptId)
    // Same rule as `finish`: drop this execution's text before yielding, so a wake emitting through
    // this carried listener during the await does not inherit or re-ship it.
    this.takeOwnText(result.attemptId)
    // Same synchronous discipline as `finish`: decide delivery and reserve the terminal's chain
    // position before yielding — a wake chunk queued while the outstanding draft settles must land
    // behind this error terminal, not ahead of it on the chat's single controller.
    if (!this.owesDelivery(result.attemptId)) {
      await this.updateChain
      return
    }
    this.delivered = true
    if (result.attemptId !== undefined) this.deliveredAttempts.add(result.attemptId)
    const error = sanitizeChannelOutput(result.error.message ?? t('common.channel_message_processing_error')).text
    // Append the terminal to the chain like `completeStream` does: a wake reusing this listener
    // while the error card is still being written must queue behind it, not overwrite it.
    const terminal = this.updateChain.then(() =>
      this.adapter.onStreamError(this.platformChatId, error, this.responseOptions, {
        suppressDelivery: suppress
      })
    )
    this.updateChain = terminal.catch(() => undefined)
    try {
      const handled = await terminal
      if (!handled && !suppress) {
        await this.deliver(t('common.channel_error', { error }))
      }
    } catch (err) {
      logger.error('Failed to deliver error to channel', {
        channelId: this.adapter.channelId,
        chatId: this.platformChatId,
        err
      })
    }
  }

  isAlive(): boolean {
    return this.adapter.isStreamListenerAlive()
  }
}
