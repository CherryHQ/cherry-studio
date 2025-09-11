import Anthropic from '@anthropic-ai/sdk'
import {
  Message,
  MessageCreateParams,
  MessageParam,
  RawMessageStreamEvent,
  ToolUnion,
  ToolUseBlock
} from '@anthropic-ai/sdk/resources'
import { MessageStream } from '@anthropic-ai/sdk/resources/messages/messages'
import AnthropicVertex from '@anthropic-ai/vertex-sdk'
import type { BedrockClient } from '@aws-sdk/client-bedrock'
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime'
import {
  Content,
  CreateChatParameters,
  FunctionCall,
  GenerateContentResponse,
  GoogleGenAI,
  Model as GeminiModel,
  SendMessageParameters,
  Tool
} from '@google/genai'
import OpenAI, { AzureOpenAI } from 'openai'
import { ChatCompletionContentPartImage } from 'openai/resources'
import { Stream } from 'openai/streaming'

import { EndpointType } from './index'

export type SdkInstance = OpenAI | AzureOpenAI | Anthropic | AnthropicVertex | GoogleGenAI | AwsBedrockSdkInstance
export type SdkParams =
  | OpenAISdkParams
  | OpenAIResponseSdkParams
  | AnthropicSdkParams
  | GeminiSdkParams
  | AwsBedrockSdkParams
export type SdkRawChunk =
  | OpenAISdkRawChunk
  | OpenAIResponseSdkRawChunk
  | AnthropicSdkRawChunk
  | GeminiSdkRawChunk
  | AwsBedrockSdkRawChunk
export type SdkRawOutput =
  | OpenAISdkRawOutput
  | OpenAIResponseSdkRawOutput
  | AnthropicSdkRawOutput
  | GeminiSdkRawOutput
  | AwsBedrockSdkRawOutput
export type SdkMessageParam =
  | OpenAISdkMessageParam
  | OpenAIResponseSdkMessageParam
  | AnthropicSdkMessageParam
  | GeminiSdkMessageParam
  | AwsBedrockSdkMessageParam
export type SdkToolCall =
  | OpenAI.Chat.Completions.ChatCompletionMessageToolCall
  | ToolUseBlock
  | FunctionCall
  | OpenAIResponseSdkToolCall
  | AwsBedrockSdkToolCall
export type SdkTool =
  | OpenAI.Chat.Completions.ChatCompletionTool
  | ToolUnion
  | Tool
  | OpenAIResponseSdkTool
  | AwsBedrockSdkTool
export type SdkModel = OpenAI.Models.Model | Anthropic.ModelInfo | GeminiModel | NewApiModel

export type RequestOptions = Anthropic.RequestOptions | OpenAI.RequestOptions | GeminiOptions

/**
 * OpenAI
 */

type OpenAIParamsPurified = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'reasoning_effort' | 'modalities'>

export type ReasoningEffortOptionalParams = {
  thinking?: { type: 'disabled' | 'enabled' | 'auto'; budget_tokens?: number }
  reasoning?: { max_tokens?: number; exclude?: boolean; effort?: string; enabled?: boolean } | OpenAI.Reasoning
  reasoningEffort?: OpenAI.Chat.Completions.ChatCompletionCreateParams['reasoning_effort'] | 'none' | 'auto'
  reasoning_effort?: OpenAI.Chat.Completions.ChatCompletionCreateParams['reasoning_effort'] | 'none' | 'auto'
  enable_thinking?: boolean
  thinking_budget?: number
  incremental_output?: boolean
  enable_reasoning?: boolean
  // nvidia
  chat_template_kwargs?: {
    thinking: boolean
  }
  extra_body?: {
    google?: {
      thinking_config: {
        thinking_budget: number
        include_thoughts?: boolean
      }
    }
  }
  // Add any other potential reasoning-related keys here if they exist
}

export type OpenAISdkParams = OpenAIParamsPurified & ReasoningEffortOptionalParams & OpenAIModalities & OpenAIExtraBody

// OpenRouter may include additional fields like cost
export type OpenAISdkRawChunk =
  | (OpenAI.Chat.Completions.ChatCompletionChunk & { usage?: OpenAI.CompletionUsage & { cost?: number } })
  | ({
      _request_id?: string | null | undefined
    } & OpenAI.ChatCompletion & { usage?: OpenAI.CompletionUsage & { cost?: number } })

export type OpenAISdkRawOutput = Stream<OpenAI.Chat.Completions.ChatCompletionChunk> | OpenAI.ChatCompletion
export type OpenAISdkRawContentSource =
  | (OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta & {
      images?: ChatCompletionContentPartImage[]
    })
  | (OpenAI.Chat.Completions.ChatCompletionMessage & {
      images?: ChatCompletionContentPartImage[]
    })

export type OpenAISdkMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam
export type OpenAIExtraBody = {
  // for qwen mt
  translation_options?: {
    source_lang: 'auto'
    target_lang: string
  }
}
// image is for openrouter. audio is ignored for now
export type OpenAIModality = OpenAI.ChatCompletionModality | 'image'
export type OpenAIModalities = {
  modalities?: OpenAIModality[]
}
/**
 * OpenAI Response
 */

export type OpenAIResponseSdkParams = OpenAI.Responses.ResponseCreateParams
export type OpenAIResponseSdkRawOutput = Stream<OpenAI.Responses.ResponseStreamEvent> | OpenAI.Responses.Response
export type OpenAIResponseSdkRawChunk = OpenAI.Responses.ResponseStreamEvent | OpenAI.Responses.Response
export type OpenAIResponseSdkMessageParam = OpenAI.Responses.ResponseInputItem
export type OpenAIResponseSdkToolCall = OpenAI.Responses.ResponseFunctionToolCall
export type OpenAIResponseSdkTool = OpenAI.Responses.Tool

/**
 * Anthropic
 */

export type AnthropicSdkParams = MessageCreateParams
export type AnthropicSdkRawOutput = MessageStream | Message
export type AnthropicSdkRawChunk = RawMessageStreamEvent | Message
export type AnthropicSdkMessageParam = MessageParam

/**
 * Gemini
 */

export type GeminiSdkParams = SendMessageParameters & CreateChatParameters
export type GeminiSdkRawOutput = AsyncGenerator<GenerateContentResponse> | GenerateContentResponse
export type GeminiSdkRawChunk = GenerateContentResponse
export type GeminiSdkMessageParam = Content
export type GeminiSdkToolCall = FunctionCall

export type GeminiOptions = {
  streamOutput: boolean
  signal?: AbortSignal
  timeout?: number
}

/**
 * New API
 */
export interface NewApiModel extends OpenAI.Models.Model {
  supported_endpoint_types?: EndpointType[]
}

/**
 * AWS Bedrock
 */
export interface AwsBedrockSdkInstance {
  client: BedrockRuntimeClient
  bedrockClient: BedrockClient
  region: string
}

export interface AwsBedrockSdkParams {
  modelId: string
  messages: AwsBedrockSdkMessageParam[]
  system?: string
  maxTokens?: number
  temperature?: number
  topP?: number
  stream?: boolean
  tools?: AwsBedrockSdkTool[]
  [key: string]: any // Allow any additional custom parameters
}

export interface AwsBedrockSdkMessageParam {
  role: 'user' | 'assistant'
  content: Array<{
    text?: string
    image?: {
      format: 'png' | 'jpeg' | 'gif' | 'webp'
      source: {
        bytes?: Uint8Array
        s3Location?: {
          uri: string
          bucketOwner?: string
        }
      }
    }
    toolResult?: {
      toolUseId: string
      content: Array<{
        json?: any
        text?: string
        image?: {
          format: 'png' | 'jpeg' | 'gif' | 'webp'
          source: {
            bytes?: Uint8Array
            s3Location?: {
              uri: string
              bucketOwner?: string
            }
          }
        }
        document?: any
        video?: any
      }>
      status?: 'success' | 'error'
    }
    toolUse?: {
      toolUseId: string
      name: string
      input: any
    }
  }>
}

export interface AwsBedrockStreamChunk {
  type: string
  delta?: {
    text?: string
    toolUse?: { input?: string }
    type?: string
    thinking?: string
  }
  index?: number
  content_block?: any
  usage?: {
    inputTokens?: number
    outputTokens?: number
  }
}

export interface AwsBedrockSdkRawChunk {
  contentBlockStart?: {
    start?: {
      toolUse?: {
        toolUseId: string
        name: string
      }
    }
    contentBlockIndex?: number
  }
  contentBlockDelta?: {
    delta?: {
      text?: string
      toolUse?: {
        input?: string
      }
      type?: string // 支持 'thinking_delta' 等类型
      thinking?: string // 支持 thinking 内容
    }
    contentBlockIndex?: number
  }
  contentBlockStop?: {
    contentBlockIndex?: number
  }
  messageStart?: any
  messageStop?: any
  metadata?: any
}

export type AwsBedrockSdkRawOutput = { output: any } | AsyncIterable<AwsBedrockSdkRawChunk>

export interface AwsBedrockSdkTool {
  toolSpec: {
    name: string
    description?: string
    inputSchema: {
      json: {
        type: string
        properties?: {
          [key: string]: {
            type: string
            description?: string
          }
        }
        required?: string[]
      }
    }
  }
}

export interface AwsBedrockSdkToolCall {
  id: string
  name: string
  input: any
  toolUseId: string
}
