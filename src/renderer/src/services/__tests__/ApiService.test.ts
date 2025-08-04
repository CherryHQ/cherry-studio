import { ToolUseBlock } from '@anthropic-ai/sdk/resources'
import {
  TextBlock,
  TextDelta,
  Usage,
  WebSearchResultBlock,
  WebSearchToolResultError
} from '@anthropic-ai/sdk/resources/messages'
import { FinishReason, MediaModality } from '@google/genai'
import { FunctionCall } from '@google/genai'
import AiProvider from '@renderer/aiCore'
import { BaseApiClient, OpenAIAPIClient, ResponseChunkTransformerContext } from '@renderer/aiCore/clients'
import { AnthropicAPIClient } from '@renderer/aiCore/clients/anthropic/AnthropicAPIClient'
import { ApiClientFactory } from '@renderer/aiCore/clients/ApiClientFactory'
import { GeminiAPIClient } from '@renderer/aiCore/clients/gemini/GeminiAPIClient'
import { OpenAIResponseAPIClient } from '@renderer/aiCore/clients/openai/OpenAIResponseAPIClient'
import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import { isVisionModel } from '@renderer/config/models'
import { Assistant, MCPCallToolResponse, MCPToolResponse, Model, Provider, WebSearchSource } from '@renderer/types'
import {
  Chunk,
  ChunkType,
  LLMResponseCompleteChunk,
  LLMWebSearchCompleteChunk,
  TextDeltaChunk,
  TextStartChunk,
  ThinkingStartChunk
} from '@renderer/types/chunk'
import {
  AnthropicSdkRawChunk,
  GeminiSdkMessageParam,
  GeminiSdkRawChunk,
  GeminiSdkToolCall,
  OpenAISdkRawChunk,
  OpenAISdkRawContentSource
} from '@renderer/types/sdk'
import { mcpToolCallResponseToGeminiMessage } from '@renderer/utils/mcp-tools'
import * as McpToolsModule from '@renderer/utils/mcp-tools'
import { cloneDeep } from 'lodash'
import OpenAI from 'openai'
import { ChatCompletionChunk } from 'openai/resources'
import { beforeEach, describe, expect, it, vi } from 'vitest'
// Mock the ApiClientFactory
vi.mock('@renderer/aiCore/clients/ApiClientFactory', () => ({
  ApiClientFactory: {
    create: vi.fn()
  }
}))

// Mock the models config
vi.mock('@renderer/config/models', () => ({
  isDedicatedImageGenerationModel: vi.fn(() => false),
  isTextToImageModel: vi.fn(() => false),
  isEmbeddingModel: vi.fn(() => false),
  isRerankModel: vi.fn(() => false),
  isVisionModel: vi.fn(() => false),
  isReasoningModel: vi.fn(() => false),
  isWebSearchModel: vi.fn(() => false),
  isOpenAIModel: vi.fn(() => false),
  isFunctionCallingModel: vi.fn(() => true),
  models: {
    gemini: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro'
    }
  },
  isAnthropicModel: vi.fn(() => false)
}))

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid')
}))

// Mock other necessary modules
vi.mock('@renderer/services/AssistantService', () => ({
  getProviderByModel: vi.fn(() => ({ id: 'gemini', name: 'Gemini' })),
  getDefaultAssistant: vi.fn(() => ({
    id: 'mock-assistant',
    name: 'Mock Assistant',
    model: { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' }
  })),
  getDefaultTopic: vi.fn(() => ({
    id: 'mock-topic',
    assistantId: 'mock-assistant',
    createdAt: new Date().toISOString(),
    messages: []
  }))
}))

vi.mock('@renderer/utils', () => ({
  getLowerBaseModelName: vi.fn((name) => name.toLowerCase())
}))

vi.mock('@renderer/config/prompts', () => ({
  WEB_SEARCH_PROMPT_FOR_OPENROUTER: 'mock-prompt'
}))

vi.mock('@renderer/config/systemModels', () => ({
  GENERATE_IMAGE_MODELS: [],
  SUPPORTED_DISABLE_GENERATION_MODELS: []
}))

vi.mock('@renderer/config/tools', () => ({
  getWebSearchTools: vi.fn(() => [])
}))

// Mock store modules
vi.mock('@renderer/store/assistants', () => ({
  default: (state = { assistants: [] }) => state
}))

vi.mock('@renderer/store/agents', () => ({
  default: (state = { agents: [] }) => state
}))

vi.mock('@renderer/store/backup', () => ({
  default: (state = { backups: [] }) => state
}))

vi.mock('@renderer/store/chat', () => ({
  default: (state = { messages: [] }) => state
}))

vi.mock('@renderer/store/files', () => ({
  default: (state = { files: [] }) => state
}))

vi.mock('@renderer/store/knowledge', () => ({
  default: (state = { knowledge: [] }) => state
}))

vi.mock('@renderer/store/paintings', () => ({
  default: (state = { paintings: [] }) => state
}))

vi.mock('@renderer/store/runtime', () => ({
  default: (state = { runtime: {} }) => state
}))

vi.mock('@renderer/store/settings', () => ({
  default: (state = { settings: {} }) => state
}))

vi.mock('@renderer/store/topics', () => ({
  default: (state = { topics: [] }) => state
}))

vi.mock('@renderer/store/translate', () => ({
  default: (state = { translate: {} }) => state
}))

vi.mock('@renderer/store/websearch', () => ({
  default: (state = { websearch: {} }) => state
}))

vi.mock('@renderer/store/migrate', () => ({
  default: vi.fn().mockResolvedValue(undefined)
}))

// Mock the llm store with a proper reducer function
vi.mock('@renderer/store/llm.ts', () => {
  const mockInitialState = {
    providers: [
      {
        id: 'gemini',
        name: 'Gemini',
        type: 'gemini',
        apiKey: 'mock-api-key',
        apiHost: 'mock-api-host',
        models: [
          {
            id: 'gemini-2.5-pro',
            name: 'Gemini 2.5 Pro',
            provider: 'gemini',
            supported_text_delta: true
          }
        ],
        isSystem: true,
        enabled: true
      }
    ],
    defaultModel: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'gemini',
      supported_text_delta: true
    },
    topicNamingModel: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'gemini',
      supported_text_delta: true
    },
    translateModel: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'gemini',
      supported_text_delta: true
    },
    quickAssistantId: '',
    settings: {
      ollama: { keepAliveTime: 0 },
      lmstudio: { keepAliveTime: 0 },
      gpustack: { keepAliveTime: 0 },
      vertexai: {
        serviceAccount: {
          privateKey: '',
          clientEmail: ''
        },
        projectId: '',
        location: ''
      }
    }
  }

  const mockReducer = (state = mockInitialState) => {
    return state
  }

  return {
    default: mockReducer,
    initialState: mockInitialState
  }
})

vi.mock('@renderer/store/mcp.ts', () => {
  const mockInitialState = {
    servers: [{ id: 'mcp-server-1', name: 'mcp-server-1', isActive: true, disabledAutoApproveTools: [] }]
  }
  return {
    default: (state = mockInitialState) => {
      return state
    }
  }
})

// 测试用例：将 Gemini API 响应数据转换为 geminiChunks 数组
const geminiChunks: GeminiSdkRawChunk[] = [
  {
    candidates: [
      {
        content: {
          parts: [{ text: 'Hi, 1212312312' }],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 383,
      candidatesTokenCount: 5,
      totalTokenCount: 1157,
      promptTokensDetails: [
        {
          modality: MediaModality.TEXT,
          tokenCount: 383
        }
      ],
      thoughtsTokenCount: 769
    },
    modelVersion: 'gemini-2.5-pro',
    responseId: 'C75waL7rNsPRjrEP3MS5-A8'
  } as GeminiSdkRawChunk,

  // 第二个 chunk - 中间响应
  {
    candidates: [
      {
        content: {
          parts: [{ text: '！\n\n我是 Gemini 2.5 Pro，很高兴能为您服务。\n\n今天有什么可以帮您的吗？无论您是' }],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 383,
      candidatesTokenCount: 32,
      totalTokenCount: 1184,
      promptTokensDetails: [
        {
          modality: MediaModality.TEXT,
          tokenCount: 383
        }
      ],
      thoughtsTokenCount: 769
    },
    modelVersion: 'gemini-2.5-pro',
    responseId: 'C75waL7rNsPRjrEP3MS5-A8'
  } as GeminiSdkRawChunk,

  // 第三个 chunk - 结束响应
  {
    candidates: [
      {
        content: {
          parts: [{ text: '想寻找信息、进行创作，还是有任何其他问题，我都在这里准备好提供帮助。' }],
          role: 'model'
        },
        finishReason: FinishReason.STOP,
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 383,
      candidatesTokenCount: 53,
      totalTokenCount: 1205,
      promptTokensDetails: [
        {
          modality: MediaModality.TEXT,
          tokenCount: 383
        }
      ],
      thoughtsTokenCount: 769
    },
    modelVersion: 'gemini-2.5-pro',
    responseId: 'C75waL7rNsPRjrEP3MS5-A8'
  } as GeminiSdkRawChunk
]

const geminiThinkingChunks: GeminiSdkRawChunk[] = [
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: `**Analyzing Core Functionality**\n\nI've identified the core query: "What can I do?" expressed in Chinese. Recognizing my nature as a Google-trained language model is the foundation for a relevant response. This fundamental understanding guides the development of an effective answer.\n\n\n`,
              thought: true
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 1,
      totalTokenCount: 1020,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 69
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: `**Formulating the Chinese Response**\n\nI'm now drafting a Chinese response. I've moved past the initial simple sentence and am incorporating more detail. The goal is a clear, concise list of my key capabilities, tailored for a user asking about my function. I'm focusing on "understanding and generating text," "answering questions," and "translating languages" for now. Refining the exact phrasing for optimal clarity is an ongoing focus.\n\n\n`,
              thought: true
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 1,
      totalTokenCount: 1020,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 318
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: `**Categorizing My Abilities**\n\nI'm organizing my thoughts to classify the capabilities in my response. I'm grouping functions like text generation and question answering, then differentiating them from specialized features, such as translation and creative writing. Considering the best structure for clarity and comprehensiveness, I am refining the outline for my reply. I'm aiming for concise categories that clearly illustrate the range of my functionality in the response. I'm adding an optional explanation of my training to enrich the overall response.\n\n\n`,
              thought: true
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      totalTokenCount: 820,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 826
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: `**Developing the Chinese Draft**\n\nI'm now iterating on the final Chinese response. I've refined the categories to highlight my versatility. I'm focusing on "understanding and generating text" and "answering questions", and adding a section on how I can perform creative writing tasks. I'm aiming for concise explanations for clarity. I will also include a call to action at the end. I'm considering adding an optional sentence describing how I learned the data I know.\n\n\n`,
              thought: true
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      totalTokenCount: 1019,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1013
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [{ text: '我是一个大型语言模型，' }],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 1,
      totalTokenCount: 1020,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1019
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  '
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 48,
      totalTokenCount: 1067,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1019
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n'
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 95,
      totalTokenCount: 1109,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1013
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '4.  **信息总结：** 我可以阅读长篇文本并提炼出关键信息或进行总结。\n5.  **创意写作：** 我可以帮助你创作诗歌、代码、剧本、音乐作品'
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 143,
      totalTokenCount: 1162,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1109
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '、电子邮件、信件等各种创意内容。\n6.  **解释概念：** 我可以解释复杂的术语、概念或主题，使其更容易理解。\n7.  **对话交流：** 我可以和你进行自然'
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 191,
      totalTokenCount: 1210,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1109
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '流畅的对话，就像与人交流一样。\n8.  **学习和研究助手：** 我可以帮助你查找信息、学习新知识、整理思路等。\n\n总的来说，我的目标是为你提供信息、帮助你完成'
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 191,
      totalTokenCount: 1210,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1109
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [{ text: '任务，并以有益和富有成效的方式与你互动。\n\n你有什么具体想让我做的吗？' }],
          role: 'model'
        },
        index: 0,
        finishReason: FinishReason.STOP
      }
    ],
    usageMetadata: {
      promptTokenCount: 6,
      candidatesTokenCount: 266,
      totalTokenCount: 1285,
      promptTokensDetails: [{ modality: MediaModality.TEXT, tokenCount: 6 }],
      thoughtsTokenCount: 1109
    },
    modelVersion: 'gemini-2.5-flash-lite-preview-06-17',
    responseId: 'hNRzaKyMG4DVz7IP6NfaqAs'
  } as unknown as GeminiSdkRawChunk
]

const geminiToolUseChunks: GeminiSdkRawChunk[] = [
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '**Initiating File Retrieval**\n\nI\'ve determined that the `tool_mcp-tool-1` tool is suitable for this task. It seems the user intends to read a file, and this tool aligns with that objective. Currently, I\'m focusing on the necessary parameters. The `tool_mcp-tool-1` tool requires a `name` and `age`, which the user has helpfully provided: `{"name": "xxx", "age": 20}`. I\'m verifying the input.\n\n\n',
              thought: true
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {}
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [{ text: '好的，我将为您打印用户的' }],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {}
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [{ text: '信息。\n\u003ctool_use\u003e\n  \u003cname\u003emcp-tool-1\u003c/name\u003e\n' }],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {}
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              text: '  \u003carguments\u003e{"name":"xxx","age":20}\u003c/arguments\u003e\n\u003c/tool_use\u003e'
            }
          ],
          role: 'model'
        },
        index: 0
      }
    ],
    usageMetadata: {}
  } as GeminiSdkRawChunk,
  {
    candidates: [
      {
        content: {
          parts: [
            {
              functionCall: {
                name: 'mcp-tool-1',
                args: {
                  name: 'alice',
                  age: 13
                }
              } as GeminiSdkToolCall
            }
          ],
          role: 'model'
        },
        finishReason: FinishReason.STOP
      }
    ],
    usageMetadata: {}
  } as GeminiSdkRawChunk
]

const openaiCompletionChunks: OpenAISdkRawChunk[] = [
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: null,
          role: 'assistant',
          reasoning_content: ''
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      } as ChatCompletionChunk.Choice
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: null,
          role: 'assistant',
          reasoning_content: '好的，用户打招呼说“你好'
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: null,
          role: 'assistant',
          reasoning_content: '”，我需要友好回应。'
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: '你好！有什么问题',
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: '或者需要我帮忙的吗？',
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: null,
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: 'stop'
      }
    ]
  }
]

const openaiNeedExtractContentChunks: OpenAISdkRawChunk[] = [
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: null,
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: '<think>',
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: '\n好的，用户发来“你好”，我需要友好回应\n</',
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: 'think>',
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {
          content: '你好！有什么我可以帮您的吗？',
          role: 'assistant',
          reasoning_content: null
        } as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: null
      }
    ]
  },
  {
    id: 'cmpl-123',
    created: 1715811200,
    model: 'gpt-4o',
    object: 'chat.completion.chunk',
    choices: [
      {
        delta: {} as ChatCompletionChunk.Choice.Delta,
        index: 0,
        logprobs: null,
        finish_reason: 'stop'
      }
    ]
  }
]

const anthropicTextNonStreamChunks: AnthropicSdkRawChunk[] = [
  {
    id: 'msg_bdrk_01HctMh5mCpuFRq49KFwTDU6',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'text',
        text: '你好！有什么我可以帮助你的吗？'
      }
    ],
    model: 'claude-3-7-sonnet-20250219',
    stop_reason: 'end_turn',
    usage: {
      input_tokens: 15,
      output_tokens: 21
    }
  } as AnthropicSdkRawChunk
]

const anthropicTextStreamChunks: AnthropicSdkRawChunk[] = [
  {
    type: 'message_start',
    message: {
      id: 'msg_bdrk_013fneHZaGWgKFBzesGM4wu5',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-20241022',
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 10,
        output_tokens: 2
      } as Usage
    }
  },
  {
    type: 'content_block_start',
    index: 0,
    content_block: {
      type: 'text',
      text: ''
    } as TextBlock
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'text_delta',
      text: '你好!很高兴见到你。有'
    } as TextDelta
  },
  {
    type: 'content_block_delta',
    index: 0,
    delta: {
      type: 'text_delta',
      text: '什么我可以帮助你的吗？'
    } as TextDelta
  },
  {
    type: 'content_block_stop',
    index: 0
  },
  {
    type: 'message_delta',
    delta: {
      stop_reason: 'end_turn',
      stop_sequence: null
    },
    usage: {
      output_tokens: 28
    } as Usage
  },
  {
    type: 'message_stop'
  }
]

// 正确的 async generator 函数
async function* geminiChunkGenerator(): AsyncGenerator<GeminiSdkRawChunk> {
  for (const chunk of geminiChunks) {
    yield chunk
  }
}

async function* geminiThinkingChunkGenerator(): AsyncGenerator<GeminiSdkRawChunk> {
  for (const chunk of geminiThinkingChunks) {
    yield chunk
  }
}

async function* geminiToolUseChunkGenerator(): AsyncGenerator<GeminiSdkRawChunk> {
  for (const chunk of geminiToolUseChunks) {
    yield chunk
  }
}

async function* openaiThinkingChunkGenerator(): AsyncGenerator<OpenAISdkRawChunk> {
  for (const chunk of openaiCompletionChunks) {
    yield chunk
  }
}

async function* openaiNeedExtractContentChunkGenerator(): AsyncGenerator<OpenAISdkRawChunk> {
  for (const chunk of openaiNeedExtractContentChunks) {
    yield chunk
  }
}

const mockOpenaiApiClient = {
  createCompletions: vi.fn().mockImplementation(() => openaiThinkingChunkGenerator()),
  getResponseChunkTransformer: vi.fn().mockImplementation(() => {
    let hasBeenCollectedWebSearch = false
    const collectWebSearchData = (
      chunk: OpenAISdkRawChunk,
      contentSource: OpenAISdkRawContentSource,
      context: ResponseChunkTransformerContext
    ) => {
      if (hasBeenCollectedWebSearch) {
        return
      }
      // OpenAI annotations
      // @ts-ignore - annotations may not be in standard type definitions
      const annotations = contentSource.annotations || chunk.annotations
      if (annotations && annotations.length > 0 && annotations[0].type === 'url_citation') {
        hasBeenCollectedWebSearch = true
        return {
          results: annotations,
          source: WebSearchSource.OPENAI
        }
      }

      // Grok citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'grok' && chunk.citations) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.GROK
        }
      }

      // Perplexity citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'perplexity' && chunk.search_results && chunk.search_results.length > 0) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.search_results,
          source: WebSearchSource.PERPLEXITY
        }
      }

      // OpenRouter citations
      // @ts-ignore - citations may not be in standard type definitions
      if (context.provider?.id === 'openrouter' && chunk.citations && chunk.citations.length > 0) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - citations may not be in standard type definitions
          results: chunk.citations,
          source: WebSearchSource.OPENROUTER
        }
      }

      // Zhipu web search
      // @ts-ignore - web_search may not be in standard type definitions
      if (context.provider?.id === 'zhipu' && chunk.web_search) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - web_search may not be in standard type definitions
          results: chunk.web_search,
          source: WebSearchSource.ZHIPU
        }
      }

      // Hunyuan web search
      // @ts-ignore - search_info may not be in standard type definitions
      if (context.provider?.id === 'hunyuan' && chunk.search_info?.search_results) {
        hasBeenCollectedWebSearch = true
        return {
          // @ts-ignore - search_info may not be in standard type definitions
          results: chunk.search_info.search_results,
          source: WebSearchSource.HUNYUAN
        }
      }
      return null
    }

    const toolCalls: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[] = []
    let isFinished = false
    let lastUsageInfo: any = null

    /**
     * 统一的完成信号发送逻辑
     * - 有 finish_reason 时
     * - 无 finish_reason 但是流正常结束时
     */
    const emitCompletionSignals = (controller: TransformStreamDefaultController<GenericChunk>) => {
      if (isFinished) return

      if (toolCalls.length > 0) {
        controller.enqueue({
          type: ChunkType.MCP_TOOL_CREATED,
          tool_calls: toolCalls
        })
      }

      const usage = lastUsageInfo || {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0
      }

      controller.enqueue({
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: { usage }
      })

      // 防止重复发送
      isFinished = true
    }

    let isThinking = false
    let accumulatingText = false
    return (context: ResponseChunkTransformerContext) => ({
      async transform(chunk: OpenAISdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
        // 持续更新usage信息
        if (chunk.usage) {
          lastUsageInfo = {
            prompt_tokens: chunk.usage.prompt_tokens || 0,
            completion_tokens: chunk.usage.completion_tokens || 0,
            total_tokens: (chunk.usage.prompt_tokens || 0) + (chunk.usage.completion_tokens || 0)
          }
        }

        // 处理chunk
        if ('choices' in chunk && chunk.choices && chunk.choices.length > 0) {
          for (const choice of chunk.choices) {
            if (!choice) continue

            // 对于流式响应，使用 delta；对于非流式响应，使用 message。
            // 然而某些 OpenAI 兼容平台在非流式请求时会错误地返回一个空对象的 delta 字段。
            // 如果 delta 为空对象或content为空，应当忽略它并回退到 message，避免造成内容缺失。
            let contentSource: OpenAISdkRawContentSource | null = null
            if (
              'delta' in choice &&
              choice.delta &&
              Object.keys(choice.delta).length > 0 &&
              (!('content' in choice.delta) ||
                (choice.delta.tool_calls && choice.delta.tool_calls.length > 0) ||
                (typeof choice.delta.content === 'string' && choice.delta.content !== '') ||
                (typeof (choice.delta as any).reasoning_content === 'string' &&
                  (choice.delta as any).reasoning_content !== '') ||
                (typeof (choice.delta as any).reasoning === 'string' && (choice.delta as any).reasoning !== ''))
            ) {
              contentSource = choice.delta
            } else if ('message' in choice) {
              contentSource = choice.message
            }

            // 状态管理
            if (!contentSource?.content) {
              accumulatingText = false
            }
            // @ts-ignore - reasoning_content is not in standard OpenAI types but some providers use it
            if (!contentSource?.reasoning_content && !contentSource?.reasoning) {
              isThinking = false
            }

            if (!contentSource) {
              if ('finish_reason' in choice && choice.finish_reason) {
                emitCompletionSignals(controller)
              }
              continue
            }

            const webSearchData = collectWebSearchData(chunk, contentSource, context)
            if (webSearchData) {
              controller.enqueue({
                type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                llm_web_search: webSearchData
              })
            }

            // 处理推理内容 (e.g. from OpenRouter DeepSeek-R1)
            // @ts-ignore - reasoning_content is not in standard OpenAI types but some providers use it
            const reasoningText = contentSource.reasoning_content || contentSource.reasoning
            if (reasoningText) {
              if (!isThinking) {
                controller.enqueue({
                  type: ChunkType.THINKING_START
                } as ThinkingStartChunk)
                isThinking = true
              }
              controller.enqueue({
                type: ChunkType.THINKING_DELTA,
                text: reasoningText
              })
            } else {
              isThinking = false
            }

            // 处理文本内容
            if (contentSource.content) {
              if (!accumulatingText) {
                controller.enqueue({
                  type: ChunkType.TEXT_START
                } as TextStartChunk)
                accumulatingText = true
              }
              controller.enqueue({
                type: ChunkType.TEXT_DELTA,
                text: contentSource.content
              })
            } else {
              accumulatingText = false
            }

            // 处理工具调用
            if (contentSource.tool_calls) {
              for (const toolCall of contentSource.tool_calls) {
                if ('index' in toolCall) {
                  const { id, index, function: fun } = toolCall
                  if (fun?.name) {
                    toolCalls[index] = {
                      id: id || '',
                      function: {
                        name: fun.name,
                        arguments: fun.arguments || ''
                      },
                      type: 'function'
                    }
                  } else if (fun?.arguments) {
                    toolCalls[index].function.arguments += fun.arguments
                  }
                } else {
                  toolCalls.push(toolCall)
                }
              }
            }

            // 处理finish_reason，发送流结束信号
            if ('finish_reason' in choice && choice.finish_reason) {
              const webSearchData = collectWebSearchData(chunk, contentSource, context)
              if (webSearchData) {
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                  llm_web_search: webSearchData
                })
              }
              emitCompletionSignals(controller)
            }
          }
        }
      },

      // 流正常结束时，检查是否需要发送完成信号
      flush(controller) {
        if (isFinished) return
        emitCompletionSignals(controller)
      }
    })
  }),
  getSdkInstance: vi.fn(),
  getRequestTransformer: vi.fn().mockImplementation(() => ({
    async transform(params: any) {
      return {
        payload: {
          model: params.assistant?.model?.id || 'gpt-4o',
          messages: params.messages || [],
          tools: params.tools || []
        },
        metadata: {}
      }
    }
  })),
  convertMcpToolsToSdkTools: vi.fn(() => []),
  convertSdkToolCallToMcpToolResponse: vi.fn(),
  buildSdkMessages: vi.fn(() => []),
  extractMessagesFromSdkPayload: vi.fn(() => []),
  provider: {} as Provider,
  useSystemPromptForTools: true,
  getBaseURL: vi.fn(() => 'https://api.openai.com'),
  getApiKey: vi.fn(() => 'mock-api-key'),
  getClientCompatibilityType: vi.fn(() => ['OpenAIAPIClient'])
} as unknown as OpenAIAPIClient

// Mock OpenAIResponseAPIClient
const mockOpenAIResponseAPIClient = {
  createCompletions: vi.fn().mockImplementation(() => openaiThinkingChunkGenerator()),
  getResponseChunkTransformer: mockOpenaiApiClient.getResponseChunkTransformer,
  getSdkInstance: vi.fn(),
  getRequestTransformer: vi.fn().mockImplementation(() => ({
    async transform(params: any) {
      return {
        payload: {
          model: params.assistant?.model?.id || 'gpt-4o',
          messages: params.messages || [],
          tools: params.tools || []
        },
        metadata: {}
      }
    }
  })),
  convertMcpToolsToSdkTools: vi.fn(() => []),
  convertSdkToolCallToMcpToolResponse: vi.fn(),
  buildSdkMessages: vi.fn(() => []),
  extractMessagesFromSdkPayload: vi.fn(() => []),
  provider: {} as Provider,
  useSystemPromptForTools: true,
  getBaseURL: vi.fn(() => 'https://api.openai.com'),
  getApiKey: vi.fn(() => 'mock-api-key'),
  getClient: vi.fn(() => mockOpenaiApiClient), // 模拟返回内部客户端
  getClientCompatibilityType: vi.fn(() => ['OpenAIResponseAPIClient'])
} as unknown as OpenAIResponseAPIClient

const mockOpenaiNeedExtractContentApiClient = cloneDeep(mockOpenaiApiClient)
mockOpenaiNeedExtractContentApiClient.createCompletions = vi
  .fn()
  .mockImplementation(() => openaiNeedExtractContentChunkGenerator())

async function* anthropicTextNonStreamChunkGenerator(): AsyncGenerator<AnthropicSdkRawChunk> {
  for (const chunk of anthropicTextNonStreamChunks) {
    yield chunk
  }
}

async function* anthropicTextStreamChunkGenerator(): AsyncGenerator<AnthropicSdkRawChunk> {
  for (const chunk of anthropicTextStreamChunks) {
    yield chunk
  }
}

// 创建 mock 的 GeminiAPIClient
const mockGeminiApiClient = {
  createCompletions: vi.fn().mockImplementation(() => geminiChunkGenerator()),
  getResponseChunkTransformer: vi.fn().mockImplementation(() => {
    const toolCalls: FunctionCall[] = []
    let isFirstTextChunk = true
    let isFirstThinkingChunk = true
    return () => ({
      async transform(chunk: GeminiSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
        if (chunk.candidates && chunk.candidates.length > 0) {
          for (const candidate of chunk.candidates) {
            if (candidate.content) {
              candidate.content.parts?.forEach((part) => {
                const text = part.text || ''
                if (part.thought) {
                  if (isFirstThinkingChunk) {
                    controller.enqueue({
                      type: ChunkType.THINKING_START
                    } as ThinkingStartChunk)
                    isFirstThinkingChunk = false
                  }
                  controller.enqueue({
                    type: ChunkType.THINKING_DELTA,
                    text: text
                  })
                } else if (part.text) {
                  if (isFirstTextChunk) {
                    controller.enqueue({
                      type: ChunkType.TEXT_START
                    } as TextStartChunk)
                    isFirstTextChunk = false
                  }
                  controller.enqueue({
                    type: ChunkType.TEXT_DELTA,
                    text: text
                  })
                } else if (part.inlineData) {
                  controller.enqueue({
                    type: ChunkType.IMAGE_COMPLETE,
                    image: {
                      type: 'base64',
                      images: [
                        part.inlineData?.data?.startsWith('data:')
                          ? part.inlineData?.data
                          : `data:${part.inlineData?.mimeType || 'image/png'};base64,${part.inlineData?.data}`
                      ]
                    }
                  })
                } else if (part.functionCall) {
                  toolCalls.push(part.functionCall)
                }
              })
            }

            if (candidate.finishReason) {
              if (candidate.groundingMetadata) {
                controller.enqueue({
                  type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                  llm_web_search: {
                    results: candidate.groundingMetadata,
                    source: WebSearchSource.GEMINI
                  }
                } as LLMWebSearchCompleteChunk)
              }
              if (toolCalls.length > 0) {
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: [...toolCalls]
                })
                toolCalls.length = 0
              }
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: chunk.usageMetadata?.promptTokenCount || 0,
                    completion_tokens:
                      (chunk.usageMetadata?.totalTokenCount || 0) - (chunk.usageMetadata?.promptTokenCount || 0),
                    total_tokens: chunk.usageMetadata?.totalTokenCount || 0
                  }
                }
              })
            }
          }
        }

        if (toolCalls.length > 0) {
          controller.enqueue({
            type: ChunkType.MCP_TOOL_CREATED,
            tool_calls: toolCalls
          })
        }
      }
    })
  }),
  getSdkInstance: vi.fn(),
  getRequestTransformer: vi.fn().mockImplementation(() => ({
    async transform(params: any) {
      return {
        payload: {
          model: params.assistant?.model?.id || 'gemini-2.5-pro',
          messages: params.messages || [],
          tools: params.tools || []
        },
        metadata: {}
      }
    }
  })),
  convertMcpToolsToSdkTools: vi.fn(() => []),
  convertSdkToolCallToMcpToolResponse: vi.fn(),
  buildSdkMessages: vi.fn(() => []),
  extractMessagesFromSdkPayload: vi.fn(() => []),
  provider: {} as Provider,
  useSystemPromptForTools: true,
  getBaseURL: vi.fn(() => 'https://api.gemini.com'),
  getApiKey: vi.fn(() => 'mock-api-key'),
  getClientCompatibilityType: vi.fn(() => ['GeminiAPIClient'])
} as unknown as GeminiAPIClient

const mockAnthropicApiClient = {
  createCompletions: vi.fn().mockImplementation(() => anthropicTextNonStreamChunkGenerator()),
  attachRawStreamListener: vi.fn().mockImplementation((rawOutput: any) => {
    return rawOutput
  }),
  getResponseChunkTransformer: vi.fn().mockImplementation(() => {
    return () => {
      let accumulatedJson = ''
      const toolCalls: Record<number, ToolUseBlock> = {}
      return {
        async transform(rawChunk: AnthropicSdkRawChunk, controller: TransformStreamDefaultController<GenericChunk>) {
          switch (rawChunk.type) {
            case 'message': {
              let i = 0
              let hasTextContent = false
              let hasThinkingContent = false

              for (const content of rawChunk.content) {
                switch (content.type) {
                  case 'text': {
                    if (!hasTextContent) {
                      controller.enqueue({
                        type: ChunkType.TEXT_START
                      } as TextStartChunk)
                      hasTextContent = true
                    }
                    controller.enqueue({
                      type: ChunkType.TEXT_DELTA,
                      text: content.text
                    } as TextDeltaChunk)
                    break
                  }
                  case 'tool_use': {
                    toolCalls[i] = content
                    i++
                    break
                  }
                  case 'thinking': {
                    if (!hasThinkingContent) {
                      controller.enqueue({
                        type: ChunkType.THINKING_START
                      })
                      hasThinkingContent = true
                    }
                    controller.enqueue({
                      type: ChunkType.THINKING_DELTA,
                      text: content.thinking
                    })
                    break
                  }
                  case 'web_search_tool_result': {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                      llm_web_search: {
                        results: content.content,
                        source: WebSearchSource.ANTHROPIC
                      }
                    } as LLMWebSearchCompleteChunk)
                    break
                  }
                }
              }
              if (i > 0) {
                controller.enqueue({
                  type: ChunkType.MCP_TOOL_CREATED,
                  tool_calls: Object.values(toolCalls)
                })
              }
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: rawChunk.usage.input_tokens || 0,
                    completion_tokens: rawChunk.usage.output_tokens || 0,
                    total_tokens: (rawChunk.usage.input_tokens || 0) + (rawChunk.usage.output_tokens || 0)
                  }
                }
              })
              break
            }
            case 'content_block_start': {
              const contentBlock = rawChunk.content_block
              switch (contentBlock.type) {
                case 'server_tool_use': {
                  if (contentBlock.name === 'web_search') {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_IN_PROGRESS
                    })
                  }
                  break
                }
                case 'web_search_tool_result': {
                  if (
                    contentBlock.content &&
                    (contentBlock.content as WebSearchToolResultError).type === 'web_search_tool_result_error'
                  ) {
                    controller.enqueue({
                      type: ChunkType.ERROR,
                      error: {
                        code: (contentBlock.content as WebSearchToolResultError).error_code,
                        message: (contentBlock.content as WebSearchToolResultError).error_code
                      }
                    })
                  } else {
                    controller.enqueue({
                      type: ChunkType.LLM_WEB_SEARCH_COMPLETE,
                      llm_web_search: {
                        results: contentBlock.content as Array<WebSearchResultBlock>,
                        source: WebSearchSource.ANTHROPIC
                      }
                    })
                  }
                  break
                }
                case 'tool_use': {
                  toolCalls[rawChunk.index] = contentBlock
                  break
                }
                case 'text': {
                  controller.enqueue({
                    type: ChunkType.TEXT_START
                  } as TextStartChunk)
                  break
                }
                case 'thinking':
                case 'redacted_thinking': {
                  controller.enqueue({
                    type: ChunkType.THINKING_START
                  } as ThinkingStartChunk)
                  break
                }
              }
              break
            }
            case 'content_block_delta': {
              const messageDelta = rawChunk.delta
              switch (messageDelta.type) {
                case 'text_delta': {
                  if (messageDelta.text) {
                    controller.enqueue({
                      type: ChunkType.TEXT_DELTA,
                      text: messageDelta.text
                    } as TextDeltaChunk)
                  }
                  break
                }
                case 'thinking_delta': {
                  if (messageDelta.thinking) {
                    controller.enqueue({
                      type: ChunkType.THINKING_DELTA,
                      text: messageDelta.thinking
                    })
                  }
                  break
                }
                case 'input_json_delta': {
                  if (messageDelta.partial_json) {
                    accumulatedJson += messageDelta.partial_json
                  }
                  break
                }
              }
              break
            }
            case 'content_block_stop': {
              const toolCall = toolCalls[rawChunk.index]
              if (toolCall) {
                try {
                  toolCall.input = JSON.parse(accumulatedJson)
                  controller.enqueue({
                    type: ChunkType.MCP_TOOL_CREATED,
                    tool_calls: [toolCall]
                  })
                } catch (error) {
                  console.error(`Error parsing tool call input: ${error}`)
                }
              }
              break
            }
            case 'message_delta': {
              controller.enqueue({
                type: ChunkType.LLM_RESPONSE_COMPLETE,
                response: {
                  usage: {
                    prompt_tokens: rawChunk.usage.input_tokens || 0,
                    completion_tokens: rawChunk.usage.output_tokens || 0,
                    total_tokens: (rawChunk.usage.input_tokens || 0) + (rawChunk.usage.output_tokens || 0)
                  }
                }
              })
            }
          }
        }
      }
    }
  }),
  getRequestTransformer: vi.fn().mockImplementation(() => ({
    async transform(params: any) {
      return {
        payload: {
          model: params.assistant?.model?.id || 'claude-3-7-sonnet-20250219',
          messages: params.messages || [],
          tools: params.tools || []
        },
        metadata: {}
      }
    }
  })),
  convertMcpToolsToSdkTools: vi.fn(() => []),
  convertSdkToolCallToMcpToolResponse: vi.fn(),
  buildSdkMessages: vi.fn(() => []),
  extractMessagesFromSdkPayload: vi.fn(() => []),
  provider: {} as Provider,
  useSystemPromptForTools: true,
  getBaseURL: vi.fn(() => 'https://api.anthropic.com'),
  getApiKey: vi.fn(() => 'mock-api-key'),
  getClientCompatibilityType: vi.fn(() => ['AnthropicAPIClient'])
} as unknown as AnthropicAPIClient

const mockAnthropicApiClientStream = cloneDeep(mockAnthropicApiClient)
mockAnthropicApiClientStream.createCompletions = vi.fn().mockImplementation(() => anthropicTextStreamChunkGenerator())

const mockGeminiThinkingApiClient = cloneDeep(mockGeminiApiClient)
mockGeminiThinkingApiClient.createCompletions = vi.fn().mockImplementation(() => geminiThinkingChunkGenerator())

const mockGeminiToolUseApiClient = cloneDeep(mockGeminiApiClient)
mockGeminiToolUseApiClient.createCompletions = vi.fn().mockImplementation(() => geminiToolUseChunkGenerator())
mockGeminiToolUseApiClient.convertMcpToolResponseToSdkMessageParam = vi
  .fn()
  .mockImplementation(
    (mcpToolResponse: MCPToolResponse, resp: MCPCallToolResponse, model: Model): GeminiSdkMessageParam | undefined => {
      // mcp使用tooluse
      return mcpToolCallResponseToGeminiMessage(mcpToolResponse, resp, isVisionModel(model))
    }
  )

const mockProvider = {
  id: 'gemini',
  type: 'gemini',
  name: 'Gemini',
  apiKey: 'mock-api-key',
  apiHost: 'mock-api-host'
} as Provider

const collectedChunks: GenericChunk[] = []
const mockOnChunk = vi.fn((chunk: GenericChunk) => {
  collectedChunks.push(chunk)
})

describe('ApiService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collectedChunks.length = 0
  })

  it('should return a stream of chunks with correct types and content in gemini', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    mockCreate.mockReturnValue(mockGeminiApiClient as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider)

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      mcpTools: [],
      maxTokens: 1000,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    // 验证stream中的chunks
    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()
    const chunks: GenericChunk[] = []

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
      }
    } finally {
      reader.releaseLock()
    }

    const expectedChunks: GenericChunk[] = [
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: 'Hi, 1212312312'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: 'Hi, 1212312312' + '！\n\n我是 Gemini 2.5 Pro，很高兴能为您服务。\n\n今天有什么可以帮您的吗？无论您是'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          'Hi, 1212312312' +
          '！\n\n我是 Gemini 2.5 Pro，很高兴能为您服务。\n\n今天有什么可以帮您的吗？无论您是' +
          '想寻找信息、进行创作，还是有任何其他问题，我都在这里准备好提供帮助。'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text:
          'Hi, 1212312312' +
          '！\n\n我是 Gemini 2.5 Pro，很高兴能为您服务。\n\n今天有什么可以帮您的吗？无论您是' +
          '想寻找信息、进行创作，还是有任何其他问题，我都在这里准备好提供帮助。'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            total_tokens: 1205,
            prompt_tokens: 383,
            completion_tokens: 822
          }
        }
      }
    ]

    expect(chunks).toEqual(expectedChunks)

    // 验证chunk的数量和类型
    expect(chunks.length).toBeGreaterThan(0)

    // 验证第一个chunk应该是TEXT_START
    const firstChunk = chunks[0]
    expect(firstChunk.type).toBe(ChunkType.TEXT_START)

    // 验证TEXT_DELTA chunks的内容
    const textDeltaChunks = chunks.filter((chunk) => chunk.type === ChunkType.TEXT_DELTA) as TextDeltaChunk[]
    expect(textDeltaChunks.length).toBeGreaterThan(0)

    // 验证文本内容
    const expectedTexts = [
      'Hi, 1212312312',
      'Hi, 1212312312' + '！\n\n我是 Gemini 2.5 Pro，很高兴能为您服务。\n\n今天有什么可以帮您的吗？无论您是',
      'Hi, 1212312312' +
        '！\n\n我是 Gemini 2.5 Pro，很高兴能为您服务。\n\n今天有什么可以帮您的吗？无论您是' +
        '想寻找信息、进行创作，还是有任何其他问题，我都在这里准备好提供帮助。'
    ]

    textDeltaChunks.forEach((chunk, index) => {
      expect(chunk.text).toBe(expectedTexts[index])
    })

    // 验证最后一个chunk应该是LLM_RESPONSE_COMPLETE
    const lastChunk = chunks[chunks.length - 1]
    expect(lastChunk.type).toBe(ChunkType.LLM_RESPONSE_COMPLETE)

    // 验证LLM_RESPONSE_COMPLETE chunk包含usage信息
    const completionChunk = lastChunk as LLMResponseCompleteChunk
    expect(completionChunk.response?.usage).toBeDefined()
    expect(completionChunk.response?.usage?.total_tokens).toBe(1205)
    expect(completionChunk.response?.usage?.prompt_tokens).toBe(383)
    expect(completionChunk.response?.usage?.completion_tokens).toBe(822)
  })

  it('should return a non-stream of chunks with correct types and content in anthropic', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    mockCreate.mockReturnValue(mockAnthropicApiClient as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider)

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',

        type: 'anthropic',
        model: {
          id: 'claude-3-7-sonnet-20250219',
          name: 'Claude 3.7 Sonnet',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      mcpTools: [],
      maxTokens: 1000,
      streamOutput: false
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    const chunks: GenericChunk[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    reader.releaseLock()

    const expectedChunks: GenericChunk[] = [
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '你好！有什么我可以帮助你的吗？'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '你好！有什么我可以帮助你的吗？'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            completion_tokens: 21,
            prompt_tokens: 15,
            total_tokens: 36
          }
        }
      }
    ]

    expect(chunks).toEqual(expectedChunks)

    // 验证chunk的数量和类型
    expect(chunks.length).toBeGreaterThan(0)

    // 验证第一个chunk应该是TEXT_START
    const firstChunk = chunks[0]
    expect(firstChunk.type).toBe(ChunkType.TEXT_START)
  })

  it('should return a stream of chunks with correct types and content in anthropic', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    mockCreate.mockReturnValue(mockAnthropicApiClientStream as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider)

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',

        type: 'anthropic',
        model: {
          id: 'claude-3-7-sonnet-20250219',
          name: 'Claude 3.7 Sonnet',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      mcpTools: [],
      maxTokens: 1000,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    const chunks: GenericChunk[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    reader.releaseLock()

    const expectedChunks: GenericChunk[] = [
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '你好!很高兴见到你。有'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '你好!很高兴见到你。有什么我可以帮助你的吗？'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '你好!很高兴见到你。有什么我可以帮助你的吗？'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            completion_tokens: 28,
            prompt_tokens: 0,
            total_tokens: 28
          }
        }
      }
    ]

    expect(chunks).toEqual(expectedChunks)
  })

  it('should return a stream of thinking chunks with correct types and content', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    mockCreate.mockReturnValue(mockGeminiThinkingApiClient as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider)

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      enableReasoning: true,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    const chunks: GenericChunk[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    reader.releaseLock()

    // 过滤掉 thinking_millsec 字段，因为它不是确定值
    const filteredChunks = chunks.map((chunk) => {
      if (chunk.type === ChunkType.THINKING_DELTA || chunk.type === ChunkType.THINKING_COMPLETE) {
        delete (chunk as any).thinking_millsec
        return chunk
      }
      return chunk
    })

    const expectedChunks: GenericChunk[] = [
      {
        type: ChunkType.THINKING_START
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: `**Analyzing Core Functionality**\n\nI've identified the core query: "What can I do?" expressed in Chinese. Recognizing my nature as a Google-trained language model is the foundation for a relevant response. This fundamental understanding guides the development of an effective answer.\n\n\n`
      },
      {
        type: ChunkType.THINKING_DELTA,
        text:
          `**Analyzing Core Functionality**\n\nI've identified the core query: "What can I do?" expressed in Chinese. Recognizing my nature as a Google-trained language model is the foundation for a relevant response. This fundamental understanding guides the development of an effective answer.\n\n\n` +
          `**Formulating the Chinese Response**\n\nI'm now drafting a Chinese response. I've moved past the initial simple sentence and am incorporating more detail. The goal is a clear, concise list of my key capabilities, tailored for a user asking about my function. I'm focusing on "understanding and generating text," "answering questions," and "translating languages" for now. Refining the exact phrasing for optimal clarity is an ongoing focus.\n\n\n`
      },
      {
        type: ChunkType.THINKING_DELTA,
        text:
          `**Analyzing Core Functionality**\n\nI've identified the core query: "What can I do?" expressed in Chinese. Recognizing my nature as a Google-trained language model is the foundation for a relevant response. This fundamental understanding guides the development of an effective answer.\n\n\n` +
          `**Formulating the Chinese Response**\n\nI'm now drafting a Chinese response. I've moved past the initial simple sentence and am incorporating more detail. The goal is a clear, concise list of my key capabilities, tailored for a user asking about my function. I'm focusing on "understanding and generating text," "answering questions," and "translating languages" for now. Refining the exact phrasing for optimal clarity is an ongoing focus.\n\n\n` +
          `**Categorizing My Abilities**\n\nI'm organizing my thoughts to classify the capabilities in my response. I'm grouping functions like text generation and question answering, then differentiating them from specialized features, such as translation and creative writing. Considering the best structure for clarity and comprehensiveness, I am refining the outline for my reply. I'm aiming for concise categories that clearly illustrate the range of my functionality in the response. I'm adding an optional explanation of my training to enrich the overall response.\n\n\n`
      },
      {
        type: ChunkType.THINKING_DELTA,
        text:
          `**Analyzing Core Functionality**\n\nI've identified the core query: "What can I do?" expressed in Chinese. Recognizing my nature as a Google-trained language model is the foundation for a relevant response. This fundamental understanding guides the development of an effective answer.\n\n\n` +
          `**Formulating the Chinese Response**\n\nI'm now drafting a Chinese response. I've moved past the initial simple sentence and am incorporating more detail. The goal is a clear, concise list of my key capabilities, tailored for a user asking about my function. I'm focusing on "understanding and generating text," "answering questions," and "translating languages" for now. Refining the exact phrasing for optimal clarity is an ongoing focus.\n\n\n` +
          `**Categorizing My Abilities**\n\nI'm organizing my thoughts to classify the capabilities in my response. I'm grouping functions like text generation and question answering, then differentiating them from specialized features, such as translation and creative writing. Considering the best structure for clarity and comprehensiveness, I am refining the outline for my reply. I'm aiming for concise categories that clearly illustrate the range of my functionality in the response. I'm adding an optional explanation of my training to enrich the overall response.\n\n\n` +
          `**Developing the Chinese Draft**\n\nI'm now iterating on the final Chinese response. I've refined the categories to highlight my versatility. I'm focusing on "understanding and generating text" and "answering questions", and adding a section on how I can perform creative writing tasks. I'm aiming for concise explanations for clarity. I will also include a call to action at the end. I'm considering adding an optional sentence describing how I learned the data I know.\n\n\n`
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text:
          `**Analyzing Core Functionality**\n\nI've identified the core query: "What can I do?" expressed in Chinese. Recognizing my nature as a Google-trained language model is the foundation for a relevant response. This fundamental understanding guides the development of an effective answer.\n\n\n` +
          `**Formulating the Chinese Response**\n\nI'm now drafting a Chinese response. I've moved past the initial simple sentence and am incorporating more detail. The goal is a clear, concise list of my key capabilities, tailored for a user asking about my function. I'm focusing on "understanding and generating text," "answering questions," and "translating languages" for now. Refining the exact phrasing for optimal clarity is an ongoing focus.\n\n\n` +
          `**Categorizing My Abilities**\n\nI'm organizing my thoughts to classify the capabilities in my response. I'm grouping functions like text generation and question answering, then differentiating them from specialized features, such as translation and creative writing. Considering the best structure for clarity and comprehensiveness, I am refining the outline for my reply. I'm aiming for concise categories that clearly illustrate the range of my functionality in the response. I'm adding an optional explanation of my training to enrich the overall response.\n\n\n` +
          `**Developing the Chinese Draft**\n\nI'm now iterating on the final Chinese response. I've refined the categories to highlight my versatility. I'm focusing on "understanding and generating text" and "answering questions", and adding a section on how I can perform creative writing tasks. I'm aiming for concise explanations for clarity. I will also include a call to action at the end. I'm considering adding an optional sentence describing how I learned the data I know.\n\n\n`
      },
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '我是一个大型语言模型，'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  '
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  ' +
          '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  ' +
          '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n' +
          '4.  **信息总结：** 我可以阅读长篇文本并提炼出关键信息或进行总结。\n5.  **创意写作：** 我可以帮助你创作诗歌、代码、剧本、音乐作品'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  ' +
          '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n' +
          '4.  **信息总结：** 我可以阅读长篇文本并提炼出关键信息或进行总结。\n5.  **创意写作：** 我可以帮助你创作诗歌、代码、剧本、音乐作品' +
          '、电子邮件、信件等各种创意内容。\n6.  **解释概念：** 我可以解释复杂的术语、概念或主题，使其更容易理解。\n7.  **对话交流：** 我可以和你进行自然'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  ' +
          '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n' +
          '4.  **信息总结：** 我可以阅读长篇文本并提炼出关键信息或进行总结。\n5.  **创意写作：** 我可以帮助你创作诗歌、代码、剧本、音乐作品' +
          '、电子邮件、信件等各种创意内容。\n6.  **解释概念：** 我可以解释复杂的术语、概念或主题，使其更容易理解。\n7.  **对话交流：** 我可以和你进行自然' +
          '流畅的对话，就像与人交流一样。\n8.  **学习和研究助手：** 我可以帮助你查找信息、学习新知识、整理思路等。\n\n总的来说，我的目标是为你提供信息、帮助你完成'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  ' +
          '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n' +
          '4.  **信息总结：** 我可以阅读长篇文本并提炼出关键信息或进行总结。\n5.  **创意写作：** 我可以帮助你创作诗歌、代码、剧本、音乐作品' +
          '、电子邮件、信件等各种创意内容。\n6.  **解释概念：** 我可以解释复杂的术语、概念或主题，使其更容易理解。\n7.  **对话交流：** 我可以和你进行自然' +
          '流畅的对话，就像与人交流一样。\n8.  **学习和研究助手：** 我可以帮助你查找信息、学习新知识、整理思路等。\n\n总的来说，我的目标是为你提供信息、帮助你完成' +
          '任务，并以有益和富有成效的方式与你互动。\n\n你有什么具体想让我做的吗？'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text:
          '我是一个大型语言模型，' +
          '由 Google 训练。\n\n我的能力主要包括：\n\n1.  **理解和生成文本：** 我可以阅读、理解并创作各种形式的文本，包括文章、故事、对话、代码等。\n2.  ' +
          '**回答问题：** 基于我所学习到的信息，我可以回答你提出的各种问题，无论是事实性的、概念性的还是需要解释的。\n3.  **语言翻译：** 我可以翻译多种语言之间的文本。\n' +
          '4.  **信息总结：** 我可以阅读长篇文本并提炼出关键信息或进行总结。\n5.  **创意写作：** 我可以帮助你创作诗歌、代码、剧本、音乐作品' +
          '、电子邮件、信件等各种创意内容。\n6.  **解释概念：** 我可以解释复杂的术语、概念或主题，使其更容易理解。\n7.  **对话交流：** 我可以和你进行自然' +
          '流畅的对话，就像与人交流一样。\n8.  **学习和研究助手：** 我可以帮助你查找信息、学习新知识、整理思路等。\n\n总的来说，我的目标是为你提供信息、帮助你完成' +
          '任务，并以有益和富有成效的方式与你互动。\n\n你有什么具体想让我做的吗？'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            prompt_tokens: 6,
            completion_tokens: 1279,
            total_tokens: 1285
          }
        }
      }
    ]

    expect(filteredChunks).toEqual(expectedChunks)
  })

  it('should handle openai thinking chunk correctly', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    mockCreate.mockReturnValue(mockOpenaiApiClient as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider as Provider)
    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      enableReasoning: true,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    const chunks: GenericChunk[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    reader.releaseLock()

    const filteredChunks = chunks.map((chunk) => {
      if (chunk.type === ChunkType.THINKING_DELTA || chunk.type === ChunkType.THINKING_COMPLETE) {
        delete (chunk as any).thinking_millsec
        return chunk
      }
      if (chunk.type === ChunkType.LLM_RESPONSE_COMPLETE) {
        delete (chunk as any).response.usage
        return chunk
      }
      return chunk
    })
    const expectedChunks = [
      {
        type: ChunkType.THINKING_START
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '好的，用户打招呼说“你好'
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '好的，用户打招呼说“你好”，我需要友好回应。'
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text: '好的，用户打招呼说“你好”，我需要友好回应。'
      },
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '你好！有什么问题'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '你好！有什么问题或者需要我帮忙的吗？'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '你好！有什么问题或者需要我帮忙的吗？'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {}
      }
    ]

    expect(filteredChunks).toEqual(expectedChunks)
  })

  it('should handle openai need extract content chunk correctly', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    // @ts-ignore mockOpenaiNeedExtractContentApiClient is a OpenAIAPIClient
    mockCreate.mockReturnValue(mockOpenaiNeedExtractContentApiClient as unknown as OpenAIAPIClient)
    const AI = new AiProvider(mockProvider as Provider)
    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      enableReasoning: true,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    const chunks: GenericChunk[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    reader.releaseLock()

    const filteredChunks = chunks.map((chunk) => {
      if (chunk.type === ChunkType.THINKING_DELTA || chunk.type === ChunkType.THINKING_COMPLETE) {
        delete (chunk as any).thinking_millsec
        return chunk
      }
      return chunk
    })

    const expectedChunks = [
      {
        type: ChunkType.THINKING_START
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '好的，用户发来“你好”，我需要友好回应'
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text: '好的，用户发来“你好”，我需要友好回应'
      },
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '\n你好！有什么我可以帮您的吗？'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '\n你好！有什么我可以帮您的吗？'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0
          }
        }
      }
    ]

    expect(filteredChunks).toEqual(expectedChunks)
  })

  it('should handle OpenAIResponseAPIClient compatibility type without circular call', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)

    // 创建一个模拟的 OpenAIResponseAPIClient，getClient 返回自身
    const mockSelfReturningClient = {
      ...mockOpenAIResponseAPIClient,
      getClient: vi.fn(() => mockSelfReturningClient), // 返回自身，模拟循环调用场景
      getClientCompatibilityType: vi.fn((model) => {
        // 模拟真实的逻辑：检查是否返回自身
        const actualClient = mockSelfReturningClient.getClient()
        if (actualClient === mockSelfReturningClient) {
          return ['OpenAIResponseAPIClient']
        }
        return actualClient.getClientCompatibilityType(model)
      })
    }

    mockCreate.mockReturnValue(mockSelfReturningClient as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider)

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o'
        }
      } as Assistant,
      onChunk: mockOnChunk,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(mockSelfReturningClient.getClientCompatibilityType).toHaveBeenCalled()

    // 验证没有抛出堆栈溢出错误，表明没有无限循环
    expect(() => mockSelfReturningClient.getClientCompatibilityType({ id: 'gpt-4o' })).not.toThrow()
  })

  it('should extract tool use responses correctly', async () => {
    const mockCreate = vi.mocked(ApiClientFactory.create)
    mockCreate.mockReturnValue(mockGeminiToolUseApiClient as unknown as BaseApiClient)
    const AI = new AiProvider(mockProvider)

    const mcpChunks: GenericChunk[] = []
    const firstResponseChunks: GenericChunk[] = []

    const spy = vi.spyOn(McpToolsModule, 'callMCPTool')
    spy.mockResolvedValue({
      content: [{ type: 'text', text: 'test' }],
      isError: false
    })

    const onChunk = vi.fn((chunk: Chunk) => {
      mcpChunks.push(chunk)
    })

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gemini-2.5-pro',
          name: 'Gemini 2.5 Pro'
        },
        settings: {
          toolUseMode: 'prompt'
        }
      } as Assistant,
      mcpTools: [
        {
          id: 'mcp-tool-1',
          name: 'mcp-tool-1',
          serverId: 'mcp-server-1',
          serverName: 'mcp-server-1',
          description: 'mcp-tool-1',
          inputSchema: {
            type: 'object',
            title: 'mcp-tool-1',
            properties: {
              name: { type: 'string' },
              age: { type: 'number' }
            },
            description: 'print the name and age',
            required: ['name', 'age']
          }
        }
      ],
      onChunk,
      enableReasoning: true,
      streamOutput: true
    })

    expect(result).toBeDefined()
    expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
    expect(result.stream).toBeDefined()

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    while (true) {
      const { done, value: chunk } = await reader.read()
      if (done) break
      firstResponseChunks.push(chunk)
    }

    reader.releaseLock()

    const filteredFirstResponseChunks = firstResponseChunks.map((chunk) => {
      if (chunk.type === ChunkType.THINKING_DELTA || chunk.type === ChunkType.THINKING_COMPLETE) {
        delete (chunk as any).thinking_millsec
        return chunk
      }
      return chunk
    })

    const expectedFirstResponseChunks: GenericChunk[] = [
      {
        type: ChunkType.THINKING_START
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '**Initiating File Retrieval**\n\nI\'ve determined that the `tool_mcp-tool-1` tool is suitable for this task. It seems the user intends to read a file, and this tool aligns with that objective. Currently, I\'m focusing on the necessary parameters. The `tool_mcp-tool-1` tool requires a `name` and `age`, which the user has helpfully provided: `{"name": "xxx", "age": 20}`. I\'m verifying the input.\n\n\n'
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text: '**Initiating File Retrieval**\n\nI\'ve determined that the `tool_mcp-tool-1` tool is suitable for this task. It seems the user intends to read a file, and this tool aligns with that objective. Currently, I\'m focusing on the necessary parameters. The `tool_mcp-tool-1` tool requires a `name` and `age`, which the user has helpfully provided: `{"name": "xxx", "age": 20}`. I\'m verifying the input.\n\n\n'
      },
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '好的，我将为您打印用户的'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '好的，我将为您打印用户的信息。\n'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '好的，我将为您打印用户的信息。\n'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0
          }
        }
      }
    ]

    const expectedMcpResponseChunks: GenericChunk[] = [
      {
        type: ChunkType.MCP_TOOL_PENDING,
        responses: [
          {
            id: 'mcp-tool-1-0',
            tool: {
              description: 'mcp-tool-1',
              id: 'mcp-tool-1',
              serverId: 'mcp-server-1',
              serverName: 'mcp-server-1',
              name: 'mcp-tool-1',
              inputSchema: {
                type: 'object',
                title: 'mcp-tool-1',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' }
                },
                description: 'print the name and age',
                required: ['name', 'age']
              }
            },
            toolUseId: 'mcp-tool-1',
            arguments: {
              name: 'xxx',
              age: 20
            },
            status: 'pending'
          }
        ]
      },
      {
        type: ChunkType.MCP_TOOL_IN_PROGRESS,
        responses: [
          {
            id: 'mcp-tool-1-0',
            response: undefined,
            tool: {
              description: 'mcp-tool-1',
              id: 'mcp-tool-1',
              serverId: 'mcp-server-1',
              serverName: 'mcp-server-1',
              name: 'mcp-tool-1',
              inputSchema: {
                type: 'object',
                title: 'mcp-tool-1',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' }
                },
                description: 'print the name and age',
                required: ['name', 'age']
              }
            },
            toolUseId: 'mcp-tool-1',
            arguments: {
              name: 'xxx',
              age: 20
            },
            status: 'invoking'
          }
        ]
      },
      {
        type: ChunkType.MCP_TOOL_COMPLETE,
        responses: [
          {
            id: 'mcp-tool-1-0',
            tool: {
              description: 'mcp-tool-1',
              id: 'mcp-tool-1',
              serverId: 'mcp-server-1',
              serverName: 'mcp-server-1',
              name: 'mcp-tool-1',
              inputSchema: {
                type: 'object',
                title: 'mcp-tool-1',
                properties: {
                  name: { type: 'string' },
                  age: { type: 'number' }
                },
                description: 'print the name and age',
                required: ['name', 'age']
              }
            },
            response: {
              content: [
                {
                  text: 'test',
                  type: 'text'
                }
              ],
              isError: false
            },
            toolUseId: 'mcp-tool-1',
            arguments: {
              name: 'xxx',
              age: 20
            },
            status: 'done'
          }
        ]
      },
      {
        type: ChunkType.LLM_RESPONSE_CREATED
      }
    ]

    expect(filteredFirstResponseChunks).toEqual(expectedFirstResponseChunks)
    expect(mcpChunks).toEqual(expectedMcpResponseChunks)
  })

  it('should handle multiple reasoning blocks and text blocks', async () => {
    const rawChunks = [
      {
        choices: [
          {
            delta: { content: '', reasoning_content: '\n', role: 'assistant' },
            index: 0,
            finish_reason: null
          }
        ],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [{ delta: { reasoning_content: '开始', role: 'assistant' }, index: 0, finish_reason: null }],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [{ delta: { reasoning_content: '思考', role: 'assistant' }, index: 0, finish_reason: null }],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [
          { delta: { content: '思考', reasoning_content: null, role: 'assistant' }, index: 0, finish_reason: null }
        ],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [
          { delta: { content: '完成', reasoning_content: null, role: 'assistant' }, index: 0, finish_reason: null }
        ],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [{ delta: { reasoning_content: '再次', role: 'assistant' }, index: 0, finish_reason: null }],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [{ delta: { reasoning_content: '思考', role: 'assistant' }, index: 0, finish_reason: null }],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [
          { delta: { content: '思考', reasoning_content: null, role: 'assistant' }, index: 0, finish_reason: null }
        ],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [
          { delta: { content: '完成', reasoning_content: null, role: 'assistant' }, index: 0, finish_reason: null }
        ],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      },
      {
        choices: [
          { delta: { content: '', reasoning_content: null, role: 'assistant' }, index: 0, finish_reason: 'stop' }
        ],
        created: 1754192522,
        id: 'chat-network/glm-4.5-GLM-4.5-Flash-2025-08-03-11-42-02',
        model: 'glm-4.5-flash',
        object: 'chat.completion',
        system_fingerprint: '3000y'
      }
    ]

    async function* mockChunksGenerator(): AsyncGenerator<OpenAISdkRawChunk> {
      for (const chunk of rawChunks) {
        // since no reasoning_content field
        yield chunk as OpenAISdkRawChunk
      }
    }

    const mockOpenaiApiClient_ = cloneDeep(mockOpenaiApiClient)

    mockOpenaiApiClient_.createCompletions = vi.fn().mockImplementation(() => mockChunksGenerator())

    const mockCreate = vi.mocked(ApiClientFactory.create)
    // @ts-ignore mockOpenaiApiClient_ is a OpenAIAPIClient
    mockCreate.mockReturnValue(mockOpenaiApiClient_ as unknown as OpenAIAPIClient)
    const AI = new AiProvider(mockProvider as Provider)

    const result = await AI.completions({
      callType: 'test',
      messages: [],
      assistant: {
        id: '1',
        name: 'test',
        prompt: 'test',
        model: {
          id: 'gpt-4o',
          name: 'GPT-4o',
          supported_text_delta: true
        }
      } as Assistant,
      onChunk: mockOnChunk,
      enableReasoning: true,
      streamOutput: true
    })

    const stream = result.stream! as ReadableStream<GenericChunk>
    const reader = stream.getReader()

    const chunks: GenericChunk[] = []

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    reader.releaseLock()

    const filteredChunks = chunks.map((chunk) => {
      if (chunk.type === ChunkType.THINKING_DELTA || chunk.type === ChunkType.THINKING_COMPLETE) {
        delete (chunk as any).thinking_millsec
        return chunk
      }
      return chunk
    })

    const expectedChunks = [
      {
        type: ChunkType.THINKING_START
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '\n'
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '\n开始'
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '\n开始思考'
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text: '\n开始思考'
      },
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '思考'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '思考完成'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '思考完成'
      },
      {
        type: ChunkType.THINKING_START
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '再次'
      },
      {
        type: ChunkType.THINKING_DELTA,
        text: '再次思考'
      },
      {
        type: ChunkType.THINKING_COMPLETE,
        text: '再次思考'
      },
      {
        type: ChunkType.TEXT_START
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '思考'
      },
      {
        type: ChunkType.TEXT_DELTA,
        text: '思考完成'
      },
      {
        type: ChunkType.TEXT_COMPLETE,
        text: '思考完成'
      },
      {
        type: ChunkType.LLM_RESPONSE_COMPLETE,
        response: {
          usage: {
            completion_tokens: 0,
            prompt_tokens: 0,
            total_tokens: 0
          }
        }
      }
    ]

    expect(filteredChunks).toEqual(expectedChunks)
  })
})
