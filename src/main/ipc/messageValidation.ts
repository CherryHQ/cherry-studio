import { loggerService } from '@logger'

const logger = loggerService.withContext('MessageValidation')

// =============================================================================
// TYPES AND INTERFACES
// =============================================================================

export type MessageType = 'request' | 'response' | 'stream' | 'stream-start' | 'stream-end' | 'stream-error'

export interface AgentMessage {
  id: string
  type: MessageType
  payload: Record<string, any>
  timestamp: number
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

export function validateAgentMessage(message: any): asserts message is AgentMessage {
  if (!message || typeof message !== 'object') {
    throw new Error('Message validation failed: message must be an object')
  }

  // Check individual fields with specific error messages
  if (typeof message.id !== 'string' || message.id.length === 0) {
    throw new Error('Message validation failed: missing required field')
  }

  if (typeof message.type !== 'string') {
    throw new Error('Message validation failed: missing required field')
  }

  if (!validateMessageType(message.type)) {
    throw new Error(`Invalid message type: ${message.type}`)
  }

  if (!message.payload || typeof message.payload !== 'object') {
    throw new Error('Message validation failed: missing required field')
  }

  if (message.timestamp === undefined || message.timestamp === null) {
    throw new Error('Message validation failed: missing required field')
  }

  if (typeof message.timestamp !== 'number' || !validateTimestamp(message.timestamp)) {
    throw new Error('Invalid timestamp')
  }
}

export function validateMessageStructure(message: any): boolean {
  if (!message || typeof message !== 'object') {
    return false
  }

  if (typeof message.id !== 'string' || message.id.length === 0) {
    return false
  }

  if (typeof message.type !== 'string') {
    return false
  }

  if (!message.payload || typeof message.payload !== 'object') {
    return false
  }

  if (typeof message.timestamp !== 'number') {
    return false
  }

  return true
}

export function validateMessageType(type: any): type is MessageType {
  const validTypes: MessageType[] = [
    'request', 'response', 'stream', 'stream-start', 'stream-end', 'stream-error'
  ]
  return typeof type === 'string' && validTypes.includes(type as MessageType)
}

export function validateTimestamp(timestamp: any): boolean {
  if (typeof timestamp !== 'number' || isNaN(timestamp)) {
    return false
  }

  if (timestamp < 0 || !isFinite(timestamp)) {
    return false
  }

  const now = Date.now()
  const oneHourMs = 60 * 60 * 1000
  const oneDayMs = 24 * oneHourMs
  const oneWeekMs = 7 * oneDayMs

  // Reject timestamps too far in the future (24 hours or more)
  if (timestamp >= now + oneDayMs) {
    return false
  }

  // Reject timestamps too far in the past (7 days or more)
  if (timestamp <= now - oneWeekMs) {
    return false
  }

  return true
}

export function sanitizeMessage(message: AgentMessage): AgentMessage {
  try {
    // Create a new WeakSet for each sanitization to handle circular references
    const seen = new WeakSet()
    
    const sanitized = JSON.parse(JSON.stringify(message, (_key, value) => {
      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular Reference]'
        }
        seen.add(value)
      }
      
      // Sanitize string values to remove dangerous content  
      if (typeof value === 'string') {
        return value
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/javascript:/gi, '')
          .replace(/on\w+\s*=/gi, '')
          .replace(/<iframe\b[^>]*>/gi, '')
          .replace(/<object\b[^>]*>/gi, '')
          .replace(/<embed\b[^>]*>/gi, '')
      }
      
      return value
    }))
    
    return sanitized
  } catch (error) {
    logger.error('Failed to sanitize message', error instanceof Error ? error : new Error(String(error)), { messageId: message.id })
    throw error
  }
}