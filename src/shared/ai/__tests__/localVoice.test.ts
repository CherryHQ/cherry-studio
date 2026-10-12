import { describe, expect, it } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  isSpeechModelId,
  isTranscriptionModelId
} from '../localVoice'

describe('voice model identity validation', () => {
  it('rejects unknown and wrong-capability identifiers', () => {
    expect(isTranscriptionModelId(APPLE_ASR_MODEL_ID)).toBe(true)
    expect(isTranscriptionModelId(FUNASR_MODEL_ID)).toBe(true)
    expect(isTranscriptionModelId(APPLE_TTS_MODEL_ID)).toBe(false)
    expect(isSpeechModelId(APPLE_TTS_MODEL_ID)).toBe(true)
    expect(isSpeechModelId(APPLE_ASR_MODEL_ID)).toBe(false)
    expect(isSpeechModelId('unknown')).toBe(false)
    expect(isTranscriptionModelId('')).toBe(false)
  })
})
