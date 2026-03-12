import { loggerService } from '@logger'
import type { GetAgentSessionResponse } from '@types'

import { agentService } from '../AgentService'
import { sessionMessageService } from '../SessionMessageService'
import { sessionService } from '../SessionService'
import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent } from './ChannelAdapter'

const logger = loggerService.withContext('ChannelMessageHandler')

const MAX_MESSAGE_LENGTH = 4096
const DRAFT_THROTTLE_MS = 500
const TYPING_INTERVAL_MS = 4000

export class ChannelMessageHandler {
  private static instance: ChannelMessageHandler | null = null
  private readonly sessionTracker = new Map<string, string>() // agentId -> sessionId

  static getInstance(): ChannelMessageHandler {
    if (!ChannelMessageHandler.instance) {
      ChannelMessageHandler.instance = new ChannelMessageHandler()
    }
    return ChannelMessageHandler.instance
  }

  async handleIncoming(adapter: ChannelAdapter, message: ChannelMessageEvent): Promise<void> {
    const { agentId } = adapter
    try {
      const session = await this.resolveSession(agentId)
      if (!session) {
        logger.error('Failed to resolve session', { agentId })
        return
      }

      const abortController = new AbortController()
      const draftId = Math.floor(Math.random() * 2_147_483_647) + 1

      // Show typing indicator immediately and keep refreshing every 4s
      adapter.sendTypingIndicator(message.chatId).catch(() => {})
      const typingInterval = setInterval(
        () => adapter.sendTypingIndicator(message.chatId).catch(() => {}),
        TYPING_INTERVAL_MS
      )

      try {
        const responseText = await this.collectStreamResponse(session, message.text, abortController, (text) =>
          adapter.sendMessageDraft(message.chatId, draftId, text).catch(() => {})
        )

        if (responseText) {
          const finalized = await adapter.finalizeStream(draftId, responseText).catch(() => false)
          if (!finalized) {
            await this.sendChunked(adapter, message.chatId, responseText)
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
            this.sessionTracker.set(agentId, newSession.id)
            await adapter.sendMessage(command.chatId, 'New session created.')
          }
          break
        }
        case 'compact': {
          const session = await this.resolveSession(agentId)
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

  /** Clear session tracking for an agent (used when agent is deleted/updated) */
  clearSessionTracker(agentId: string): void {
    this.sessionTracker.delete(agentId)
  }

  private async resolveSession(agentId: string): Promise<GetAgentSessionResponse | null> {
    // Check tracker first
    const trackedId = this.sessionTracker.get(agentId)
    if (trackedId) {
      const session = await sessionService.getSession(agentId, trackedId)
      if (session) return session
      // Tracked session gone, clear it
      this.sessionTracker.delete(agentId)
    }

    // Fall back to first existing session
    const { sessions } = await sessionService.listSessions(agentId, { limit: 1 })
    if (sessions.length > 0) {
      this.sessionTracker.set(agentId, sessions[0].id)
      return sessionService.getSession(agentId, sessions[0].id)
    }

    // Create new session
    const newSession = await sessionService.createSession(agentId, {})
    if (newSession) {
      this.sessionTracker.set(agentId, newSession.id)
      return newSession
    }

    return null
  }

  private async collectStreamResponse(
    session: GetAgentSessionResponse,
    content: string,
    abortController: AbortController,
    onDraft?: (text: string) => void
  ): Promise<string> {
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      { content },
      abortController,
      { persist: true }
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
    } finally {
      if (draftTimer) clearTimeout(draftTimer)
    }

    // Trim trailing separator
    return (completedText + currentBlockText).replace(/\n+$/, '')
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
