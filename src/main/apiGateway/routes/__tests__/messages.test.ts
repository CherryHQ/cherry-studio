import { describe, expect, it } from 'vitest'

import { estimateTokenCount } from '../messages'

describe('estimateTokenCount', () => {
  describe('Text Content', () => {
    it('should estimate tokens for simple string content', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: 'Hello, world!'
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include text tokens + role overhead (3)
      expect(tokens).toBeGreaterThan(3)
      expect(tokens).toBeLessThan(20)
    })

    it('should estimate tokens for multiple messages', () => {
      const input = {
        messages: [
          { role: 'user' as const, content: 'First message' },
          { role: 'assistant' as const, content: 'Second message' },
          { role: 'user' as const, content: 'Third message' }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include text tokens + role overhead (3 per message = 9)
      expect(tokens).toBeGreaterThan(9)
    })

    it('should estimate tokens for text content blocks', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: 'Hello' },
              { type: 'text' as const, text: 'World' }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      expect(tokens).toBeGreaterThan(3)
    })

    it('should handle empty messages array', () => {
      const input = {
        messages: []
      }
      const tokens = estimateTokenCount(input)
      expect(tokens).toBe(0)
    })

    it('should handle messages with empty content', () => {
      const input = {
        messages: [{ role: 'user' as const, content: '' }]
      }
      const tokens = estimateTokenCount(input)
      // Should only have role overhead (3)
      expect(tokens).toBe(3)
    })
  })

  describe('System Messages', () => {
    it('should estimate tokens for string system message', () => {
      const input = {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        system: 'You are a helpful assistant.'
      }
      const tokens = estimateTokenCount(input)
      // Should include system tokens + message tokens + role overhead
      expect(tokens).toBeGreaterThan(3)
    })

    it('should estimate tokens for system content blocks', () => {
      const input = {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        system: [
          { type: 'text' as const, text: 'System instruction 1' },
          { type: 'text' as const, text: 'System instruction 2' }
        ]
      }
      const tokens = estimateTokenCount(input)
      expect(tokens).toBeGreaterThan(3)
    })
  })

  describe('Image Content', () => {
    it('should estimate tokens for base64 images', () => {
      // Create a fake base64 string (400 characters = ~300 bytes when decoded)
      const fakeBase64 = 'A'.repeat(400)
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: {
                  type: 'base64' as const,
                  media_type: 'image/png' as const,
                  data: fakeBase64
                }
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should estimate based on data size: 400 * 0.75 / 100 = 3 tokens + role overhead (3)
      expect(tokens).toBeGreaterThan(3)
      expect(tokens).toBeLessThan(10)
    })

    it('should estimate tokens for URL images', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: {
                  type: 'url' as const,
                  url: 'https://example.com/image.png'
                }
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should use default estimate: 1000 + role overhead (3)
      expect(tokens).toBe(1003)
    })

    it('should estimate tokens for mixed text and image content', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: 'What is in this image?' },
              {
                type: 'image' as const,
                source: {
                  type: 'url' as const,
                  url: 'https://example.com/image.png'
                }
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include text tokens + 1000 (image) + role overhead (3)
      expect(tokens).toBeGreaterThan(1003)
    })
  })

  describe('Tool Content', () => {
    it('should estimate tokens for tool_use blocks', () => {
      const input = {
        messages: [
          {
            role: 'assistant' as const,
            content: [
              {
                type: 'tool_use' as const,
                id: 'tool_123',
                name: 'get_weather',
                input: { location: 'San Francisco', unit: 'celsius' }
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include: tool name tokens + input JSON tokens + 10 (overhead) + 3 (role)
      expect(tokens).toBeGreaterThan(13)
    })

    it('should estimate tokens for tool_result blocks with string content', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: 'tool_123',
                content: 'The weather in San Francisco is 18°C and sunny.'
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include: content tokens + 10 (overhead) + 3 (role)
      expect(tokens).toBeGreaterThan(13)
    })

    it('should estimate tokens for tool_result blocks with array content', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: 'tool_123',
                content: [
                  { type: 'text' as const, text: 'Result 1' },
                  { type: 'text' as const, text: 'Result 2' }
                ]
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include: text tokens + 10 (overhead) + 3 (role)
      expect(tokens).toBeGreaterThan(13)
    })

    it('should handle tool_use without input', () => {
      const input = {
        messages: [
          {
            role: 'assistant' as const,
            content: [
              {
                type: 'tool_use' as const,
                id: 'tool_123',
                name: 'no_input_tool',
                input: {}
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should include: tool name tokens + 10 (overhead) + 3 (role)
      expect(tokens).toBeGreaterThan(13)
    })
  })

  describe('Complex Scenarios', () => {
    it('should estimate tokens for multi-turn conversation with various content types', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              { type: 'text' as const, text: 'Analyze this image' },
              {
                type: 'image' as const,
                source: {
                  type: 'url' as const,
                  url: 'https://example.com/chart.png'
                }
              }
            ]
          },
          {
            role: 'assistant' as const,
            content: [
              {
                type: 'tool_use' as const,
                id: 'tool_1',
                name: 'analyze_image',
                input: { url: 'https://example.com/chart.png' }
              }
            ]
          },
          {
            role: 'user' as const,
            content: [
              {
                type: 'tool_result' as const,
                tool_use_id: 'tool_1',
                content: 'The chart shows sales data for Q4 2024.'
              }
            ]
          },
          {
            role: 'assistant' as const,
            content: 'Based on the analysis, the sales trend is positive.'
          }
        ],
        system: 'You are a data analyst assistant.'
      }
      const tokens = estimateTokenCount(input)
      // Should include:
      // - System message tokens
      // - Message 1: text + image (1000) + 3
      // - Message 2: tool_use + 10 + 3
      // - Message 3: tool_result + 10 + 3
      // - Message 4: text + 3
      expect(tokens).toBeGreaterThan(1032) // At least 1000 (image) + 32 (overhead)
    })

    it('should handle very long text content', () => {
      const longText = 'word '.repeat(1000) // ~5000 characters
      const input = {
        messages: [{ role: 'user' as const, content: longText }]
      }
      const tokens = estimateTokenCount(input)
      // Should estimate based on text length using tokenx
      expect(tokens).toBeGreaterThan(1000)
    })

    it('should handle multiple images in single message', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'image' as const,
                source: { type: 'url' as const, url: 'https://example.com/1.png' }
              },
              {
                type: 'image' as const,
                source: { type: 'url' as const, url: 'https://example.com/2.png' }
              },
              {
                type: 'image' as const,
                source: { type: 'url' as const, url: 'https://example.com/3.png' }
              }
            ]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should estimate: 3 * 1000 (images) + 3 (role)
      expect(tokens).toBe(3003)
    })
  })

  describe('Edge Cases', () => {
    it('should handle undefined system message', () => {
      const input = {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        system: undefined
      }
      const tokens = estimateTokenCount(input)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle empty system message', () => {
      const input = {
        messages: [{ role: 'user' as const, content: 'Hello' }],
        system: ''
      }
      const tokens = estimateTokenCount(input)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should handle content blocks with missing text', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: [{ type: 'text' as const, text: undefined as any }]
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should only have role overhead
      expect(tokens).toBe(3)
    })

    it('should handle empty content array', () => {
      const input = {
        messages: [
          {
            role: 'user' as const,
            content: []
          }
        ]
      }
      const tokens = estimateTokenCount(input)
      // Should only have role overhead
      expect(tokens).toBe(3)
    })
  })
})
