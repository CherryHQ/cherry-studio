import type OpenAI from '@cherrystudio/openai'
import type { NotUndefined } from '@types'
import type { ImageModel, LanguageModel } from 'ai'
import type { generateObject, generateText, ModelMessage, streamObject, streamText } from 'ai'
import * as z from 'zod'

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
// Parameter would not be passed into request if it's undefined.
export type OpenAIVerbosity = OpenAI.Responses.ResponseTextConfig['verbosity']
export type ValidOpenAIVerbosity = NotUndefined<OpenAIVerbosity>

export type OpenAIReasoningEffort = OpenAI.ReasoningEffort

// The original type unite both undefined and null.
// Parameter would not be passed into request if it's undefined.
export type OpenAISummaryText = OpenAI.Reasoning['summary']

const AiSdkParamsSchema = z.enum([
  'maxOutputTokens',
  'temperature',
  'topP',
  'topK',
  'presencePenalty',
  'frequencyPenalty',
  'stopSequences',
  'seed'
])

export type AiSdkParam = z.infer<typeof AiSdkParamsSchema>

export const isAiSdkParam = (param: string): param is AiSdkParam => {
  return AiSdkParamsSchema.safeParse(param).success
}
