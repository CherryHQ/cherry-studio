import { loggerService } from '@logger'
import type { GetAgentSessionResponse } from '@types'

import { agentService } from '../AgentService'
import { sessionMessageService } from '../SessionMessageService'
import { sessionService } from '../SessionService'
import type { ChannelAdapter, ChannelCommandEvent, ChannelMessageEvent } from './ChannelAdapter'

const logger = loggerService.withContext('ChannelMessageHandler')

const MAX_MESSAGE_LENGTH = 4096

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
      const responseText = await this.collectStreamResponse(session, message.text, abortController, () =>
        adapter.sendTypingIndicator(message.chatId).catch(() => {})
      )

      if (responseText) {
        await this.sendChunked(adapter, message.chatId, responseText)
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
          const response = await this.collectStreamResponse(session, '/compact', abortController, () =>
            adapter.sendTypingIndicator(command.chatId).catch(() => {})
          )
          await adapter.sendMessage(command.chatId, response || 'Session compacted.')
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
            '/help - Show this help message'
          ]
            .filter(Boolean)
            .join('\n')
          await adapter.sendMessage(command.chatId, helpText)
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
    onTyping?: () => void
  ): Promise<string> {
    const { stream, completion } = await sessionMessageService.createSessionMessage(
      session,
      { content },
      abortController
    )

    const reader = stream.getReader()
    let text = ''
    let typingInterval: ReturnType<typeof setInterval> | undefined

    if (onTyping) {
      onTyping()
      typingInterval = setInterval(onTyping, 4000)
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        if (value.type === 'text-delta' && value.text) {
          text += value.text
        }
      }

      await completion
    } finally {
      if (typingInterval) clearInterval(typingInterval)
    }

    return text
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
