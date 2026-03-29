import { loggerService } from '@logger'
import type { CherryClawConfiguration, GetAgentSessionResponse } from '@types'

import { agentService } from '../AgentService'
import { sanitizeChannelOutput, wrapExternalContent } from '../security'
import { sessionMessageService } from '../SessionMessageService'
import { sessionService } from '../SessionService'
import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent } from './ChannelAdapter'
import { sessionStreamBus } from './SessionStreamBus'
import { broadcastSessionChanged } from './sessionStreamIpc'

const logger = loggerService.withContext('ChannelMessageHandler')

const MAX_MESSAGE_LENGTH = 4096
const DRAFT_THROTTLE_MS = 500
const TYPING_INTERVAL_MS = 4000

export class ChannelMessageHandler {
  private static instance: ChannelMessageHandler | null = null
  private readonly sessionTracker = new Map<string, string>() // `${agentId}:${channelId}:${chatId}` -> sessionId
  private readonly pendingResolutions = new Map<string, Promise<GetAgentSessionResponse | null>>()

  static getInstance(): ChannelMessageHandler {
    if (!ChannelMessageHandler.instance) {
      ChannelMessageHandler.instance = new ChannelMessageHandler()
    }
    return ChannelMessageHandler.instance
  }

  async handleIncoming(adapter: ChannelAdapter, message: ChannelMessageEvent): Promise<void> {
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
      await this.applyChannelPermissionMode(session, agentId, adapter.channelId)

      // Wrap untrusted channel input with security boundary markers
      const securedContent = wrapExternalContent(message.text, {
        chatId: message.chatId,
        userId: message.userId,
        userName: message.userName,
        channelType: adapter.channelType
      })

      // Broadcast user message to renderer so it can display it during streaming
      sessionStreamBus.publish(session.id, {
        sessionId: session.id,
        agentId: session.agent_id,
        type: 'user-message',
        userMessage: {
          chatId: message.chatId,
          userId: message.userId,
          userName: message.userName,
          text: message.text
        }
      })

      const abortController = new AbortController()
      const draftId = Math.floor(Math.random() * 2_147_483_647) + 1

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
          (text) => adapter.sendMessageDraft(message.chatId, draftId, text).catch(() => {}),
          message.text
        )

        if (responseText) {
          // Sanitize output to prevent accidental secret leakage through channels
          const { text: sanitizedText } = sanitizeChannelOutput(responseText)
          const finalized = await adapter.finalizeStream(draftId, sanitizedText).catch(() => false)
          if (!finalized) {
            await this.sendChunked(adapter, message.chatId, sanitizedText)
          }
        }
      } finally {
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
          const newSession = await sessionService.createSession(agentId, {})
          if (newSession) {
            const trackerKey = `${agentId}:${adapter.channelId}:${command.chatId}`
            this.sessionTracker.set(trackerKey, newSession.id)
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
            const response = await this.collectStreamResponse(session, '/compact', abortController)
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
            '/new - Start a new conversation session',
            '/compact - Compact current session context',
            '/help - Show this help message',
            '/whoami - Show the current chat ID for allow_ids'
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
  private async applyChannelPermissionMode(
    session: GetAgentSessionResponse,
    agentId: string,
    channelId: string
  ): Promise<void> {
    const agent = await agentService.getAgent(agentId)
    const cherryClawConfig = agent?.configuration as CherryClawConfiguration | undefined
    const channelConfig = cherryClawConfig?.channels?.find((ch) => ch.id === channelId)
    if (channelConfig?.permission_mode && session.configuration) {
      session.configuration = { ...session.configuration, permission_mode: channelConfig.permission_mode }
    }
  }

  /** Clear session tracking for an agent (used when agent is deleted/updated) */
  clearSessionTracker(agentId: string): void {
    for (const key of this.sessionTracker.keys()) {
      if (key.startsWith(`${agentId}:`)) {
        this.sessionTracker.delete(key)
      }
    }
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
    channelType: string,
    chatId: string,
    trackerKey: string
  ): Promise<GetAgentSessionResponse | null> {
    // Check tracker first
    const trackedId = this.sessionTracker.get(trackerKey)
    if (trackedId) {
      const session = await sessionService.getSession(agentId, trackedId)
      if (session) return session
      // Tracked session gone, clear it
      this.sessionTracker.delete(trackerKey)
    }

    // Look up existing session from DB by channel source metadata
    const existingSession = await sessionService.findSessionByChannel(agentId, channelId, chatId)
    if (existingSession) {
      this.sessionTracker.set(trackerKey, existingSession.id)
      return existingSession
    }

    // No existing session found — create a new one
    const agent = await agentService.getAgent(agentId)

    // Resolve per-channel permission mode override (if configured)
    const cherryClawConfig = agent?.configuration as CherryClawConfiguration | undefined
    const channelConfig = cherryClawConfig?.channels?.find((ch) => ch.id === channelId)
    const channelPermissionMode = channelConfig?.permission_mode

    const newSession = await sessionService.createSession(agentId, {
      ...(agent?.configuration
        ? {
            configuration: {
              ...agent.configuration,
              source_channel_id: channelId,
              source_channel_type: channelType,
              source_chat_id: chatId,
              ...(channelPermissionMode ? { permission_mode: channelPermissionMode } : {})
            }
          }
        : {})
    })
    if (newSession) {
      this.sessionTracker.set(trackerKey, newSession.id)
      return newSession
    }

    return null
  }

  private async collectStreamResponse(
    session: GetAgentSessionResponse,
    content: string,
    abortController: AbortController,
    onDraft?: (text: string) => void,
    displayContent?: string
  ): Promise<string> {
    // If renderer is subscribed, it handles persistence via the same BlockManager
    // pipeline as normal agent messages. Otherwise, fall back to persistHeadlessExchange.
    const rendererIsWatching = sessionStreamBus.hasSubscribers(session.id)
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      { content },
      abortController,
      { persist: !rendererIsWatching, displayContent }
    )

    const reader = stream.getReader()
    let completedText = '' // text from finished blocks/turns
    let currentBlockText = '' // cumulative text within the current block
    let lastDraftTime = 0
    let draftTimer: ReturnType<typeof setTimeout> | undefined

    const emitDraft = () => {
      if (!onDraft) return
      const fullText = completedText + currentBlockText
      if (fullText) onDraft(fullText)
    }

    const throttledDraft = () => {
      if (!onDraft) return
      const now = Date.now()
      if (now - lastDraftTime >= DRAFT_THROTTLE_MS) {
        lastDraftTime = now
        if (draftTimer) clearTimeout(draftTimer)
        emitDraft()
      } else if (!draftTimer) {
        draftTimer = setTimeout(
          () => {
            draftTimer = undefined
            lastDraftTime = Date.now()
            emitDraft()
          },
          DRAFT_THROTTLE_MS - (now - lastDraftTime)
        )
      }
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Publish chunk to bus for renderer real-time rendering
        sessionStreamBus.publish(session.id, {
          sessionId: session.id,
          agentId: session.agent_id,
          type: 'chunk',
          chunk: value
        })

        switch (value.type) {
          case 'text-delta':
            // text-delta values are cumulative within a block
            if (value.text) {
              currentBlockText = value.text
              throttledDraft()
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

      // Notify renderer that stream is complete and data is persisted
      sessionStreamBus.publish(session.id, {
        sessionId: session.id,
        agentId: session.agent_id,
        type: 'complete'
      })
      broadcastSessionChanged(session.agent_id, session.id)

      // Trim trailing separator
      return (completedText + currentBlockText).replace(/\n+$/, '')
    } catch (error) {
      sessionStreamBus.publish(session.id, {
        sessionId: session.id,
        agentId: session.agent_id,
        type: 'error',
        error: { message: error instanceof Error ? error.message : String(error) }
      })
      throw error
    } finally {
      if (draftTimer) clearTimeout(draftTimer)
    }
  }

  private async sendChunked(adapter: ChannelAdapter, chatId: string, text: string): Promise<void> {
    if (text.length <= MAX_MESSAGE_LENGTH) {
      await adapter.sendMessage(chatId, text)
      return
    }

    const chunks = this.chunkText(text, MAX_MESSAGE_LENGTH)
    for (const chunk of chunks) {
      await adapter.sendMessage(chatId, chunk)
    }
  }

  private chunkText(text: string, maxLength: number): string[] {
    const chunks: string[] = []
    let remaining = text

    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining)
        break
      }

      // Try paragraph boundary
      let splitIdx = remaining.lastIndexOf('\n\n', maxLength)
      if (splitIdx <= 0) {
        // Try line boundary
        splitIdx = remaining.lastIndexOf('\n', maxLength)
      }
      if (splitIdx <= 0) {
        // Hard split
        splitIdx = maxLength
      }

      chunks.push(remaining.slice(0, splitIdx))
      remaining = remaining.slice(splitIdx).replace(/^\n+/, '')
    }

    return chunks
  }
}

export const channelMessageHandler = ChannelMessageHandler.getInstance()
