import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { loggerService } from '@logger'
import type { GetAgentSessionResponse, PermissionMode } from '@types'

import { agentService } from '../AgentService'
import { channelService } from '../ChannelService'
import { sanitizeChannelOutput, wrapExternalContent } from '../security'
import { sessionMessageService } from '../SessionMessageService'
import { sessionService } from '../SessionService'
import type {
  ChannelAdapter,
  ChannelCommandEvent,
  ChannelMessageEvent,
  FileAttachment,
  ImageAttachment
} from './ChannelAdapter'
import { SLASH_COMMANDS } from './constants'
import { sessionStreamBus } from './SessionStreamBus'
import { broadcastSessionChanged } from './sessionStreamIpc'
import { splitMessage } from './utils'

const logger = loggerService.withContext('ChannelMessageHandler')

const MAX_MESSAGE_LENGTH = 4096
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

type BatchResolver = {
  resolve: () => void
  reject: (err: unknown) => void
}

type PendingBatch = {
  adapter: ChannelAdapter
  messages: ChannelMessageEvent[]
  timer: ReturnType<typeof setTimeout>
  resolvers: BatchResolver[]
}

export class ChannelMessageHandler {
  private static instance: ChannelMessageHandler | null = null
  // TODO: in v2 use cacheService
  private readonly sessionTracker = new Map<string, string>() // `${agentId}:${channelId}:${chatId}` -> sessionId
  private readonly pendingResolutions = new Map<string, Promise<GetAgentSessionResponse | null>>()
  /** Per-chat debounce buffer — accumulates rapid messages before flushing */
  private readonly pendingBatches = new Map<string, PendingBatch>()
  /** Per-chat serial queue — ensures only one stream runs at a time per chat */
  private readonly chatQueues = new Map<string, Promise<void>>()
  /** Active abort controllers per session — allows renderer to abort via IPC */
  private readonly activeAbortControllers = new Map<string, AbortController>()

  static getInstance(): ChannelMessageHandler {
    if (!ChannelMessageHandler.instance) {
      ChannelMessageHandler.instance = new ChannelMessageHandler()
    }
    return ChannelMessageHandler.instance
  }

  handleIncoming(adapter: ChannelAdapter, message: ChannelMessageEvent): Promise<void> {
    const batchKey = `${adapter.agentId}:${adapter.channelId}:${message.chatId}`

    return new Promise<void>((resolve, reject) => {
      const existing = this.pendingBatches.get(batchKey)
      if (existing) {
        // Append to existing batch and reset the debounce timer
        existing.messages.push(message)
        existing.resolvers.push({ resolve, reject })
        clearTimeout(existing.timer)
        existing.timer = setTimeout(() => this.flushBatch(batchKey), MESSAGE_BATCH_DELAY_MS)
        logger.debug('Message appended to pending batch', {
          batchKey,
          batchSize: existing.messages.length
        })
        return
      }

      // Start a new batch
      const batch: PendingBatch = {
        adapter,
        messages: [message],
        timer: setTimeout(() => this.flushBatch(batchKey), MESSAGE_BATCH_DELAY_MS),
        resolvers: [{ resolve, reject }]
      }
      this.pendingBatches.set(batchKey, batch)
    })
  }

  private flushBatch(batchKey: string): void {
    const batch = this.pendingBatches.get(batchKey)
    if (!batch) return
    this.pendingBatches.delete(batchKey)

    const merged = this.mergeMessages(batch.messages)
    const { resolvers } = batch

    if (batch.messages.length > 1) {
      logger.info('Flushing merged message batch', {
        batchKey,
        messageCount: batch.messages.length
      })
    }

    // Serialize with any in-flight stream to avoid interleaving
    const prev = this.chatQueues.get(batchKey) ?? Promise.resolve()
    const current = prev
      .then(() => this.processIncoming(batch.adapter, merged))
      .then(
        () => resolvers.forEach((r) => r.resolve()),
        (err) => resolvers.forEach((r) => r.reject(err))
      )
      .finally(() => {
        // Clean up queue entry when no newer work has been enqueued
        if (this.chatQueues.get(batchKey) === settled) {
          this.chatQueues.delete(batchKey)
        }
      })
    // Log errors but keep the queue chain intact
    const settled = current.catch((err) => {
      const errMsg = err instanceof Error ? err.message : String(err)
      logger.error('Channel message processing failed', { batchKey, error: errMsg })

      // Best-effort: notify the user with a generic message (no internal details)
      try {
        const adapter = batch.adapter
        const chatId = merged.chatId
        if (adapter && chatId) {
          adapter
            .sendMessage(chatId, '⚠️ An error occurred while processing your message. Please try again later.')
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
    this.chatQueues.set(batchKey, settled)
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

    return {
      chatId: first.chatId,
      userId: first.userId,
      userName: first.userName,
      text: mergedText,
      ...(mergedImages.length > 0 ? { images: mergedImages } : {}),
      ...(mergedFiles.length > 0 ? { files: mergedFiles } : {})
    }
  }

  private async processIncoming(adapter: ChannelAdapter, message: ChannelMessageEvent): Promise<void> {
    const { agentId } = adapter

    try {
      const session = await this.resolveSession(agentId, adapter.channelId, adapter.channelType, message.chatId)
      if (!session) {
        logger.error('Failed to resolve session', { agentId })
        return
      }

      // Apply channel-level permission mode override on every message (not just session creation).
      // This ensures changes to the channel's permission_mode take effect immediately,
      // even for sessions created before the setting was changed.
      await this.applyChannelPermissionMode(session, adapter.channelId)

      const workDir = session.accessible_paths[0]

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

      // Wrap untrusted channel input with security boundary markers
      const securedContent = wrapExternalContent(textWithAttachments, {
        chatId: message.chatId,
        userId: message.userId,
        userName: message.userName,
        channelType: adapter.channelType
      })

      // Build display text: append filenames so the user can see them in the UI
      let displayText = message.text
      if (message.files && message.files.length > 0) {
        const names = message.files.map((f) => `📎 ${f.filename}`).join('\n')
        displayText = displayText ? `${displayText}\n${names}` : names
      }

      // Snapshot subscriber state ONCE — this single check drives:
      // 1. Whether user-message is published to the renderer
      // 2. The persist flag (renderer persistence vs headless persistence)
      // 3. Whether stream chunks / complete events are forwarded
      // Checking once eliminates the race where subscribe() IPC completes
      // between the user-message publish and the persist decision.
      const rendererIsWatching = sessionStreamBus.hasSubscribers(session.id)

      if (rendererIsWatching) {
        sessionStreamBus.publish(session.id, {
          sessionId: session.id,
          agentId: session.agent_id,
          type: 'user-message',
          userMessage: {
            chatId: message.chatId,
            userId: message.userId,
            userName: message.userName,
            text: displayText,
            images: message.images
          }
        })
      }

      const abortController = new AbortController()
      this.activeAbortControllers.set(session.id, abortController)

      // Show typing indicator immediately and keep refreshing every 4s
      adapter.sendTypingIndicator(message.chatId).catch(() => {})
      const typingInterval = setInterval(
        () => adapter.sendTypingIndicator(message.chatId).catch(() => {}),
        TYPING_INTERVAL_MS
      )

      try {
        const responseText = await this.collectStreamResponse(
          session,
          securedContent,
          abortController,
          adapter,
          message.chatId,
          message.text,
          message.images,
          rendererIsWatching
        )

        if (responseText) {
          // Sanitize output to prevent accidental secret leakage through channels
          const { text: sanitizedText } = sanitizeChannelOutput(responseText)
          const finalized = await adapter.onStreamComplete(message.chatId, sanitizedText).catch(() => false)
          if (!finalized) {
            await this.sendChunked(adapter, message.chatId, sanitizedText)
          }
        }
      } catch (streamError) {
        // Notify adapter of the error so it can update streaming UI
        adapter
          .onStreamError(message.chatId, streamError instanceof Error ? streamError.message : String(streamError))
          .catch(() => {})
        throw streamError
      } finally {
        this.activeAbortControllers.delete(session.id)
        clearInterval(typingInterval)
      }
    } catch (error) {
      logger.error('Error handling incoming message', {
        agentId,
        chatId: message.chatId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async handleCommand(adapter: ChannelAdapter, command: ChannelCommandEvent): Promise<void> {
    const { agentId } = adapter
    try {
      switch (command.command) {
        case 'new': {
          const agent = await agentService.getAgent(agentId)
          const channelRow = await channelService.getChannel(adapter.channelId)
          const permMode = channelRow?.permissionMode as PermissionMode | undefined

          const newSession = await sessionService.createSession(agentId, {
            ...(agent?.configuration
              ? {
                  configuration: {
                    ...agent.configuration,
                    ...(permMode ? { permission_mode: permMode } : {})
                  }
                }
              : {})
          })
          if (newSession) {
            // Update channel's session_id to point to the new session
            await channelService.updateChannel(adapter.channelId, { sessionId: newSession.id })
            const trackerKey = `${agentId}:${adapter.channelId}:${command.chatId}`
            this.sessionTracker.set(trackerKey, newSession.id)
            this.evictSessionTracker()
            await adapter.sendMessage(command.chatId, 'New session created.')
          }
          break
        }
        case 'compact': {
          const session = await this.resolveSession(agentId, adapter.channelId, adapter.channelType, command.chatId)
          if (!session) {
            await adapter.sendMessage(command.chatId, 'No active session.')
            return
          }
          const abortController = new AbortController()
          adapter.sendTypingIndicator(command.chatId).catch(() => {})
          const typingInterval = setInterval(
            () => adapter.sendTypingIndicator(command.chatId).catch(() => {}),
            TYPING_INTERVAL_MS
          )
          try {
            const response = await this.collectStreamResponse(
              session,
              '/compact',
              abortController,
              adapter,
              command.chatId
            )
            await adapter.sendMessage(command.chatId, response || 'Session compacted.')
          } finally {
            clearInterval(typingInterval)
          }
          break
        }
        case 'help': {
          const agent = await agentService.getAgent(agentId)
          const name = agent?.name ?? 'CherryClaw'
          const description = agent?.description ?? ''
          const helpText = [
            `*${name}*`,
            description ? `_${description}_` : '',
            '',
            'Available commands:',
            ...SLASH_COMMANDS.map((cmd) => `/${cmd.name} - ${cmd.description}`)
          ]
            .filter(Boolean)
            .join('\n')
          await adapter.sendMessage(command.chatId, helpText)
          break
        }
        case 'whoami': {
          await adapter.sendMessage(
            command.chatId,
            [
              `Current chat ID: \`${command.chatId}\``,
              '',
              'Add this value to `allow_ids` in settings to receive notifications.'
            ].join('\n')
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
    }
  }

  /**
   * Look up the channel's current permission_mode from the agent config and
   * override the session's configuration in-place. This ensures that changes
   * to the channel permission mode take effect immediately — even for sessions
   * that were created before the setting was changed.
   */
  private async applyChannelPermissionMode(session: GetAgentSessionResponse, channelId: string): Promise<void> {
    const channel = await channelService.getChannel(channelId)
    if (channel?.permissionMode && session.configuration) {
      session.configuration = {
        ...session.configuration,
        permission_mode: channel.permissionMode as PermissionMode
      }
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
    for (const key of this.sessionTracker.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.sessionTracker.delete(key)
      }
    }
    for (const [key, batch] of this.pendingBatches.entries()) {
      if (key.startsWith(`${agentId}:`)) {
        clearTimeout(batch.timer)
        this.pendingBatches.delete(key)
      }
    }
    for (const key of this.chatQueues.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.chatQueues.delete(key)
      }
    }
  }

  /** Abort an active stream for the given session. Returns true if aborted. */
  abortSession(sessionId: string): boolean {
    const controller = this.activeAbortControllers.get(sessionId)
    if (controller) {
      controller.abort()
      return true
    }
    return false
  }

  private async resolveSession(
    agentId: string,
    channelId: string,
    channelType: string,
    chatId: string
  ): Promise<GetAgentSessionResponse | null> {
    const trackerKey = `${agentId}:${channelId}:${chatId}`

    // Coalesce concurrent resolutions for the same chat to avoid duplicate sessions
    const pending = this.pendingResolutions.get(trackerKey)
    if (pending) return pending

    const resolution = this.doResolveSession(agentId, channelId, channelType, chatId, trackerKey)
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
    _channelType: string,
    _chatId: string,
    trackerKey: string
  ): Promise<GetAgentSessionResponse | null> {
    const channelRow = await channelService.getChannel(channelId)

    // Check tracker first
    const trackedId = this.sessionTracker.get(trackerKey)
    if (trackedId) {
      const session = await sessionService.getSession(agentId, trackedId)
      if (session) {
        // Ensure channel's session_id stays in sync
        if (channelRow && channelRow.sessionId !== session.id) {
          channelService.updateChannel(channelId, { sessionId: session.id }).catch(() => {})
        }
        return session
      }
      // Tracked session gone, clear it
      this.sessionTracker.delete(trackerKey)
    }

    // Look up existing session via channel's session_id
    if (channelRow?.sessionId) {
      const existingSession = await sessionService.getSession(agentId, channelRow.sessionId)
      if (existingSession) {
        this.sessionTracker.set(trackerKey, existingSession.id)
        this.evictSessionTracker()
        return existingSession
      }
    }

    // No existing session found — create a new one
    logger.info('No existing session for channel, creating new session', {
      agentId,
      channelId,
      channelSessionId: channelRow?.sessionId ?? null,
      trackerKey
    })
    const agent = await agentService.getAgent(agentId)
    const channelPermissionMode = channelRow?.permissionMode as PermissionMode | undefined

    const newSession = await sessionService.createSession(agentId, {
      ...(agent?.configuration
        ? {
            configuration: {
              ...agent.configuration,
              ...(channelPermissionMode ? { permission_mode: channelPermissionMode } : {})
            }
          }
        : {})
    })
    if (newSession) {
      // Link channel to the new session
      await channelService.updateChannel(channelId, { sessionId: newSession.id })
      this.sessionTracker.set(trackerKey, newSession.id)
      this.evictSessionTracker()
      return newSession
    }

    return null
  }

  private async collectStreamResponse(
    session: GetAgentSessionResponse,
    content: string,
    abortController: AbortController,
    adapter: ChannelAdapter,
    chatId: string,
    displayContent?: string,
    images?: ImageAttachment[],
    rendererIsWatching: boolean = false
  ): Promise<string> {
    // Use the pre-computed rendererIsWatching flag from processIncoming.
    // When renderer is watching: persist=false (renderer handles rich block persistence),
    //   stream chunks and events are forwarded to the renderer via the bus.
    // When renderer is NOT watching: persist=true (main persists via persistHeadlessExchange),
    //   stream events are NOT forwarded (no subscriber or subscriber arrived late).
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      { content },
      abortController,
      { persist: !rendererIsWatching, displayContent, images }
    )

    const reader = stream.getReader()
    let completedText = '' // text from finished blocks/turns
    let currentBlockText = '' // cumulative text within the current block

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Only forward chunks to renderer when it was confirmed watching at stream start.
        // This prevents late-subscribing renderers from receiving partial chunks
        // while main process is also persisting (which would cause duplicates).
        if (rendererIsWatching) {
          sessionStreamBus.publish(session.id, {
            sessionId: session.id,
            agentId: session.agent_id,
            type: 'chunk',
            chunk: value
          })
        }

        // Skip user message echoes — only accumulate assistant text for the channel reply
        const rawType = (value as any).providerMetadata?.raw?.type
        if (rawType === 'user') continue

        switch (value.type) {
          case 'text-delta':
            // text-delta values are cumulative within a block
            if (value.text) {
              currentBlockText = value.text
              // Notify adapter of text update — adapter owns its own throttle/flush
              const fullText = completedText + currentBlockText
              adapter.onTextUpdate(chatId, fullText).catch(() => {})
            }
            break
          case 'text-end':
            // Block finished — commit current block text and reset for next turn
            if (currentBlockText) {
              completedText += currentBlockText + '\n\n'
              currentBlockText = ''
            }
            break
        }
      }

      await completion

      if (rendererIsWatching) {
        // Notify renderer that stream is complete and data is persisted
        sessionStreamBus.publish(session.id, {
          sessionId: session.id,
          agentId: session.agent_id,
          type: 'complete'
        })
      }
      // headless=true means main process persisted; renderer should force-reload from DB.
      // headless=false means renderer handled persistence; no reload needed.
      broadcastSessionChanged(session.agent_id, session.id, !rendererIsWatching)

      // Trim trailing separator
      return (completedText + currentBlockText).replace(/\n+$/, '')
    } catch (error) {
      if (rendererIsWatching) {
        sessionStreamBus.publish(session.id, {
          sessionId: session.id,
          agentId: session.agent_id,
          type: 'error',
          error: { message: error instanceof Error ? error.message : String(error) }
        })
      }
      throw error
    }
  }

  private async sendChunked(adapter: ChannelAdapter, chatId: string, text: string): Promise<void> {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await adapter.sendMessage(chatId, text)
      return
    }

    const chunks = splitMessage(text, MAX_MESSAGE_LENGTH)
    for (const chunk of chunks) {
      await adapter.sendMessage(chatId, chunk)
    }
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

export const channelMessageHandler = ChannelMessageHandler.getInstance()
