import { embeddingInferenceProcess, ocrInferenceProcess } from '@main/ai/localModel'
import type { UtilityProcessManifest } from '@main/core/utilityProcess/types'

/**
 * Every utility process the app can run, installed once at boot (before `registerAll`).
 * Consumers add their `defineUtilityProcess()` result here.
 */
export const utilityProcessManifest: UtilityProcessManifest = Object.freeze([
  embeddingInferenceProcess,
  ocrInferenceProcess
])
