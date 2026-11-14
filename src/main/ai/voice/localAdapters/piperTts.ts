import type { SpeechOptions } from '@cherrystudio/ai-core'
import {
  PIPER_CADU_TTS_BUNDLE_ID,
  PIPER_CADU_TTS_MODEL_ID,
  PIPER_FABER_TTS_BUNDLE_ID,
  PIPER_FABER_TTS_MODEL_ID
} from '@shared/ai/localVoice'

import { createSherpaSpeechDefinition, createVariantSpeechModel, type SherpaSpeechVariant } from './kokoroTts'

const LANGUAGES = ['pt-BR'] as const

/** Piper voices are single-speaker models, so each one is its own downloadable model. */
function piperVariant(
  voice: string,
  modelId: SherpaSpeechVariant['modelId'],
  bundleId: SherpaSpeechVariant['bundleId']
): SherpaSpeechVariant {
  return {
    modelId,
    bundleId,
    languages: LANGUAGES,
    voices: [{ id: voice, name: voice, locale: 'pt-BR', languages: LANGUAGES }],
    speakerIds: new Map([[voice, 0]])
  }
}

function piperDefinition(variant: SherpaSpeechVariant) {
  return createSherpaSpeechDefinition(variant, (options: SpeechOptions) => createVariantSpeechModel(variant, options))
}

export const piperFaberSpeechDefinition = piperDefinition(
  piperVariant('faber', PIPER_FABER_TTS_MODEL_ID, PIPER_FABER_TTS_BUNDLE_ID)
)
export const piperCaduSpeechDefinition = piperDefinition(
  piperVariant('cadu', PIPER_CADU_TTS_MODEL_ID, PIPER_CADU_TTS_BUNDLE_ID)
)
