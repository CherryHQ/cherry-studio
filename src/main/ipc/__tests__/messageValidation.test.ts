import { describe, expect, it } from 'vitest'
import { 
  validateAgentMessage, 
  validateMessageStructure,
  validateMessageType,
  validateTimestamp,
  sanitizeMessage,
  AgentMessage,
  MessageType
} from '../messageValidation'

describe('Message Validation', () => {
  describe('validateAgentMessage', () => {
    it('should validate correct agent message', () => {
      const validMessage: AgentMessage = {
        id: 'test-id-123',
        type: 'request',
        payload: { command: 'execute', data: 'test data' },
        timestamp: Date.now()
      }

      expect(() => validateAgentMessage(validMessage)).not.toThrow()
    })

    it('should reject message with missing required fields', () => {
      const invalidMessage = {
        type: 'request',
        payload: { command: 'execute' }
        // missing id and timestamp
      } as any

      expect(() => validateAgentMessage(invalidMessage))
        .toThrow('Message validation failed: missing required field')
    })

    it('should reject message with null or undefined values', () => {
      const invalidMessage = {
        id: null,
        type: 'request',
        payload: { command: 'execute' },
        timestamp: Date.now()
      } as any

      expect(() => validateAgentMessage(invalidMessage))
        .toThrow('Message validation failed')
    })

    it('should reject empty message', () => {
      expect(() => validateAgentMessage({} as any))
        .toThrow('Message validation failed')
    })
  })

  describe('validateMessageStructure', () => {
    it('should validate message with all required fields', () => {
      const message = {
        id: 'test-id',
        type: 'request',
        payload: {},
        timestamp: Date.now()
      }

      expect(validateMessageStructure(message)).toBe(true)
    })

    it('should reject message with missing fields', () => {
      const message = {
        id: 'test-id',
        type: 'request'
        // missing payload and timestamp
      }

      expect(validateMessageStructure(message)).toBe(false)
    })

    it('should reject message with wrong field types', () => {
      const message = {
        id: 123, // should be string
        type: 'request',
        payload: {},
        timestamp: Date.now()
      }

      expect(validateMessageStructure(message)).toBe(false)
    })
  })

  describe('validateMessageType', () => {
    it('should accept valid message types', () => {
      const validTypes: MessageType[] = [
        'request', 'response', 'stream', 'stream-end', 'stream-error'
      ]

      validTypes.forEach(type => {
        expect(validateMessageType(type)).toBe(true)
      })
    })

    it('should reject invalid message types', () => {
      const invalidTypes = [
        'invalid-type',
        'REQUEST', // case sensitive
        'req',
        '',
        null,
        undefined,
        123
      ]

      invalidTypes.forEach(type => {
        expect(validateMessageType(type as any)).toBe(false)
      })
    })
  })

  describe('validateTimestamp', () => {
    it('should accept valid timestamps', () => {
      const now = Date.now()
      const pastTimestamp = now - 1000
      const futureTimestamp = now + 1000

      expect(validateTimestamp(now)).toBe(true)
      expect(validateTimestamp(pastTimestamp)).toBe(true)
      expect(validateTimestamp(futureTimestamp)).toBe(true)
    })

    it('should reject invalid timestamps', () => {
      const invalidTimestamps = [
        -1,
        'invalid-timestamp',
        null,
        undefined,
        NaN,
        Infinity,
        -Infinity
      ]

      invalidTimestamps.forEach(timestamp => {
        expect(validateTimestamp(timestamp as any)).toBe(false)
      })
    })

    it('should reject timestamps too far in the future', () => {
      const farFuture = Date.now() + (24 * 60 * 60 * 1000) // 24 hours from now
      expect(validateTimestamp(farFuture)).toBe(false)
    })

    it('should reject timestamps too far in the past', () => {
      const farPast = Date.now() - (7 * 24 * 60 * 60 * 1000) // 7 days ago
      expect(validateTimestamp(farPast)).toBe(false)
    })
  })

  describe('sanitizeMessage', () => {
    it('should sanitize message by removing dangerous content', () => {
      const message: AgentMessage = {
        id: 'test-id',
        type: 'request',
        payload: {
          command: 'execute',
          data: '<script>alert("xss")</script>Clean data',
          html: '<img src="x" onerror="alert(1)">'
        },
        timestamp: Date.now()
      }

      const sanitized = sanitizeMessage(message)

      expect(sanitized.payload.data).not.toContain('<script>')
      expect(sanitized.payload.html).not.toContain('onerror')
    })

    it('should preserve safe content', () => {
      const message: AgentMessage = {
        id: 'test-id', 
        type: 'request',
        payload: {
          command: 'execute',
          data: 'Safe content with numbers 123 and symbols !@#',
          config: { setting: true, value: 42 }
        },
        timestamp: Date.now()
      }

      const sanitized = sanitizeMessage(message)

      expect(sanitized.payload.data).toBe('Safe content with numbers 123 and symbols !@#')
      expect(sanitized.payload.config).toEqual({ setting: true, value: 42 })
    })

    it('should handle nested objects in payload', () => {
      const message: AgentMessage = {
        id: 'test-id',
        type: 'request', 
        payload: {
          nested: {
            deep: {
              content: '<script>evil()</script>Safe content'
            }
          }
        },
        timestamp: Date.now()
      }

      const sanitized = sanitizeMessage(message)

      expect(sanitized.payload.nested.deep.content).not.toContain('<script>')
      expect(sanitized.payload.nested.deep.content).toContain('Safe content')
    })

    it('should handle arrays in payload', () => {
      const message: AgentMessage = {
        id: 'test-id',
        type: 'request',
        payload: {
          items: [
            'Safe item',
            '<script>alert("xss")</script>Unsafe item',
            { text: '<img src="x" onerror="alert(1)">Text' }
          ]
        },
        timestamp: Date.now()
      }

      const sanitized = sanitizeMessage(message)
      
      expect(sanitized.payload.items[0]).toBe('Safe item')
      expect(sanitized.payload.items[1]).not.toContain('<script>')
      expect(sanitized.payload.items[2].text).not.toContain('onerror')
    })
  })

  describe('Edge Cases', () => {
    it('should handle very large messages', () => {
      const largeData = 'x'.repeat(1024 * 1024) // 1MB of data
      const message: AgentMessage = {
        id: 'large-message',
        type: 'request',
        payload: { data: largeData },
        timestamp: Date.now()
      }

      expect(() => validateAgentMessage(message)).not.toThrow()
    })

    it('should handle messages with circular references', () => {
      const circularPayload: any = { data: 'test' }
      circularPayload.self = circularPayload

      const message = {
        id: 'circular-message',
        type: 'request',
        payload: circularPayload,
        timestamp: Date.now()
      } as AgentMessage

      // Should handle gracefully without infinite recursion
      expect(() => sanitizeMessage(message)).not.toThrow()
    })

    it('should handle unicode and special characters', () => {
      const message: AgentMessage = {
        id: 'unicode-test',
        type: 'request',
        payload: {
          text: '你好世界 🌍 émojis and ünicode',
          symbols: '!@#$%^&*()[]{}|;:,.<>?'
        },
        timestamp: Date.now()
      }

      expect(() => validateAgentMessage(message)).not.toThrow()
      const sanitized = sanitizeMessage(message)
      expect(sanitized.payload.text).toContain('你好世界')
      expect(sanitized.payload.text).toContain('🌍')
    })
  })
})