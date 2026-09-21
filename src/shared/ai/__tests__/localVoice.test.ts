import { describe, expect, it } from 'vitest'

import { MODALITY, MODEL_CAPABILITY } from '@shared/data/types/model'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  LOCAL_VOICE_MODELS,
  resolveDefaultAsrModel
} from '../localVoice'
import * as localVoice from '../localVoice'

describe('local voice model facts and default resolution', () => {
  it('publishes the product speech-speed contract', () => {
    expect(localVoice).toMatchObject({
      DEFAULT_SPEECH_SPEED: 1,
      MIN_SPEECH_SPEED: 0.5,
      MAX_SPEECH_SPEED: 2
    })
  })

  it('recommends Apple ASR only on macOS 26 and newer', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'arm64', majorVersion: 26 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'x64', majorVersion: 27 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'arm64', majorVersion: 25 })).toBe(FUNASR_MODEL_ID)
  })

  it('recommends FunASR on every platform its verified native artifact supports', () => {
    expect(resolveDefaultAsrModel({ platform: 'linux', arch: 'x64' })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'linux', arch: 'arm64' })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'x64' })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'arm64' })).toBeUndefined()
  })

  it('preserves explicit selection regardless of platform availability', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 }, FUNASR_MODEL_ID)).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 25 }, APPLE_ASR_MODEL_ID)).toBe(
      APPLE_ASR_MODEL_ID
    )
    expect(resolveDefaultAsrModel({ platform: 'linux' }, APPLE_ASR_MODEL_ID)).toBe(APPLE_ASR_MODEL_ID)
  })

  it('uses FunASR when Apple support is unknown but the native platform is supported', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin' })).toBeUndefined()
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'arm64', majorVersion: Number.NaN })).toBe(
      FUNASR_MODEL_ID
    )
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'arm64', majorVersion: 0 })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'linux' })).toBeUndefined()
    expect(resolveDefaultAsrModel({ platform: 'freebsd', arch: 'x64' })).toBeUndefined()
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
