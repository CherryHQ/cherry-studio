import { generateObject, generateText, streamObject, streamText } from 'ai'

export type StreamTextParams = Omit<Parameters<typeof streamText>[0], 'model'>
export type GenerateTextParams = Omit<Parameters<typeof generateText>[0], 'model'>
export type StreamObjectParams = Omit<Parameters<typeof streamObject>[0], 'model'>
export type GenerateObjectParams = Omit<Parameters<typeof generateObject>[0], 'model'>
