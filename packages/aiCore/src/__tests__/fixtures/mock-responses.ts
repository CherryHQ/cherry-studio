/**
 * Mock Responses
 * Provides realistic mock responses for all provider types
 */

import { jsonSchema, type ModelMessage, type Tool } from 'ai'

/**
 * Standard test messages for all scenarios
 */
export const testMessages = {
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
} satisfies Record<string, ModelMessage[]>

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
 * Mock streaming chunks for different providers
 */
export const mockStreamingChunks = {
  text: [
    { type: 'text-delta' as const, textDelta: 'Hello' },
    { type: 'text-delta' as const, textDelta: ', ' },
    { type: 'text-delta' as const, textDelta: 'this ' },
    { type: 'text-delta' as const, textDelta: 'is ' },
    { type: 'text-delta' as const, textDelta: 'a ' },
    { type: 'text-delta' as const, textDelta: 'test.' }
  ],

  withToolCall: [
    { type: 'text-delta' as const, textDelta: 'Let me check the weather for you.' },
    {
      type: 'tool-call-delta' as const,
      toolCallType: 'function' as const,
      toolCallId: 'call_123',
      toolName: 'getWeather',
      argsTextDelta: '{"location":'
    },
    {
      type: 'tool-call-delta' as const,
      toolCallType: 'function' as const,
      toolCallId: 'call_123',
      toolName: 'getWeather',
      argsTextDelta: ' "San Francisco, CA"}'
    },
    {
      type: 'tool-call' as const,
      toolCallType: 'function' as const,
      toolCallId: 'call_123',
      toolName: 'getWeather',
      args: { location: 'San Francisco, CA' }
    }
  ],

  withFinish: [
    { type: 'text-delta' as const, textDelta: 'Complete response.' },
    {
      type: 'finish' as const,
      finishReason: 'stop' as const,
      usage: {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15
      }
    }
  ]
}

/**
 * Mock complete responses for non-streaming scenarios
 */
export const mockCompleteResponses = {
  simple: {
    text: 'This is a simple response.',
    finishReason: 'stop' as const,
    usage: {
      promptTokens: 15,
      completionTokens: 8,
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
      promptTokens: 25,
      completionTokens: 12,
      totalTokens: 37
    }
  },

  withWarnings: {
    text: 'Response with warnings.',
    finishReason: 'stop' as const,
    usage: {
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15
    },
    warnings: [
      {
        type: 'unsupported-setting' as const,
        message: 'Temperature parameter not supported for this model'
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

/**
 * Mock error responses
 */
export const mockErrors = {
  invalidApiKey: {
    name: 'APIError',
    message: 'Invalid API key provided',
    statusCode: 401
  },

  rateLimitExceeded: {
    name: 'RateLimitError',
    message: 'Rate limit exceeded. Please try again later.',
    statusCode: 429,
    headers: {
      'retry-after': '60'
    }
  },

  modelNotFound: {
    name: 'ModelNotFoundError',
    message: 'The requested model was not found',
    statusCode: 404
  },

  contextLengthExceeded: {
    name: 'ContextLengthError',
    message: "This model's maximum context length is 4096 tokens",
    statusCode: 400
  },

  timeout: {
    name: 'TimeoutError',
    message: 'Request timed out after 30000ms',
    code: 'ETIMEDOUT'
  },

  networkError: {
    name: 'NetworkError',
    message: 'Network connection failed',
    code: 'ECONNREFUSED'
  }
}
