import { describe, expect, it } from 'vitest'

import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  LOCAL_VOICE_MODELS,
  resolveDefaultAsrModel
} from '../localVoice'

describe('local voice model facts and default resolution', () => {
  it('recommends Apple ASR on supported macOS releases', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 13 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 15 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 27 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 12 })).toBeUndefined()
  })

  it('preserves explicit selection regardless of platform availability', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 }, FUNASR_MODEL_ID)).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 25 }, APPLE_ASR_MODEL_ID)).toBe(
      APPLE_ASR_MODEL_ID
    )
    expect(resolveDefaultAsrModel({ platform: 'linux' }, APPLE_ASR_MODEL_ID)).toBe(APPLE_ASR_MODEL_ID)
  })

  it('does not guess a default for an unknown macOS version or undeclared platform', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin' })).toBeUndefined()
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: Number.NaN })).toBeUndefined()
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 0 })).toBeUndefined()
    expect(resolveDefaultAsrModel({ platform: 'linux' })).toBeUndefined()
    expect(resolveDefaultAsrModel({ platform: 'win32' })).toBeUndefined()
  })

  it('expresses separate one-shot models through existing capability and modality facts', () => {
    const speech = LOCAL_VOICE_MODELS.find(({ id }) => id === APPLE_TTS_MODEL_ID)!
    expect(speech.capabilities).toEqual([MODEL_CAPABILITY.AUDIO_GENERATION])
    expect(speech.inputModalities).toEqual([MODALITY.TEXT])
    expect(speech.outputModalities).toEqual([MODALITY.AUDIO])
    for (const id of [APPLE_ASR_MODEL_ID, FUNASR_MODEL_ID]) {
      const model = LOCAL_VOICE_MODELS.find((candidate) => candidate.id === id)!
      expect(model.capabilities).toEqual([MODEL_CAPABILITY.AUDIO_TRANSCRIPT])
      expect(model.inputModalities).toEqual([MODALITY.AUDIO])
      expect(model.outputModalities).toEqual([MODALITY.TEXT])
      expect(model.supportsStreaming).toBe(false)
    }
  })
})
