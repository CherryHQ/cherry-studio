import type OpenAI from '@cherrystudio/openai'
import type { NotNull, NotUndefined } from '@types'
import type { ImageModel, LanguageModel } from 'ai'
import type { generateObject, generateText, ModelMessage, streamObject, streamText } from 'ai'

export type StreamTextParams = Omit<Parameters<typeof streamText>[0], 'model' | 'messages'> &
  (
    | {
        prompt: string | Array<ModelMessage>
        messages?: never
      }
    | {
        messages: Array<ModelMessage>
        prompt?: never
      }
  )
export type GenerateTextParams = Omit<Parameters<typeof generateText>[0], 'model' | 'messages'> &
  (
    | {
        prompt: string | Array<ModelMessage>
        messages?: never
      }
    | {
        messages: Array<ModelMessage>
        prompt?: never
      }
  )
export type StreamObjectParams = Omit<Parameters<typeof streamObject>[0], 'model'>
export type GenerateObjectParams = Omit<Parameters<typeof generateObject>[0], 'model'>

export type AiSdkModel = LanguageModel | ImageModel

// The original type unite both undefined and null.
// I pick undefined as the unique falsy type since they seem like share the same meaning according to OpenAI API docs.
// Parameter would not be passed into request if it's null.
export type OpenAIVerbosity = NotNull<OpenAI.Responses.ResponseTextConfig['verbosity']>
export type ValidOpenAIVerbosity = NotUndefined<OpenAIVerbosity>

export type OpenAIReasoningEffort = OpenAI.ReasoningEffort

// The original type unite both undefined and null.
// I pick undefined as the unique falsy type since they seem like share the same meaning according to OpenAI API docs.
// Parameter would not be passed into request if it's null.
export type OpenAISummaryText = NotNull<OpenAI.Reasoning['summary']>
