import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import OpenAI, { AzureOpenAI } from 'openai'
import { Stream } from 'openai/streaming'

export type SdkInstance = OpenAI | AzureOpenAI | Anthropic | GoogleGenAI
export type SdkParams = OpenAISdkParams
export type SdkRawChunk = OpenAISdkRawChunk
export type SdkRawOutput = OpenAISdkRawOutput
export type SdkMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
export type SdkToolCall = OpenAI.Chat.Completions.ChatCompletionMessageToolCall

/**
 * OpenAI
 */

type OpenAIParamsWithoutReasoningEffort = Omit<OpenAI.Chat.Completions.ChatCompletionCreateParams, 'reasoning_effort'>

export type ReasoningEffortOptionalParams = {
  thinking?: { type: 'disabled' | 'enabled'; budget_tokens?: number }
  reasoning?: { max_tokens?: number; exclude?: boolean; effort?: string }
  reasoning_effort?: OpenAI.Chat.Completions.ChatCompletionCreateParams['reasoning_effort'] | 'none' | 'auto'
  enable_thinking?: boolean
  thinking_budget?: number
  enable_reasoning?: boolean
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
