import type { MessageCreateParams } from '@anthropic-ai/sdk/resources/messages'
import { describe, expect, it } from 'vitest'

import { AnthropicMessageConverter } from '../../adapters/converters/AnthropicMessageConverter'

// Create a converter instance for testing
const converter = new AnthropicMessageConverter()

// Helper functions that wrap the converter methods
const convertAnthropicToAiMessages = (params: MessageCreateParams) => converter.toAiSdkMessages(params)
const convertAnthropicToolsToAiSdk = (tools: MessageCreateParams['tools']) =>
  converter.toAiSdkTools({ model: 'test', max_tokens: 100, messages: [], tools })

describe('AnthropicMessageConverter', () => {
  describe('toAiSdkTools', () => {
    it('should return undefined for empty tools array', () => {
      const result = convertAnthropicToolsToAiSdk([])
      expect(result).toBeUndefined()
    })

    it('should return undefined for undefined tools', () => {
      const result = convertAnthropicToolsToAiSdk(undefined)
      expect(result).toBeUndefined()
    })

    it('should convert simple tool with string schema', () => {
      const anthropicTools: MessageCreateParams['tools'] = [
        {
          type: 'custom',
          name: 'get_weather',
          description: 'Get current weather',
          input_schema: {
            type: 'object',
            properties: {
              location: { type: 'string' }
            },
            required: ['location']
          }
        }
      ]

      const result = convertAnthropicToolsToAiSdk(anthropicTools)
      expect(result).toBeDefined()
      expect(result).toHaveProperty('get_weather')
      expect(result!.get_weather).toHaveProperty('description', 'Get current weather')
    })

    it('should convert multiple tools', () => {
      const anthropicTools: MessageCreateParams['tools'] = [
        {
          type: 'custom',
          name: 'tool1',
          description: 'First tool',
          input_schema: {
            type: 'object',
            properties: {}
          }
        },
        {
          type: 'custom',
          name: 'tool2',
          description: 'Second tool',
          input_schema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const result = convertAnthropicToolsToAiSdk(anthropicTools)
      expect(result).toBeDefined()
      expect(Object.keys(result!)).toHaveLength(2)
      expect(result).toHaveProperty('tool1')
      expect(result).toHaveProperty('tool2')
    })

    it('should convert tool with complex schema', () => {
      const anthropicTools: MessageCreateParams['tools'] = [
        {
          type: 'custom',
          name: 'search',
          description: 'Search for information',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string', minLength: 1 },
              limit: { type: 'integer', minimum: 1, maximum: 100 },
              filters: {
                type: 'array',
                items: { type: 'string' }
              }
            },
            required: ['query']
          }
        }
      ]

      const result = convertAnthropicToolsToAiSdk(anthropicTools)
      expect(result).toBeDefined()
      expect(result).toHaveProperty('search')
    })

    it('should skip bash_20250124 tool type', () => {
      const anthropicTools: MessageCreateParams['tools'] = [
        {
          type: 'bash_20250124',
          name: 'bash'
        },
        {
          type: 'custom',
          name: 'regular_tool',
          description: 'A regular tool',
          input_schema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const result = convertAnthropicToolsToAiSdk(anthropicTools)
      expect(result).toBeDefined()
      expect(Object.keys(result!)).toHaveLength(1)
      expect(result).toHaveProperty('regular_tool')
      expect(result).not.toHaveProperty('bash')
    })

    it('should handle tool with no description', () => {
      const anthropicTools: MessageCreateParams['tools'] = [
        {
          type: 'custom',
          name: 'no_desc_tool',
          input_schema: {
            type: 'object',
            properties: {}
          }
        }
      ]

      const result = convertAnthropicToolsToAiSdk(anthropicTools)
      expect(result).toBeDefined()
      expect(result).toHaveProperty('no_desc_tool')
      expect(result!.no_desc_tool).toHaveProperty('description', '')
    })
  })

  describe('toAiSdkMessages', () => {
    describe('System Messages', () => {
      it('should convert string system message', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: 'You are a helpful assistant.',
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(2)
        expect(result[0]).toEqual({
          role: 'system',
          content: 'You are a helpful assistant.'
        })
      })

      it('should convert array system message', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: [
            { type: 'text', text: 'Instruction 1' },
            { type: 'text', text: 'Instruction 2' }
          ],
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result[0]).toEqual({
          role: 'system',
          content: 'Instruction 1\nInstruction 2'
        })
      })

      it('should handle no system message', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: 'Hello'
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result[0].role).toBe('user')
      })
    })

    describe('Text Messages', () => {
      it('should convert simple string message', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: 'Hello, world!'
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          role: 'user',
          content: 'Hello, world!'
        })
      })

      it('should convert text block array', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'First part' },
                { type: 'text', text: 'Second part' }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(1)
        expect(result[0].role).toBe('user')
        expect(Array.isArray(result[0].content)).toBe(true)
        if (Array.isArray(result[0].content)) {
          expect(result[0].content).toHaveLength(2)
          expect(result[0].content[0]).toEqual({ type: 'text', text: 'First part' })
          expect(result[0].content[1]).toEqual({ type: 'text', text: 'Second part' })
        }
      })

      it('should convert assistant message', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: 'Hello'
            },
            {
              role: 'assistant',
              content: 'Hi there!'
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(2)
        expect(result[1]).toEqual({
          role: 'assistant',
          content: 'Hi there!'
        })
      })
    })

    describe('Image Messages', () => {
      it('should convert base64 image', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: 'iVBORw0KGgo='
                  }
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(1)
        expect(Array.isArray(result[0].content)).toBe(true)
        if (Array.isArray(result[0].content)) {
          expect(result[0].content).toHaveLength(1)
          const imagePart = result[0].content[0]
          if (imagePart.type === 'image') {
            expect(imagePart.image).toBe('data:image/png;base64,iVBORw0KGgo=')
          }
        }
      })

      it('should convert URL image', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: 'https://example.com/image.png'
                  }
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        if (Array.isArray(result[0].content)) {
          const imagePart = result[0].content[0]
          if (imagePart.type === 'image') {
            expect(imagePart.image).toBe('https://example.com/image.png')
          }
        }
      })

      it('should convert mixed text and image content', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Look at this:' },
                {
                  type: 'image',
                  source: {
                    type: 'url',
                    url: 'https://example.com/pic.jpg'
                  }
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        if (Array.isArray(result[0].content)) {
          expect(result[0].content).toHaveLength(2)
          expect(result[0].content[0].type).toBe('text')
          expect(result[0].content[1].type).toBe('image')
        }
      })
    })

    describe('Tool Messages', () => {
      it('should convert tool_use block', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: 'What is the weather?'
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_123',
                  name: 'get_weather',
                  input: { location: 'San Francisco' }
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(2)
        const assistantMsg = result[1]
        expect(assistantMsg.role).toBe('assistant')
        if (Array.isArray(assistantMsg.content)) {
          expect(assistantMsg.content).toHaveLength(1)
          const toolCall = assistantMsg.content[0]
          if (toolCall.type === 'tool-call') {
            expect(toolCall.toolName).toBe('get_weather')
            expect(toolCall.toolCallId).toBe('call_123')
            expect(toolCall.input).toEqual({ location: 'San Francisco' })
          }
        }
      })

      it('should convert tool_result with string content', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_123',
                  name: 'get_weather',
                  input: {}
                }
              ]
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_123',
                  content: 'Temperature is 72°F'
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        const toolMsg = result[1]
        expect(toolMsg.role).toBe('tool')
        if (Array.isArray(toolMsg.content)) {
          expect(toolMsg.content).toHaveLength(1)
          const toolResult = toolMsg.content[0]
          if (toolResult.type === 'tool-result') {
            expect(toolResult.toolCallId).toBe('call_123')
            expect(toolResult.toolName).toBe('get_weather')
            if (toolResult.output.type === 'text') {
              expect(toolResult.output.value).toBe('Temperature is 72°F')
            }
          }
        }
      })

      it('should convert tool_result with array content', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_456',
                  name: 'analyze',
                  input: {}
                }
              ]
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_456',
                  content: [
                    { type: 'text', text: 'Result part 1' },
                    { type: 'text', text: 'Result part 2' }
                  ]
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        const toolMsg = result[1]
        if (Array.isArray(toolMsg.content)) {
          const toolResult = toolMsg.content[0]
          if (toolResult.type === 'tool-result' && toolResult.output.type === 'content') {
            expect(toolResult.output.value).toHaveLength(2)
            expect(toolResult.output.value[0]).toEqual({ type: 'text', text: 'Result part 1' })
            expect(toolResult.output.value[1]).toEqual({ type: 'text', text: 'Result part 2' })
          }
        }
      })

      it('should convert tool_result with image content', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_789',
                  name: 'screenshot',
                  input: {}
                }
              ]
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_789',
                  content: [
                    {
                      type: 'image',
                      source: {
                        type: 'base64',
                        media_type: 'image/png',
                        data: 'abc123'
                      }
                    }
                  ]
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        const toolMsg = result[1]
        if (Array.isArray(toolMsg.content)) {
          const toolResult = toolMsg.content[0]
          if (toolResult.type === 'tool-result' && toolResult.output.type === 'content') {
            expect(toolResult.output.value).toHaveLength(1)
            const media = toolResult.output.value[0]
            if (media.type === 'media') {
              expect(media.data).toBe('abc123')
              expect(media.mediaType).toBe('image/png')
            }
          }
        }
      })

      it('should handle multiple tool calls', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_1',
                  name: 'tool1',
                  input: {}
                },
                {
                  type: 'tool_use',
                  id: 'call_2',
                  name: 'tool2',
                  input: {}
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        if (Array.isArray(result[0].content)) {
          expect(result[0].content).toHaveLength(2)
          expect(result[0].content[0].type).toBe('tool-call')
          expect(result[0].content[1].type).toBe('tool-call')
        }
      })
    })

    describe('Thinking Content', () => {
      it('should convert thinking block to reasoning', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'thinking',
                  thinking: 'Let me analyze this...',
                  signature: 'sig123'
                },
                {
                  type: 'text',
                  text: 'Here is my answer'
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        if (Array.isArray(result[0].content)) {
          expect(result[0].content).toHaveLength(2)
          const reasoning = result[0].content[0]
          if (reasoning.type === 'reasoning') {
            expect(reasoning.text).toBe('Let me analyze this...')
          }
          const text = result[0].content[1]
          if (text.type === 'text') {
            expect(text.text).toBe('Here is my answer')
          }
        }
      })

      it('should convert redacted_thinking to reasoning', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'redacted_thinking',
                  data: '[Redacted]'
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        if (Array.isArray(result[0].content)) {
          expect(result[0].content).toHaveLength(1)
          const reasoning = result[0].content[0]
          if (reasoning.type === 'reasoning') {
            expect(reasoning.text).toBe('[Redacted]')
          }
        }
      })
    })

    describe('Multi-turn Conversations', () => {
      it('should handle complete conversation flow', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          system: 'You are a helpful assistant.',
          messages: [
            {
              role: 'user',
              content: 'What is the weather in SF?'
            },
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'weather_call',
                  name: 'get_weather',
                  input: { location: 'SF' }
                }
              ]
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'weather_call',
                  content: '72°F and sunny'
                }
              ]
            },
            {
              role: 'assistant',
              content: 'The weather in San Francisco is 72°F and sunny.'
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(5)
        expect(result[0].role).toBe('system')
        expect(result[1].role).toBe('user')
        expect(result[2].role).toBe('assistant')
        expect(result[3].role).toBe('tool')
        expect(result[4].role).toBe('assistant')
      })
    })

    describe('Edge Cases', () => {
      it('should handle empty content array for user', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: []
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(0)
      })

      it('should handle empty content array for assistant', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: []
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(0)
      })

      it('should handle tool_result without matching tool_use', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'unknown_call',
                  content: 'Some result'
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        expect(result).toHaveLength(1)
        if (Array.isArray(result[0].content)) {
          const toolResult = result[0].content[0]
          if (toolResult.type === 'tool-result') {
            expect(toolResult.toolName).toBe('unknown')
          }
        }
      })

      it('should handle tool_result with empty content', () => {
        const params: MessageCreateParams = {
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          messages: [
            {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: 'call_empty',
                  name: 'empty_tool',
                  input: {}
                }
              ]
            },
            {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'call_empty'
                }
              ]
            }
          ]
        }

        const result = convertAnthropicToAiMessages(params)
        const toolMsg = result[1]
        if (Array.isArray(toolMsg.content)) {
          const toolResult = toolMsg.content[0]
          if (toolResult.type === 'tool-result' && toolResult.output.type === 'text') {
            expect(toolResult.output.value).toBe('')
          }
        }
      })
    })
  })
})
