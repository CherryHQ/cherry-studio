/**
 * Mock Responses
 * Provides realistic mock responses for all provider types
 */

import type { ModelMessage, Tool } from 'ai'
import { jsonSchema } from 'ai'

/**
 * Standard test messages for all scenarios
 */
export const testMessages: Record<string, ModelMessage[]> = {
  simple: [{ role: 'user' as const, content: 'Hello, how are you?' }],

  conversation: [
    { role: 'user' as const, content: 'What is the capital of France?' },
    { role: 'assistant' as const, content: 'The capital of France is Paris.' },
    { role: 'user' as const, content: 'What is its population?' }
  ],

  withSystem: [
    { role: 'system' as const, content: 'You are a helpful assistant that provides concise answers.' },
    { role: 'user' as const, content: 'Explain quantum computing in one sentence.' }
  ],

  withImages: [
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: 'What is in this image?' },
        {
          type: 'image' as const,
          image:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
        }
      ]
    }
  ],

  toolUse: [{ role: 'user' as const, content: 'What is the weather in San Francisco?' }],

  multiTurn: [
    { role: 'user' as const, content: 'Can you help me with a math problem?' },
    { role: 'assistant' as const, content: 'Of course! What math problem would you like help with?' },
    { role: 'user' as const, content: 'What is 15 * 23?' },
    { role: 'assistant' as const, content: '15 * 23 = 345' },
    { role: 'user' as const, content: 'Now divide that by 5' }
  ]
}

/**
 * Standard test tools for tool calling scenarios
 */
export const testTools: Record<string, Tool> = {
  getWeather: {
    description: 'Get the current weather in a given location',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        location: {
          type: 'string',
          description: 'The city and state, e.g. San Francisco, CA'
        },
        unit: {
          type: 'string',
          enum: ['celsius', 'fahrenheit'],
          description: 'The temperature unit to use'
        }
      },
      required: ['location']
    }),
    execute: async ({ location, unit = 'fahrenheit' }) => {
      return {
        location,
        temperature: unit === 'celsius' ? 22 : 72,
        unit,
        condition: 'sunny'
      }
    }
  },

  calculate: {
    description: 'Perform a mathematical calculation',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['add', 'subtract', 'multiply', 'divide'],
          description: 'The operation to perform'
        },
        a: {
          type: 'number',
          description: 'The first number'
        },
        b: {
          type: 'number',
          description: 'The second number'
        }
      },
      required: ['operation', 'a', 'b']
    }),
    execute: async ({ operation, a, b }) => {
      const operations = {
        add: (x: number, y: number) => x + y,
        subtract: (x: number, y: number) => x - y,
        multiply: (x: number, y: number) => x * y,
        divide: (x: number, y: number) => x / y
      }
      return { result: operations[operation as keyof typeof operations](a, b) }
    }
  },

  searchDatabase: {
    description: 'Search for information in a database',
    inputSchema: jsonSchema({
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return',
          default: 10
        }
      },
      required: ['query']
    }),
    execute: async ({ query, limit = 10 }) => {
      return {
        results: [
          { id: 1, title: `Result 1 for ${query}`, relevance: 0.95 },
          { id: 2, title: `Result 2 for ${query}`, relevance: 0.87 }
        ].slice(0, limit)
      }
    }
  }
}

/**
 * Mock complete responses for non-streaming scenarios
 * Note: AI SDK v5 uses inputTokens/outputTokens instead of promptTokens/completionTokens
 */
export const mockCompleteResponses = {
  simple: {
    text: 'This is a simple response.',
    finishReason: 'stop' as const,
    usage: {
      inputTokens: 15,
      outputTokens: 8,
      totalTokens: 23
    }
  },

  withToolCalls: {
    text: 'I will check the weather for you.',
    toolCalls: [
      {
        toolCallId: 'call_456',
        toolName: 'getWeather',
        args: { location: 'New York, NY', unit: 'celsius' }
      }
    ],
    finishReason: 'tool-calls' as const,
    usage: {
      inputTokens: 25,
      outputTokens: 12,
      totalTokens: 37
    }
  },

  withWarnings: {
    text: 'Response with warnings.',
    finishReason: 'stop' as const,
    usage: {
      inputTokens: 10,
      outputTokens: 5,
      totalTokens: 15
    },
    warnings: [
      {
        type: 'unsupported-setting' as const,
        setting: 'temperature',
        details: 'Temperature parameter not supported for this model'
      }
    ]
  }
}

/**
 * Mock image generation responses
 */
export const mockImageResponses = {
  single: {
    image: {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      uint8Array: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]),
      mimeType: 'image/png' as const
    },
    warnings: []
  },

  multiple: {
    images: [
      {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        uint8Array: new Uint8Array([137, 80, 78, 71]),
        mimeType: 'image/png' as const
      },
      {
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGACCKAgdZ9zImAAAAAElFTkSuQmCC',
        uint8Array: new Uint8Array([137, 80, 78, 71]),
        mimeType: 'image/png' as const
      }
    ],
    warnings: []
  },

  withProviderMetadata: {
    image: {
      base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      uint8Array: new Uint8Array([137, 80, 78, 71]),
      mimeType: 'image/png' as const
    },
    providerMetadata: {
      openai: {
        images: [
          {
            revisedPrompt: 'A detailed and enhanced version of the original prompt'
          }
        ]
      }
    },
    warnings: []
  }
}
