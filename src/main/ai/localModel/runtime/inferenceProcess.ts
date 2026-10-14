import { application } from '@application'
import { defineUtilityProcess } from '@main/core/utilityProcess/defineUtilityProcess'
import type {
  UtilityProcessContract,
  UtilityProcessDefinition,
  UtilityProcessMethod
} from '@main/core/utilityProcess/types'
import type { LocalModelCapability } from '@shared/data/presets/localModel'

import type { AsrSegment, AsrTranscribePayload } from '../capabilities/asr/protocol'
import type { EmbeddingCountTokensPayload, EmbeddingEmbedPayload } from '../capabilities/embedding/protocol'
import type { OcrLine, OcrRecognizePayload } from '../capabilities/ocr/protocol'
import { bundleForCapability } from '../catalog/catalog'
import { localModelStorageService } from '../installation/LocalModelStorageService'
import { resolveLocalInferenceProfile } from './inferenceAcceleration'
import type { InferenceInitData, LocalInferenceRuntimeProfile } from './protocol'

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

type RuntimeProfileResolver = () => LocalInferenceRuntimeProfile

export type InferenceProcessDefinition<Contract extends UtilityProcessContract> = UtilityProcessDefinition<
  Contract,
  InferenceInitData
> &
  Readonly<{ resolveRuntimeProfile: RuntimeProfileResolver }>

function resolveConfiguredRuntimeProfile(): LocalInferenceRuntimeProfile {
  return resolveLocalInferenceProfile(
    application.get('PreferenceService').get('feature.local_model.hardware_acceleration.enabled')
  )
}

function createInferenceInitData(
  capability: LocalModelCapability,
  resolveRuntimeProfile: RuntimeProfileResolver
): InferenceInitData {
  const bundle = bundleForCapability(capability)
  return {
    appPath: application.getPath('app.root'),
    artifactPaths: Object.fromEntries(bundle.requires.map((id) => [id, localModelStorageService.artifactPath(id)])),
    runtimeProfile: resolveRuntimeProfile()
  }
}

export function defineInferenceProcess<Contract extends UtilityProcessContract>({
  capability,
  id,
  entry,
  resolveRuntimeProfile = resolveConfiguredRuntimeProfile
}: {
  capability: LocalModelCapability
  id: string
  entry: string
  resolveRuntimeProfile?: RuntimeProfileResolver
}): InferenceProcessDefinition<Contract> {
  const definition = defineUtilityProcess<Contract, InferenceInitData>({
    id,
    entry,
    cancellation: 'terminate',
    idleTimeoutMs: INFERENCE_IDLE_TIMEOUT_MS,
    createInitData: () => createInferenceInitData(capability, resolveRuntimeProfile)
  })
  return Object.freeze({ ...definition, resolveRuntimeProfile })
}

export const embeddingInferenceProcess = defineInferenceProcess<EmbeddingInferenceContract>({
  capability: 'embedding',
  id: 'inference.embedding',
  entry: 'inference-embedding'
})

export const ocrInferenceProcess = defineInferenceProcess<OcrInferenceContract>({
  capability: 'ocr',
  id: 'inference.ocr',
  entry: 'inference-ocr'
})
