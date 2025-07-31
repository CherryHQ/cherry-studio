import { BrowserWindow } from 'electron'
import { loggerService } from '@logger'
import { validateAgentMessage, sanitizeMessage, AgentMessage } from './messageValidation'

const logger = loggerService.withContext('AgentIPCHandler')

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

export interface ProcessMessageResult {
  success: boolean
  error?: string
  data?: any
}

// =============================================================================
// AGENT IPC HANDLER CLASS
// =============================================================================

export class AgentIPCHandler {
  private window: BrowserWindow
  private activeSessions = new Set<string>()

  constructor(window: BrowserWindow) {
    this.window = window
  }

  // ===========================================================================
  // MESSAGE SERIALIZATION
  // ===========================================================================

  serializeMessage(message: any): string {
    try {
      return JSON.stringify(message)
    } catch (error) {
      logger.error('Failed to serialize message', error)
      throw new Error('Message serialization failed')
    }
  }

  deserializeMessage(serialized: string): any {
    try {
      return JSON.parse(serialized)
    } catch (error) {
      logger.error('Failed to deserialize message', error)
      throw new Error('Message deserialization failed')
    }
  }

  // ===========================================================================
  // MESSAGE VALIDATION
  // ===========================================================================

  validateMessage(message: any): void {
    validateAgentMessage(message)
  }

  // ===========================================================================
  // MESSAGE PROCESSING
  // ===========================================================================

  async processMessage(message: any): Promise<ProcessMessageResult> {
    const startTime = Date.now()
    
    try {
      // Validate message structure
      this.validateMessage(message)
      
      // Sanitize message content
      const sanitizedMessage = sanitizeMessage(message)
      
      // Process the message (minimal implementation for GREEN PHASE)
      const result = {
        success: true,
        data: sanitizedMessage
      }

      // Ensure processing time is under 100ms requirement
      const processingTime = Date.now() - startTime
      if (processingTime >= 100) {
        logger.warn('Message processing time exceeded 100ms', { 
          processingTime, 
          messageId: message.id 
        })
      }

      return result
    } catch (error) {
      logger.error('Failed to process message', error instanceof Error ? error : new Error(String(error)), { messageId: message?.id })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  async forwardToUI(message: AgentMessage): Promise<void> {
    try {
      this.window.webContents.send('agent:message-received', message)
    } catch (error) {
      logger.error('Failed to forward message to UI', error instanceof Error ? error : new Error(String(error)), { messageId: message.id })
      // Don't re-throw to allow graceful handling
      return
    }
  }

  // ===========================================================================
  // STREAMING MESSAGE PROCESSING
  // ===========================================================================

  async processStreamMessage(message: any): Promise<ProcessMessageResult> {
    const startTime = Date.now()
    
    try {
      // Validate basic message structure
      this.validateMessage(message)
      
      // Additional validation for stream messages
      if (!this.isValidStreamMessage(message)) {
        return {
          success: false,
          error: 'Invalid stream message: missing stream field'
        }
      }

      // Handle different stream message types
      switch (message.type) {
        case 'stream-start':
          await this.handleStreamStart(message)
          break
        case 'stream':
          await this.handleStreamData(message)
          break
        case 'stream-end':
          await this.handleStreamEnd(message)
          break
        case 'stream-error':
          await this.handleStreamError(message)
          break
        default:
          await this.handleStreamData(message)
      }

      // Ensure processing time is under 100ms requirement
      const processingTime = Date.now() - startTime
      if (processingTime >= 100) {
        logger.warn('Stream message processing time exceeded 100ms', { 
          processingTime, 
          messageId: message.id 
        })
      }

      return { success: true }
    } catch (error) {
      logger.error('Failed to process stream message', error instanceof Error ? error : new Error(String(error)), { messageId: message?.id })
      return {
        success: false,
        error: `Failed to forward stream message: ${error instanceof Error ? error.message : 'Unknown error'}`
      }
    }
  }

  private isValidStreamMessage(message: any): boolean {
    // For 'stream' type messages, require stream: true in payload
    if (message.type === 'stream') {
      return message.payload && message.payload.stream === true
    }
    
    // For other stream-related types, they're valid by type alone
    return message.type.startsWith('stream')
  }

  private async handleStreamStart(message: AgentMessage): Promise<void> {
    const sessionId = message.payload.sessionId
    if (sessionId) {
      this.activeSessions.add(sessionId)
    }
    
    this.window.webContents.send('agent:stream-data', message)
  }

  private async handleStreamData(message: AgentMessage): Promise<void> {
    this.window.webContents.send('agent:stream-data', message)
  }

  private async handleStreamEnd(message: AgentMessage): Promise<void> {
    const sessionId = message.payload.sessionId
    if (sessionId) {
      this.activeSessions.delete(sessionId)
    }
    
    this.window.webContents.send('agent:stream-end', message)
  }

  private async handleStreamError(message: AgentMessage): Promise<void> {
    const sessionId = message.payload.sessionId
    if (sessionId) {
      this.activeSessions.delete(sessionId)
    }
    
    this.window.webContents.send('agent:stream-error', message)
  }

  // ===========================================================================
  // SESSION MANAGEMENT
  // ===========================================================================

  hasActiveStream(sessionId: string): boolean {
    return this.activeSessions.has(sessionId)
  }

  getActiveSessionCount(): number {
    return this.activeSessions.size
  }

  clearAllSessions(): void {
    this.activeSessions.clear()
  }
}