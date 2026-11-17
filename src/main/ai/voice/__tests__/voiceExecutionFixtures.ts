import type { SpeechOptions, SpeechResult, TranscriptionOptions, TranscriptionResult } from '@cherrystudio/ai-core'

import { completeSpeechOperation, completeTranscriptionOperation } from '../localAdapters/sdkOperations'

export function speechFixture(
  modelId: string,
  generate: (modelId: string, text: string, options: SpeechOptions, signal?: AbortSignal) => Promise<SpeechResult>
) {
  return completeSpeechOperation((options) => ({
    specificationVersion: 'v3',
    provider: 'test-local',
    modelId,
    doGenerate: async ({ text, abortSignal }) => ({
      ...(await generate(modelId, text, options, abortSignal)),
      warnings: [],
      response: { timestamp: new Date(0), modelId }
    })
  }))
}

export function transcriptionFixture(
  modelId: string,
  transcribe: (
    modelId: string,
    audio: Uint8Array,
    options: TranscriptionOptions,
    signal?: AbortSignal
  ) => Promise<TranscriptionResult>
) {
  return completeTranscriptionOperation((options) => ({
    specificationVersion: 'v3',
    provider: 'test-local',
    modelId,
    doGenerate: async ({ audio, abortSignal }) => {
      if (!(audio instanceof Uint8Array)) throw new TypeError('Expected audio bytes')
      return {
        language: undefined,
        durationInSeconds: undefined,
        ...(await transcribe(modelId, audio, options, abortSignal)),
        warnings: [],
        response: { timestamp: new Date(0), modelId }
      }
    }
  }))
}
