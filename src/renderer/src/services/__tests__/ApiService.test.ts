import { FinishReason, MediaModality } from '@google/genai'
import { FunctionCall } from '@google/genai'
import AiProvider from '@renderer/aiCore'
import { ApiClientFactory } from '@renderer/aiCore/clients/ApiClientFactory'
import { BaseApiClient } from '@renderer/aiCore/clients/BaseApiClient'
import { GeminiAPIClient } from '@renderer/aiCore/clients/gemini/GeminiAPIClient'
import { GenericChunk } from '@renderer/aiCore/middleware/schemas'
import { Assistant, Provider, WebSearchSource } from '@renderer/types'
import {
  ChunkType,
  LLMResponseCompleteChunk,
  LLMWebSearchCompleteChunk,
  TextDeltaChunk,
  TextStartChunk,
  ThinkingStartChunk
} from '@renderer/types/chunk'
import { GeminiSdkRawChunk } from '@renderer/types/sdk'
import { cloneDeep } from 'lodash'
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
  }
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
            provider: 'gemini'
          }
        ],
        isSystem: true,
        enabled: true
      }
    ],
    defaultModel: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'gemini'
    },
    topicNamingModel: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'gemini'
    },
    translateModel: {
      id: 'gemini-2.5-pro',
      name: 'Gemini 2.5 Pro',
      provider: 'gemini'
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
        finishReason: FinishReason.STOP,
        index: 0
      }
    ],
    usageMetadata: {}
  } as GeminiSdkRawChunk
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
  getApiKey: vi.fn(() => 'mock-api-key')
} as unknown as GeminiAPIClient

const mockGeminiThinkingApiClient = cloneDeep(mockGeminiApiClient)
mockGeminiThinkingApiClient.createCompletions = vi.fn().mockImplementation(() => geminiThinkingChunkGenerator())

const mockGeminiToolUseApiClient = cloneDeep(mockGeminiApiClient)
mockGeminiToolUseApiClient.createCompletions = vi.fn().mockImplementation(() => geminiToolUseChunkGenerator())

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

  it('should return a stream of chunks with correct types and content', async () => {
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
          name: 'Gemini 2.5 Pro'
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
          name: 'Gemini 2.5 Pro'
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

  // it('should extract tool use responses correctly', async () => {
  //   const mockCreate = vi.mocked(ApiClientFactory.create)
  //   mockCreate.mockReturnValue(mockGeminiToolUseApiClient as unknown as BaseApiClient)
  //   const AI = new AiProvider(mockProvider)
  //   const spy = vi.spyOn(McpToolsModule, 'callMCPTool')
  //   spy.mockResolvedValue({
  //     content: [{ type: 'text', text: 'test' }],
  //     isError: false
  //   })

  //   const result = await AI.completions({
  //     callType: 'test',
  //     messages: [],
  //     assistant: {
  //       id: '1',
  //       name: 'test',
  //       prompt: 'test',
  //       model: {
  //         id: 'gemini-2.5-pro',
  //         name: 'Gemini 2.5 Pro'
  //       },
  //       settings: {
  //         toolUseMode: 'prompt'
  //       }
  //     } as Assistant,
  //     mcpTools: [
  //       {
  //         id: 'mcp-tool-1',
  //         name: 'mcp-tool-1',
  //         serverId: 'mcp-server-1',
  //         serverName: 'mcp-server-1',
  //         description: 'mcp-tool-1',
  //         inputSchema: {
  //           type: 'object',
  //           title: 'mcp-tool-1',
  //           properties: {
  //             name: { type: 'string' },
  //             age: { type: 'number' }
  //           },
  //           description: 'print the name and age',
  //           required: ['name', 'age']
  //         }
  //       }
  //     ],
  //     onChunk: mockOnChunk,
  //     enableReasoning: true,
  //     streamOutput: true
  //   })

  //   expect(result).toBeDefined()
  //   expect(ApiClientFactory.create).toHaveBeenCalledWith(mockProvider)
  //   expect(result.stream).toBeDefined()

  //   const stream = result.stream! as ReadableStream<GenericChunk>
  //   const reader = stream.getReader()

  //   const chunks: GenericChunk[] = []

  //   while (true) {
  //     const { done, value } = await reader.read()
  //     if (done) break
  //     chunks.push(value)
  //   }

  //   reader.releaseLock()

  //   const filteredChunks = chunks.map((chunk) => {
  //     if (chunk.type === ChunkType.THINKING_DELTA || chunk.type === ChunkType.THINKING_COMPLETE) {
  //       delete (chunk as any).thinking_millsec
  //       return chunk
  //     }
  //     return chunk
  //   })

  //   const expectedChunks: GenericChunk[] = [
  //     {
  //       type: ChunkType.THINKING_START
  //     },
  //     {
  //       type: ChunkType.THINKING_DELTA,
  //       text: '**Initiating File Retrieval**\n\nI\'ve determined that the `tool_mcp-tool-1` tool is suitable for this task. It seems the user intends to read a file, and this tool aligns with that objective. Currently, I\'m focusing on the necessary parameters. The `tool_mcp-tool-1` tool requires a `name` and `age`, which the user has helpfully provided: `{"name": "xxx", "age": 20}`. I\'m verifying the input.\n\n\n'
  //     },
  //     {
  //       type: ChunkType.THINKING_COMPLETE,
  //       text: '**Initiating File Retrieval**\n\nI\'ve determined that the `tool_mcp-tool-1` tool is suitable for this task. It seems the user intends to read a file, and this tool aligns with that objective. Currently, I\'m focusing on the necessary parameters. The `tool_mcp-tool-1` tool requires a `name` and `age`, which the user has helpfully provided: `{"name": "xxx", "age": 20}`. I\'m verifying the input.\n\n\n'
  //     },
  //     {
  //       type: ChunkType.TEXT_START
  //     },
  //     {
  //       type: ChunkType.TEXT_DELTA,
  //       text: '好的，我将为您打印用户的'
  //     },
  //     {
  //       type: ChunkType.TEXT_DELTA,
  //       text: '好的，我将为您打印用户的信息。\n'
  //     },
  //     {
  //       type: ChunkType.TEXT_COMPLETE,
  //       text: '好的，我将为您打印用户的信息。\n'
  //     },
  //     {
  //       type: ChunkType.MCP_TOOL_CREATED
  //     },
  //     {
  //       type: ChunkType.MCP_TOOL_PENDING,
  //       responses: [
  //         {
  //           id: 'mcp-tool-1',
  //           tool: {
  //             id: 'mcp-tool-1',
  //             serverId: 'mcp-server-1',
  //             serverName: 'mcp-server-1',
  //             name: 'mcp-tool-1',
  //             inputSchema: {
  //               type: 'object',
  //               title: 'mcp-tool-1',
  //               properties: {
  //                 name: { type: 'string' },
  //                 age: { type: 'number' }
  //               },
  //               description: 'print the name and age',
  //               required: ['name', 'age']
  //             }
  //           },
  //           arguments: {
  //             name: 'xxx',
  //             age: 20
  //           },
  //           status: 'pending'
  //         }
  //       ]
  //     },
  //     {
  //       type: ChunkType.MCP_TOOL_IN_PROGRESS,
  //       responses: [
  //         {
  //           id: 'mcp-tool-1',
  //           tool: {
  //             id: 'mcp-tool-1',
  //             serverId: 'mcp-server-1',
  //             serverName: 'mcp-server-1',
  //             name: 'mcp-tool-1',
  //             inputSchema: {
  //               type: 'object',
  //               title: 'mcp-tool-1',
  //               properties: {
  //                 name: { type: 'string' },
  //                 age: { type: 'number' }
  //               },
  //               description: 'print the name and age',
  //               required: ['name', 'age']
  //             }
  //           },
  //           arguments: {
  //             name: 'xxx',
  //             age: 20
  //           },
  //           status: 'invoking'
  //         }
  //       ]
  //     },
  //     {
  //       type: ChunkType.MCP_TOOL_COMPLETE,
  //       responses: [
  //         {
  //           id: 'mcp-tool-1',
  //           tool: {
  //             id: 'mcp-tool-1',
  //             serverId: 'mcp-server-1',
  //             serverName: 'mcp-server-1',
  //             name: 'mcp-tool-1',
  //             inputSchema: {
  //               type: 'object',
  //               title: 'mcp-tool-1',
  //               properties: {
  //                 name: { type: 'string' },
  //                 age: { type: 'number' }
  //               },
  //               description: 'print the name and age',
  //               required: ['name', 'age']
  //             }
  //           },
  //           arguments: {
  //             name: 'xxx',
  //             age: 20
  //           },
  //           status: 'done'
  //         }
  //       ]
  //     }
  //   ]

  //   expect(filteredChunks).toEqual(expectedChunks)
  // })
})
