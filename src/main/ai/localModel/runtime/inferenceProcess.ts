import { application } from '@application'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type { UtilityProcessMethod } from '@main/core/utilityProcess/types'
import type { LocalModelCapability } from '@shared/data/presets/localModel'

import type { AsrSegment, AsrTranscribePayload } from '../capabilities/asr/protocol'
import type { EmbeddingCountTokensPayload, EmbeddingEmbedPayload } from '../capabilities/embedding/protocol'
import type { OcrLine, OcrRecognizePayload } from '../capabilities/ocr/protocol'
import { bundleForCapability } from '../catalog/catalog'
import { localModelStorageService } from '../installation/LocalModelStorageService'
import { CPU_LOCAL_INFERENCE_PROFILE, resolveLocalInferenceProfile } from './inferenceAcceleration'
import type { InferenceInitData } from './protocol'

export type EmbeddingInferenceContract = {
  methods: {
    embed: UtilityProcessMethod<EmbeddingEmbedPayload, number[][]>
    countTokens: UtilityProcessMethod<EmbeddingCountTokensPayload, number[]>
  }
}

export type OcrInferenceContract = {
  methods: {
    recognize: UtilityProcessMethod<OcrRecognizePayload, { text: string; lines: OcrLine[][] }>
  }
}

export type AsrInferenceContract = {
  methods: {
    transcribe: UtilityProcessMethod<AsrTranscribePayload, { text: string; segments: AsrSegment[] }>
  }
}

const INFERENCE_IDLE_TIMEOUT_MS = 60 * 1000

function createInferenceInitData(capability: LocalModelCapability): InferenceInitData {
  const bundle = bundleForCapability(capability)
  return {
    appPath: application.getPath('app.root'),
    artifactPaths: Object.fromEntries(bundle.requires.map((id) => [id, localModelStorageService.artifactPath(id)])),
    runtimeProfile:
      capability === 'asr'
        ? CPU_LOCAL_INFERENCE_PROFILE
        : resolveLocalInferenceProfile(
            application.get('PreferenceService').get('feature.local_model.hardware_acceleration.enabled')
          )
  }
}

export const embeddingInferenceProcess = defineUtilityProcess<EmbeddingInferenceContract, InferenceInitData>({
  id: 'inference.embedding',
  entry: 'inference-embedding',
  cancellation: 'cooperative',
  idleTimeoutMs: INFERENCE_IDLE_TIMEOUT_MS,
  createInitData: () => createInferenceInitData('embedding')
})

export const ocrInferenceProcess = defineUtilityProcess<OcrInferenceContract, InferenceInitData>({
  id: 'inference.ocr',
  entry: 'inference-ocr',
  cancellation: 'cooperative',
  idleTimeoutMs: INFERENCE_IDLE_TIMEOUT_MS,
  createInitData: () => createInferenceInitData('ocr')
})

export const asrInferenceProcess = defineUtilityProcess<AsrInferenceContract, InferenceInitData>({
  id: 'inference.asr',
  entry: 'inference-asr',
  cancellation: 'cooperative',
  idleTimeoutMs: INFERENCE_IDLE_TIMEOUT_MS,
  createInitData: () => createInferenceInitData('asr')
})
