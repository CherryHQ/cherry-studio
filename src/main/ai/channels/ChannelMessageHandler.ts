import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { loggerService } from '@logger'
import { buildAgentSessionTopicId } from '@main/ai/agentSession/topic'
import {
  isAgentSessionWorkspaceError,
  prepareAgentSessionWorkspaceDirectory
} from '@main/ai/runtime/agentSessionWorkspace'
import { ChannelAdapterListener, startAgentSessionRun, type StreamListener } from '@main/ai/streamManager'
import type { Disposable } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import type { FileAttachment, ImageAttachment } from '@main/utils/downloadAsBase64'
import { AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY } from '@shared/ai/agentSessionSlashCommands'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent, SendMessageOptions } from './ChannelAdapter'
import { SLASH_COMMANDS } from './constants'

const logger = loggerService.withContext('ChannelMessageHandler')

class AgentSessionRunNotStartedError extends Error {
  constructor(readonly reason: 'busy' | 'session-invalid') {
    super(reason === 'busy' ? t('agent.session.run_status.busy') : t('agent.session.run_status.unavailable'))
    this.name = 'AgentSessionRunNotStartedError'
  }
}

const TYPING_INTERVAL_MS = 4000

/** Max number of entries in the session tracker before evicting oldest entries. */
const SESSION_TRACKER_MAX_SIZE = 500

/**
 * How long to wait for additional messages before flushing a batch.
 * IM users (especially on WeChat) often send multiple short messages in rapid
 * succession. Debouncing prevents each fragment from triggering a separate
 * agent round-trip and avoids concurrent stream interleaving.
 */
const MESSAGE_BATCH_DELAY_MS = 8000
// Cap a sender's debounce extension so another sender in the conversation cannot wait forever.
const MESSAGE_BATCH_MAX_DELAY_MS = 16000

type BatchResolver = {
  resolve: () => void
  reject: (err: unknown) => void
}

type PendingBatch = {
  adapter: ChannelAdapter
  messages: ChannelMessageEvent[]
  timer: ReturnType<typeof setTimeout>
  deadline: number
  resolvers: BatchResolver[]
  release: () => void
  cancelled: boolean
  admissionId: string
  admit: () => void
}

function conversationIdOf(event: Pick<ChannelMessageEvent | ChannelCommandEvent, 'chatId' | 'conversationId'>): string {
  return event.conversationId ?? event.chatId
}

function conversationKey(agentId: string, channelId: string, conversationId: string): string {
  return `${agentId}:${channelId}:${conversationId}`
}

function responseOptionsFor(
  event: Pick<ChannelMessageEvent | ChannelCommandEvent, 'messageId' | 'replyInThread'>
): SendMessageOptions {
  return {
    replyToMessageId: event.messageId,
    ...(event.replyInThread && { replyInThread: true })
  }
}

function streamResponseOptionsFor(
  event: Pick<ChannelMessageEvent | ChannelCommandEvent, 'messageId' | 'replyInThread'>
): SendMessageOptions | undefined {
  return event.messageId !== undefined || event.replyInThread ? responseOptionsFor(event) : undefined
}

export class ChannelMessageHandler {
  // TODO: in v2 use cacheService
  private readonly sessionTracker = new Map<string, string>() // `${agentId}:${channelId}:${conversationId}` -> sessionId
  private readonly pendingResolutions = new Map<string, Promise<AgentSessionEntity | null>>()
  /** Per-chat debounce buffer — accumulates rapid messages before flushing */
  private readonly pendingBatches = new Map<string, PendingBatch>()
  /** Per-sender serial queue; shared-session admission rejects cross-sender overlap visibly. */
  private readonly chatQueues = new Map<string, Promise<void>>()
  /** Active abort controllers per session — allows renderer to abort via IPC */
  private readonly activeAbortControllers = new Map<string, AbortController>()
  /** Write-quiesce holds (backup restore). Quiesced ⇔ non-empty. See `pause()`. */
  private readonly pauseHolds = new Set<symbol>()
  /** Queued work whose write admission hasn't landed yet — `drainInFlight`'s wait-set.
   *  Resolved (idempotently) once a turn is admitted, a command write completes, or processing
   *  exits early; NOT held open for the full turn (post-admission stream writes are
   *  AiStreamManager's drain). Entries self-remove on resolve. */
  private readonly pendingAdmissions = new Map<string, Promise<void>>()
  private admissionSeq = 0

  // ── Write quiesce (backup restore) ───────────────────────────────
  // Contract shared with JobManager / AiStreamManager / AgentSessionRuntimeService
  // (issues #16849/#16850). Every adapter acks at the transport layer on receipt,
  // so a buffered batch is the only copy of its messages — pause() therefore
  // FLUSHES the buffers immediately (never cancels), and messages arriving while
  // quiesced are dropped with a warning (they'd die with the relaunch anyway).

  /** True while any write-quiesce hold is live. */
  get isWriteQuiesced(): boolean {
    return this.pauseHolds.size > 0
  }

  /**
   * Stop channel intake and immediately flush the buffered debounce batches (not waiting out
   * the 8 s timer) so their agent-turn admissions land before the orchestrator pauses the AI
   * writers. No resume() — dispose your own hold. There is no release compensation: intake
   * dropped while quiesced is not replayable.
   *
   * ORCHESTRATION CONTRACT: flush only SCHEDULES each batch's admission (`processIncoming` runs on
   * the per-chat queue microtask); `pause()` returning does NOT mean the batches admitted. The
   * orchestrator MUST `await drainInFlight()` to completion BEFORE it pauses the AI writers —
   * otherwise a still-in-flight batch can reach `startAgentSessionRun` after the AI gate closes
   * and lose an already ACKed message.
   */
  pause(reason?: string): Disposable {
    const token = Symbol(reason ?? 'channel-intake-pause')
    const firstHold = this.pauseHolds.size === 0
    this.pauseHolds.add(token)
    logger.info('Channel intake paused', { reason: reason ?? null, holds: this.pauseHolds.size })
    if (firstHold) this.flushAllPendingBatches()
    return {
      dispose: () => {
        if (!this.pauseHolds.delete(token)) return
        logger.info('Channel intake pause hold released', { reason: reason ?? null, holds: this.pauseHolds.size })
      }
    }
  }

  /**
   * Await queued work admissions, bounded by timeoutMs. Never rejects. A single
   * snapshot suffices (unlike the AI writers' fixed-point drains): intake is gated and pause()
   * already flushed every buffer synchronously, so the admission set can only shrink.
   *
   * PRECONDITION: hold a live pause() hold — without one the verdict is a point-in-time
   * snapshot (warned, not thrown).
   */
  async drainInFlight(opts: { timeoutMs: number }): Promise<{ stragglerIds: string[] }> {
    if (!this.isWriteQuiesced) {
      logger.warn('drainInFlight called without an active pause hold — the verdict is a point-in-time snapshot')
    }
    const snapshot = [...this.pendingAdmissions.entries()]
    if (snapshot.length === 0) return { stragglerIds: [] }

    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<'timeout'>((resolve) => {
      timeoutHandle = setTimeout(() => resolve('timeout'), opts.timeoutMs)
    })
    try {
      const winner = await Promise.race([
        Promise.allSettled(snapshot.map(([, admission]) => admission)).then(() => 'done' as const),
        timeout
      ])
      if (winner === 'done') return { stragglerIds: [] }
      const stragglerIds = snapshot.filter(([id]) => this.pendingAdmissions.has(id)).map(([id]) => id)
      logger.warn('drainInFlight timed out with unadmitted channel work', {
        timeoutMs: opts.timeoutMs,
        stragglerIds
      })
      return { stragglerIds }
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle)
    }
  }

  /** Advisory pre-flight enumeration for the restore orchestrator. Read-only, in-memory. */
  listActiveWork(): Array<{ id: string; summary: string }> {
    const work: Array<{ id: string; summary: string }> = []
    const bufferedAdmissionIds = new Set<string>()
    for (const [batchKey, batch] of this.pendingBatches) {
      work.push({ id: batchKey, summary: `buffered=${batch.messages.length}` })
      bufferedAdmissionIds.add(batch.admissionId)
    }
    for (const admissionId of this.pendingAdmissions.keys()) {
      if (bufferedAdmissionIds.has(admissionId)) continue
      work.push({
        id: admissionId,
        summary: admissionId.startsWith('command:')
          ? 'queued command awaiting write admission'
          : 'flushed batch awaiting turn admission'
      })
    }
    return work
  }

  /** First-hold bookkeeping: fire every buffered batch now instead of at its debounce timer. */
  private flushAllPendingBatches(): void {
    const keys = [...this.pendingBatches.keys()]
    if (keys.length === 0) return
    logger.info('Flushing buffered channel batches for write quiesce', { count: keys.length })
    for (const batchKey of keys) {
      const batch = this.pendingBatches.get(batchKey)
      if (!batch) continue
      clearTimeout(batch.timer)
      this.flushBatch(batchKey)
    }
  }

  handleIncoming(adapter: ChannelAdapter, message: ChannelMessageEvent): Promise<void> {
    // Write-quiesce intake gate. Resolve (don't reject) — a rejection would trigger the
    // adapters' misleading "an error occurred" reply for a deliberate drop.
    if (this.isWriteQuiesced) {
      logger.warn('Channel message dropped: intake is write-quiesced (backup restore in progress)', {
        agentId: adapter.agentId,
        channelId: adapter.channelId,
        chatId: message.chatId
      })
      return Promise.resolve()
    }
    const batchKey = `${conversationKey(adapter.agentId, adapter.channelId, conversationIdOf(message))}:${message.userId}`

    return new Promise<void>((resolve, reject) => {
      const existing = this.pendingBatches.get(batchKey)
      if (existing) {
        // Append to existing batch and reset the debounce timer
        existing.messages.push(message)
        existing.resolvers.push({ resolve, reject })
        clearTimeout(existing.timer)
        existing.timer = setTimeout(() => this.flushBatch(batchKey), Math.max(0, existing.deadline - Date.now()))
        logger.debug('Message appended to pending batch', {
          batchKey,
          batchSize: existing.messages.length
        })
        return
      }

      // Start a new batch
      let release!: () => void
      const ready = new Promise<void>((resolve) => {
        release = resolve
      })
      const admissionId = `${batchKey}#${++this.admissionSeq}`
      let admit!: () => void
      const admission = new Promise<void>((resolve) => {
        admit = resolve
      })
      this.pendingAdmissions.set(admissionId, admission)
      void admission.then(() => this.pendingAdmissions.delete(admissionId))

      const batch: PendingBatch = {
        adapter,
        messages: [message],
        timer: setTimeout(() => this.flushBatch(batchKey), MESSAGE_BATCH_DELAY_MS),
        deadline: Date.now() + MESSAGE_BATCH_MAX_DELAY_MS,
        resolvers: [{ resolve, reject }],
        release,
        cancelled: false,
        admissionId,
        admit
      }
      this.pendingBatches.set(batchKey, batch)
      this.enqueueBatch(batchKey, batch, ready)
    })
  }

  private flushBatch(batchKey: string): void {
    const batch = this.pendingBatches.get(batchKey)
    if (!batch) return
    this.pendingBatches.delete(batchKey)
    batch.release()
  }

  private enqueueBatch(batchKey: string, batch: PendingBatch, ready: Promise<void>): void {
    const queueKey = conversationKey(
      batch.adapter.agentId,
      batch.adapter.channelId,
      conversationIdOf(batch.messages[0])
    )
    const prev = this.chatQueues.get(queueKey) ?? Promise.resolve()
    const current = prev
      .then(async () => {
        await ready
        if (batch.cancelled) return

        const merged = this.mergeMessages(batch.messages)
        if (batch.messages.length > 1) {
          logger.info('Flushing merged message batch', { batchKey, messageCount: batch.messages.length })
        }
        await this.processIncoming(batch.adapter, merged, batch.admit)
      })
      .then(
        () => batch.resolvers.forEach((r) => r.resolve()),
        (err) => batch.resolvers.forEach((r) => r.reject(err))
      )
      .finally(() => {
        // Clean up queue entry when no newer work has been enqueued
        if (this.chatQueues.get(queueKey) === settled) {
          this.chatQueues.delete(queueKey)
        }
      })
    // Log errors but keep the queue chain intact
    const settled = current.catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('Channel message processing failed', { batchKey, error: errMsg })

      // Best-effort: notify the user with a generic message (no internal details)
      try {
        const adapter = batch.adapter
        const message = batch.messages.at(-1)
        const chatId = message?.chatId
        if (adapter && message && chatId) {
          adapter
            .sendMessage(chatId, t('common.channel_message_processing_error'), {
              ...responseOptionsFor(message)
            })
            .catch((sendErr) => {
              logger.debug('Failed to send error notification to channel', {
                chatId,
                error: sendErr instanceof Error ? sendErr.message : String(sendErr)
              })
            })
        }
      } catch {
        // Do not let error notification break the queue
      }
    })
    this.chatQueues.set(queueKey, settled)
  }

  private mergeMessages(messages: ChannelMessageEvent[]): ChannelMessageEvent {
    if (messages.length === 1) return messages[0]

    const first = messages[0]
    const mergedText = messages
      .map((m) => m.text)
      .filter(Boolean)
      .join('\n')
    const mergedImages = messages.flatMap((m) => m.images ?? [])
    const mergedFiles = messages.flatMap((m) => m.files ?? [])
    // Reply against the most recent message in the batch: freshest passive-reply window and the
    // closest match to "what the user just finished saying".
    const messageId = messages[messages.length - 1].messageId

    return {
      chatId: first.chatId,
      ...(first.conversationId ? { conversationId: first.conversationId } : {}),
      userId: first.userId,
      userName: first.userName,
      text: mergedText,
      ...(messageId ? { messageId } : {}),
      ...(first.replyInThread ? { replyInThread: true } : {}),
      ...(mergedImages.length > 0 ? { images: mergedImages } : {}),
      ...(mergedFiles.length > 0 ? { files: mergedFiles } : {})
    }
  }

  private async processIncoming(
    adapter: ChannelAdapter,
    message: ChannelMessageEvent,
    onAdmitted?: () => void
  ): Promise<void> {
    const { agentId } = adapter

    try {
      const session = await this.resolveSession(agentId, adapter.channelId, conversationIdOf(message))
      if (!session) {
        logger.error('Failed to resolve session', { agentId })
        await adapter
          .sendMessage(message.chatId, t('common.channel_session_resolution_error'), {
            ...responseOptionsFor(message)
          })
          .catch((err) => {
            logger.debug('Failed to send session-error notification to channel', {
              chatId: message.chatId,
              error: err instanceof Error ? err.message : String(err)
            })
          })
        return
      }

      // Resolve agent for cognitive config (model / configuration / mcps / disabledTools).
      // Workspace is read from the session itself (CMA Environment binding).
      // An orphan session (`agentId === null`) cannot run; skip it.
      if (!session.agentId) {
        logger.error('Channel message hit an orphan session', { sessionId: session.id })
        return
      }
      const agent = agentService.getAgent(session.agentId)
      if (!agent) {
        logger.error('Agent not found for session', { sessionId: session.id, agentId: session.agentId })
        return
      }

      // TODO(channel-perm-override): channel-level permission_mode used to mutate
      // session.configuration in-place; with config now living on agent, this
      // override needs to flow as a per-dispatch option instead. Tracked separately.

      const workDir = session.workspace?.path
      const hasAttachments = !!(message.images?.length || message.files?.length)
      if (hasAttachments) {
        try {
          await prepareAgentSessionWorkspaceDirectory(session)
        } catch (error) {
          if (isAgentSessionWorkspaceError(error)) {
            await adapter.sendMessage(message.chatId, error.message, responseOptionsFor(message)).catch(() => {})
          }
          throw error
        }
      }

      // Save images to agent workspace so the agent can read them via the Read tool
      let imagePaths: string[] = []
      if (message.images && message.images.length > 0 && workDir) {
        try {
          imagePaths = await this.persistImages(workDir, message.images)
          logger.info('Persisted channel images to workspace', {
            agentId,
            count: imagePaths.length,
            dir: path.join(workDir, '.cherry-studio', 'channel-images')
          })
        } catch (error) {
          logger.warn('Failed to persist channel images', {
            agentId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      // Save files to agent workspace so the agent can read them via the Read tool
      let filePaths: string[] = []
      if (message.files && message.files.length > 0 && workDir) {
        try {
          filePaths = await this.persistFiles(workDir, message.files)
          logger.info('Persisted channel files to workspace', {
            agentId,
            count: filePaths.length,
            dir: path.join(workDir, '.cherry-studio', 'channel-files')
          })
        } catch (error) {
          logger.warn('Failed to persist channel files', {
            agentId,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }

      // Build text with attachment file paths appended so the agent knows where they are saved
      let textWithAttachments = message.text
      if (imagePaths.length > 0) {
        textWithAttachments += `\n\n[Attached images saved to workspace]\n${imagePaths.map((p) => `- ${p}`).join('\n')}`
      }
      if (filePaths.length > 0) {
        textWithAttachments += `\n\n[Attached files saved to workspace]\n${filePaths.map((p) => `- ${p}`).join('\n')}`
      }

      const abortController = new AbortController()
      this.activeAbortControllers.set(session.id, abortController)

      // Show typing indicator immediately and keep refreshing every 4s
      const responseOptions = streamResponseOptionsFor(message)
      adapter.sendTypingIndicator(message.chatId, responseOptions).catch(() => {})
      const typingInterval = setInterval(
        () => adapter.sendTypingIndicator(message.chatId, responseOptions).catch(() => {}),
        TYPING_INTERVAL_MS
      )

      try {
        // Delivery (streaming updates + the sanitized finalize) is owned by the
        // `ChannelAdapterListener` registered inside `collectStreamResponse`; we only await
        // turn completion here. (The old post-hoc finalize was dead — the sentinel's `c.text`
        // read never accumulated — and reviving it would double-send.)
        await this.collectStreamResponse(
          session,
          textWithAttachments,
          abortController,
          adapter,
          message.chatId,
          responseOptions,
          onAdmitted
        )
      } catch (streamError) {
        const streamErrorMessage = streamError instanceof Error ? streamError.message : String(streamError)
        if (isAgentSessionWorkspaceError(streamError) || streamError instanceof AgentSessionRunNotStartedError) {
          // Thrown before streaming starts (validateSession), so no controller exists yet and
          // onStreamError is a no-op on most adapters — send a plain message so the inbound
          // message isn't silently dropped on Telegram/WeChat/QQ/Discord/Slack.
          adapter.sendMessage(message.chatId, streamErrorMessage, responseOptionsFor(message)).catch(() => {})
        } else {
          // Mid-stream error: let the adapter update its streaming UI.
          adapter.onStreamError(message.chatId, streamErrorMessage, responseOptions).catch(() => {})
        }
        throw streamError
      } finally {
        this.activeAbortControllers.delete(session.id)
        clearInterval(typingInterval)
      }
    } catch (error) {
      const context = {
        agentId,
        chatId: message.chatId,
        error: error instanceof Error ? error.message : String(error)
      }
      if (error instanceof AgentSessionRunNotStartedError) {
        logger.warn('Channel message was not admitted', context)
      } else {
        logger.error('Error handling incoming message', context)
      }
    } finally {
      // Backstop for the admission deferred: every early return / swallowed error above
      // settles it too, so the write-quiesce drain never hangs on a bailed batch. No-op when
      // `collectStreamResponse` already fired it at the real admission point.
      onAdmitted?.()
    }
  }

  async handleCommand(adapter: ChannelAdapter, command: ChannelCommandEvent): Promise<void> {
    // Write-quiesce intake gate — commands write too (`/new` creates session+channel rows,
    // `/compact` runs a full turn). Resolve, don't reject (see `handleIncoming`).
    if (this.isWriteQuiesced) {
      logger.warn('Channel command dropped: intake is write-quiesced (backup restore in progress)', {
        agentId: adapter.agentId,
        channelId: adapter.channelId,
        chatId: command.chatId,
        command: command.command
      })
      return
    }

    if (command.command === 'help' || command.command === 'whoami') {
      return this.processCommand(adapter, command, () => {})
    }

    // Preserve transport arrival order: messages received before a command must finish before
    // `/new` rotates the session or `/compact` starts another turn for the same conversation.
    for (const [batchKey, batch] of this.pendingBatches) {
      if (
        batch.adapter.agentId === adapter.agentId &&
        batch.adapter.channelId === adapter.channelId &&
        conversationIdOf(batch.messages[0]) === conversationIdOf(command)
      ) {
        clearTimeout(batch.timer)
        this.flushBatch(batchKey)
      }
    }

    const queueKey = conversationKey(adapter.agentId, adapter.channelId, conversationIdOf(command))
    const admissionId = `command:${queueKey}#${++this.admissionSeq}`
    let admit!: () => void
    const admission = new Promise<void>((resolve) => {
      admit = resolve
    })
    this.pendingAdmissions.set(admissionId, admission)
    void admission.then(() => this.pendingAdmissions.delete(admissionId))

    const previous = this.chatQueues.get(queueKey) ?? Promise.resolve()
    const current = previous.then(() => this.processCommand(adapter, command, admit))
    const settled = current.finally(() => {
      if (this.chatQueues.get(queueKey) === settled) {
        this.chatQueues.delete(queueKey)
      }
    })
    this.chatQueues.set(queueKey, settled)
    return settled
  }

  private async processCommand(
    adapter: ChannelAdapter,
    command: ChannelCommandEvent,
    onAdmitted: () => void
  ): Promise<void> {
    const { agentId } = adapter
    const replyOpts = responseOptionsFor(command)
    try {
      switch (command.command) {
        case 'new': {
          // TODO(channel-perm-override): channel.permissionMode no longer
          // applied here — config lives on agent now. Tracked separately.
          const newSession = this.createSessionForConversation(agentId, adapter.channelId, conversationIdOf(command))
          const trackerKey = conversationKey(agentId, adapter.channelId, conversationIdOf(command))
          this.sessionTracker.set(trackerKey, newSession.id)
          this.evictSessionTracker()
          onAdmitted()
          await adapter.sendMessage(command.chatId, t('common.channel_new_session_created'), replyOpts)
          break
        }
        case 'compact': {
          const session = await this.resolveSession(agentId, adapter.channelId, conversationIdOf(command))
          if (!session) {
            await adapter.sendMessage(command.chatId, t('common.channel_no_active_session'), replyOpts)
            return
          }
          const abortController = new AbortController()
          const responseOptions = streamResponseOptionsFor(command)
          adapter.sendTypingIndicator(command.chatId, responseOptions).catch(() => {})
          const typingInterval = setInterval(
            () => adapter.sendTypingIndicator(command.chatId, responseOptions).catch(() => {}),
            TYPING_INTERVAL_MS
          )
          try {
            const response = await this.collectStreamResponse(
              session,
              '/compact',
              abortController,
              adapter,
              command.chatId,
              responseOptions,
              onAdmitted
            )
            // The `ChannelAdapterListener` registered inside `collectStreamResponse` already
            // delivered any non-empty output; only send an explicit fallback when compact
            // produced no text, so we don't double-send.
            if (!response) {
              await adapter.sendMessage(command.chatId, t('common.channel_session_compacted'), replyOpts)
            }
          } finally {
            clearInterval(typingInterval)
          }
          break
        }
        case 'help': {
          onAdmitted()
          const agent = agentService.getAgent(agentId)
          const name = agent?.name ?? 'Cherry Studio'
          const description = agent?.description ?? ''
          const commands = await this.helpCommandsForChat(agentId, adapter.channelId, conversationIdOf(command))
          const helpText = [
            `*${name}*`,
            description ? `_${description}_` : '',
            '',
            t('common.channel_available_commands'),
            ...commands.map((cmd) => `/${cmd.name} - ${cmd.description}`)
          ]
            .filter(Boolean)
            .join('\n')
          await adapter.sendMessage(command.chatId, helpText, replyOpts)
          break
        }
        case 'whoami': {
          onAdmitted()
          await adapter.sendMessage(
            command.chatId,
            [
              `Current chat ID: \`${command.chatId}\``,
              '',
              'Add this value to `allowed_chat_ids` (or `allowed_channel_ids` for Discord) in settings to receive notifications.'
            ].join('\n'),
            replyOpts
          )
          break
        }
      }
    } catch (error) {
      logger.error('Error handling command', {
        agentId,
        command: command.command,
        error: error instanceof Error ? error.message : String(error)
      })
      adapter
        .sendMessage(command.chatId, t('common.channel_command_processing_error'), {
          ...responseOptionsFor(command)
        })
        .catch((sendErr) => {
          logger.debug('Failed to send error notification to channel', {
            chatId: command.chatId,
            error: sendErr instanceof Error ? sendErr.message : String(sendErr)
          })
        })
    } finally {
      onAdmitted()
    }
  }

  /** Evict oldest session tracker entries when the map exceeds the size limit. */
  private evictSessionTracker(): void {
    if (this.sessionTracker.size <= SESSION_TRACKER_MAX_SIZE) return
    const excess = this.sessionTracker.size - SESSION_TRACKER_MAX_SIZE
    const iter = this.sessionTracker.keys()
    for (let i = 0; i < excess; i++) {
      const { value } = iter.next()
      if (value) this.sessionTracker.delete(value)
    }
  }

  /** Clear session tracking for an agent (used when agent is deleted/updated) */
  clearSessionTracker(agentId: string): void {
    // Abort any in-flight stream owned by a tracked session of this agent
    // before dropping the tracker entries — otherwise the stream keeps
    // running on a deleted agent and `sendMessage` to a now-detached
    // channel will throw.
    const sessionIdsToAbort: string[] = []
    for (const [key, sessionId] of this.sessionTracker.entries()) {
      if (key.startsWith(`${agentId}:`)) {
        sessionIdsToAbort.push(sessionId)
        this.sessionTracker.delete(key)
      }
    }
    for (const sessionId of sessionIdsToAbort) {
      this.abortSessionStream(sessionId, 'agent-cleared')
    }
    for (const [key, batch] of this.pendingBatches.entries()) {
      if (key.startsWith(`${agentId}:`)) {
        clearTimeout(batch.timer)
        this.pendingBatches.delete(key)
        batch.cancelled = true
        batch.admit()
        batch.release()
        // Settle the discarded batch's callers so their .catch handlers fire
        // instead of leaving handleIncoming promises hanging forever.
        batch.resolvers.forEach((r) => r.reject(new Error('Agent removed; batch discarded')))
      }
    }
    for (const key of this.chatQueues.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.chatQueues.delete(key)
      }
    }
  }

  /** Abort an active stream for the given session. Returns true if a stream was in flight. */
  abortSession(sessionId: string): boolean {
    if (!this.activeAbortControllers.has(sessionId)) return false
    this.abortSessionStream(sessionId, 'channel-session-aborted')
    return true
  }

  /**
   * Stop the upstream agent-session turn for a session. The local `AbortController`
   * is never passed to the running stream — it only flips a listener's `isAlive()`,
   * which (because the manager prunes dead listeners before firing their terminal
   * callback) would strand the completion sentinel. So abort through the manager,
   * which settles the turn as `paused` and lets the still-alive sentinel resolve.
   */
  private abortSessionStream(sessionId: string, reason: string): void {
    application.get('AiStreamManager').abort(buildAgentSessionTopicId(sessionId), reason)
  }

  /**
   * The command list shown by `/help`: the channel control commands merged with the bound session's
   * live SDK catalog (custom commands included). Control commands win on name collision and come
   * first; session-only commands follow. Read-only — never creates a session, so `/help` on a fresh
   * chat just lists the control commands.
   */
  private async helpCommandsForChat(
    agentId: string,
    channelId: string,
    conversationId: string
  ): Promise<Array<{ name: string; description: string }>> {
    const merged: Array<{ name: string; description: string }> = SLASH_COMMANDS.map((cmd) => ({
      name: cmd.name,
      description: cmd.description
    }))
    const sessionId = this.peekSessionId(agentId, channelId, conversationId)
    if (!sessionId) return merged

    const sessionCommands =
      application.get('CacheService').getShared(AGENT_SESSION_SLASH_COMMANDS_CACHE_KEY(sessionId)) ?? []
    const controlNames = new Set(merged.map((cmd) => cmd.name))
    for (const cmd of sessionCommands) {
      if (controlNames.has(cmd.name)) continue
      merged.push({ name: cmd.name, description: cmd.description })
    }
    return merged
  }

  /** Read-only lookup of the session currently bound to a conversation — tracker first, then the persisted
   *  conversation binding. Mirrors {@link doResolveSession}'s ownership guard (`session.agentId === agentId`)
   *  so a stale/reassigned channel link can't surface another agent's commands; returns null when no
   *  session is bound to this agent yet (unlike {@link resolveSession}, never creates one). */
  private peekSessionId(agentId: string, channelId: string, conversationId: string): string | null {
    const trackerKey = conversationKey(agentId, channelId, conversationId)
    const trackedId = this.sessionTracker.get(trackerKey)
    if (trackedId) {
      const session = this.findSessionOwnedByAgent(trackedId, agentId)
      if (session) return session.id
    }

    const persistedId = channelService.getActiveSessionId(channelId, conversationId)
    if (persistedId) {
      const session = this.findSessionOwnedByAgent(persistedId, agentId)
      if (session) return session.id
    }
    return null
  }

  private async resolveSession(
    agentId: string,
    channelId: string,
    conversationId: string
  ): Promise<AgentSessionEntity | null> {
    const trackerKey = conversationKey(agentId, channelId, conversationId)

    // Coalesce concurrent resolutions for the same conversation to avoid duplicate sessions
    const pending = this.pendingResolutions.get(trackerKey)
    if (pending) return pending

    const resolution = this.doResolveSession(agentId, channelId, conversationId, trackerKey)
    this.pendingResolutions.set(trackerKey, resolution)
    try {
      return await resolution
    } finally {
      this.pendingResolutions.delete(trackerKey)
    }
  }

  private async doResolveSession(
    agentId: string,
    channelId: string,
    conversationId: string,
    trackerKey: string
  ): Promise<AgentSessionEntity | null> {
    const channelRow = channelService.getChannel(channelId)

    // Check tracker first
    const trackedId = this.sessionTracker.get(trackerKey)
    if (trackedId) {
      const session = this.findSessionOwnedByAgent(trackedId, agentId)
      if (session) {
        return session
      }
      this.sessionTracker.delete(trackerKey)
    }

    const persistedId = channelService.getActiveSessionId(channelId, conversationId)
    if (persistedId) {
      const existingSession = this.findSessionOwnedByAgent(persistedId, agentId)
      if (existingSession) {
        this.sessionTracker.set(trackerKey, existingSession.id)
        this.evictSessionTracker()
        return existingSession
      }
    }

    // No existing session found — create a new one
    logger.info('No existing session for channel conversation, creating new session', {
      agentId,
      channelId,
      conversationId,
      trackerKey
    })

    const newSession = this.createSessionForConversation(agentId, channelId, conversationId, channelRow ?? undefined)
    this.sessionTracker.set(trackerKey, newSession.id)
    this.evictSessionTracker()
    return newSession
  }

  private createSessionForConversation(
    agentId: string,
    channelId: string,
    conversationId: string,
    channel?: AgentChannelEntity
  ): AgentSessionEntity {
    const channelRow = channel ?? channelService.getChannel(channelId)
    if (!channelRow) {
      throw new Error(`Channel not found: ${channelId}`)
    }
    const sessionId = randomUUID()
    application.get('DbService').withWriteTx((tx) => {
      agentSessionService.createTx(tx, sessionId, {
        agentId,
        name: 'Channel session',
        workspace: channelRow.workspace
      })
      channelService.activateSessionTx(tx, {
        channelId,
        conversationId,
        sessionId
      })
    })
    agentSessionService.notifyReadModelChange([sessionId], 'membership')
    return agentSessionService.getById(sessionId)
  }

  private findSessionOwnedByAgent(sessionId: string, agentId: string): AgentSessionEntity | null {
    try {
      const session = agentSessionService.getById(sessionId)
      return session?.agentId === agentId ? session : null
    } catch {
      return null
    }
  }

  private async collectStreamResponse(
    session: AgentSessionEntity,
    content: string,
    abortController: AbortController,
    adapter: ChannelAdapter,
    chatId: string,
    responseOptions?: SendMessageOptions,
    onAdmitted?: () => void
  ): Promise<string> {
    if (!session.agentId) {
      throw new Error(`Cannot stream on orphan session ${session.id} — its agent was deleted`)
    }

    let resolveExecution!: (text: string) => void
    let rejectExecution!: (err: unknown) => void
    const executionDone = new Promise<string>((resolve, reject) => {
      resolveExecution = resolve
      rejectExecution = reject
    })
    let accumulatedText = ''
    const sentinel: StreamListener = {
      id: `channel-completion:${chatId}`,
      onChunk(chunk) {
        // `text-delta`'s field is `delta`, not `text` (AI SDK `UIMessageChunk`).
        if (chunk.type === 'text-delta') accumulatedText += chunk.delta
      },
      onDone() {
        resolveExecution(accumulatedText.trim())
      },
      onPaused() {
        resolveExecution(accumulatedText.trim())
      },
      onError(result) {
        rejectExecution(new Error(result.error.message ?? 'Execution failed'))
      },
      isAlive: () => !abortController.signal.aborted
    }

    try {
      const started = await startAgentSessionRun({
        sessionId: session.id,
        userParts: [{ type: 'text', text: content }],
        listeners: [sentinel, new ChannelAdapterListener(adapter, chatId, false, responseOptions)],
        headless: true,
        requireIdle: { expectedAgentId: session.agentId }
      })
      // No durable channel queue exists; fail visibly rather than retaining an in-memory waiter.
      // Add durable admission only if channels require guaranteed busy-session delivery.
      if (started.mode === 'not-started') throw new AgentSessionRunNotStartedError(started.reason)
    } finally {
      // The write-quiesce admission point: the turn's rows are written and it entered the AI
      // in-flight set (or the run threw) — either way the drain stops waiting on this batch.
      onAdmitted?.()
    }

    return executionDone
  }

  /**
   * Save images to the agent's workspace so the agent can read them via the Read tool.
   * Returns the list of absolute file paths written.
   */
  private async persistImages(workDir: string, images: ImageAttachment[]): Promise<string[]> {
    const dir = path.join(workDir, '.cherry-studio', 'channel-images')
    await fs.mkdir(dir, { recursive: true })

    const paths: string[] = []
    for (const img of images) {
      const ext = img.media_type.split('/')[1]?.replace('jpeg', 'jpg') || 'png'
      const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
      const filePath = path.join(dir, filename)
      await fs.writeFile(filePath, Buffer.from(img.data, 'base64'))
      paths.push(filePath)
    }

    return paths
  }

  /**
   * Save files to the agent's workspace so the agent can read them via the Read tool.
   * Returns the list of absolute file paths written.
   */
  private async persistFiles(workDir: string, files: FileAttachment[]): Promise<string[]> {
    const dir = path.join(workDir, '.cherry-studio', 'channel-files')
    await fs.mkdir(dir, { recursive: true })

    const paths: string[] = []
    for (const file of files) {
      // Prefix with timestamp to avoid collisions, preserve original filename for readability
      const safeName = file.filename.replace(/[/\\:*?"<>|]/g, '_')
      const filename = `${Date.now()}-${safeName}`
      const filePath = path.join(dir, filename)
      await fs.writeFile(filePath, Buffer.from(file.data, 'base64'))
      paths.push(filePath)
    }

    return paths
  }
}

export const channelMessageHandler = new ChannelMessageHandler()
