import type { ImageModel, LanguageModel } from 'ai'
import { generateObject, generateText, ModelMessage, streamObject, streamText } from 'ai'

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
