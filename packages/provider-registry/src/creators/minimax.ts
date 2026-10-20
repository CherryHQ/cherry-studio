import type { ReasoningEffort } from '../schemas/enums'
import { defineCreator } from './types'

// https://platform.minimax.io/docs/api-reference/text-openai-api
// Both M3 models ignore sampling and penalty overrides.
const m3Parameters = {
  temperature: { supported: false },
  topP: { supported: false },
  topK: { supported: false },
  frequencyPenalty: false,
  presencePenalty: false,
  maxTokens: true,
  stopSequences: true,
  systemMessage: true
}

const m31Efforts: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']

export default defineCreator({
  id: 'minimax',
  name: 'MiniMax',
  modelsDevProviders: ['minimax', 'minimax-cn'],
  idPrefixes: ['minimax', 'abab'],
  reasoningFamilies: [
    { pattern: '^minimax-m3[.-]1-flash$', effort: m31Efforts, toggle: false },
    { pattern: 'minimax-m\\d' }
  ],
  models: [
    {
      id: 'minimax-m3-1-flash',
      name: 'MiniMax-M3.1-Flash',
      openWeights: true,
      // https://platform.minimax.io/docs/pricing/overview#models/text
      // Free gateway offers override these direct-API prices on their own rows.
      pricing: {
        input: { currency: 'USD', perMillionTokens: 0.15 },
        output: { currency: 'USD', perMillionTokens: 0.6 },
        cacheRead: { currency: 'USD', perMillionTokens: 0.015 }
      },
      capabilities: ['reasoning', 'function-call', 'image-recognition', 'video-recognition'],
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['text'],
      contextWindow: 1_000_000,
      parameterSupport: m3Parameters,
      reasoning: { controls: [{ kind: 'effort', values: m31Efforts, default: 'max' }] }
    },
    { id: 'minimax-m2-1' },
    {
      id: 'minimax-m3',
      name: 'MiniMax-M3',
      maxOutputTokens: 524288,
      parameterSupport: m3Parameters
    },
    {
      id: 'image-01',
      name: 'image-01',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
                render: 'chips',
                type: 'enum'
              },
              customSize: { maxSide: 2048, minSide: 512, pairedEnumKey: 'size', type: 'size' },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' },
              size: { options: ['custom'], type: 'enum' }
            }
          },
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
                render: 'chips',
                type: 'enum'
              },
              customSize: { maxSide: 2048, minSide: 512, pairedEnumKey: 'size', type: 'size' },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' },
              size: { options: ['custom'], type: 'enum' }
            }
          }
        }
      }
    },
    {
      id: 'image-01-live',
      name: 'image-01-live',
      capabilities: ['image-generation'],
      inputModalities: ['text', 'image'],
      outputModalities: ['image'],
      imageGeneration: {
        modes: {
          edit: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' }
            }
          },
          generate: {
            supports: {
              addWatermark: { default: false, type: 'switch' },
              aspectRatio: {
                options: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
                render: 'chips',
                type: 'enum'
              },
              numImages: { default: 1, max: 9, min: 1, type: 'range' },
              outputFormat: { default: 'url', options: ['url', 'base64'], type: 'enum' },
              promptEnhancement: { default: false, type: 'switch' },
              seed: { type: 'text' }
            }
          }
        }
      }
    }
  ]
})
