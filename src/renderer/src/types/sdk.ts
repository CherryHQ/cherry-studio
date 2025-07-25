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

type OpenAIParamsWithoutReasoningEffort = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'reasoning_effort'>

export type ReasoningEffortOptionalParams = {
  thinking?: { type: 'disabled' | 'enabled' | 'auto'; budget_tokens?: number }
  reasoning?: { max_tokens?: number; exclude?: boolean; effort?: string; enabled?: boolean } | OpenAI.Reasoning
  reasoning_effort?: OpenAI.Chat.Completions.ChatCompletionCreateParams['reasoning_effort'] | 'none' | 'auto'
  enable_thinking?: boolean
  thinking_budget?: number
  incremental_output?: boolean
  enable_reasoning?: boolean
  extra_body?: Record<string, any>
  // Add any other potential reasoning-related keys here if they exist
}

export type OpenAISdkParams = OpenAIParamsWithoutReasoningEffort & ReasoningEffortOptionalParams
export type OpenAISdkRawChunk =
  | OpenAI.Chat.Completions.ChatCompletionChunk
  | ({
      _request_id?: string | null | undefined
    } & OpenAI.ChatCompletion)

export type OpenAISdkRawOutput = Stream<OpenAI.Chat.Completions.ChatCompletionChunk> | OpenAI.ChatCompletion
export type OpenAISdkRawContentSource =
  | OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta
  | OpenAI.Chat.Completions.ChatCompletionMessage

export type OpenAISdkMessageParam = OpenAI.Chat.Completions.ChatCompletionMessageParam

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
