import { describe, expect, it } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  KOKORO_TTS_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'

import { resolveDefaultAsrModel, resolveDefaultSpeechModel } from '../voicePlatform'

describe('local voice model facts and default resolution', () => {
  it('recommends Apple ASR on supported macOS releases', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 13 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 15 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 27 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'arm64', majorVersion: 25 })).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 12 })).toBeUndefined()
  })

  it('recommends a native system engine before requiring a model download', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'arm64', majorVersion: 12 })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', arch: 'x64', majorVersion: 12 })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'linux', arch: 'x64' })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'linux', arch: 'arm64' })).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'x64' })).toBe(WINDOWS_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'arm64' })).toBeUndefined()
  })

  it('preserves explicit selection regardless of platform availability', () => {
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 26 }, FUNASR_MODEL_ID)).toBe(FUNASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'darwin', majorVersion: 25 }, APPLE_ASR_MODEL_ID)).toBe(
      APPLE_ASR_MODEL_ID
    )
    expect(resolveDefaultAsrModel({ platform: 'linux' }, APPLE_ASR_MODEL_ID)).toBe(APPLE_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'x64' }, WINDOWS_ASR_MODEL_ID)).toBe(WINDOWS_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'arm64' }, WINDOWS_ASR_MODEL_ID)).toBe(
      WINDOWS_ASR_MODEL_ID
    )
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
})

describe('default system speech model', () => {
  it('selects Windows only for x64 and preserves supported Apple versions', () => {
    expect(resolveDefaultSpeechModel({ platform: 'win32', arch: 'x64' })).toBe(WINDOWS_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'win32', arch: 'arm64' })).toBeUndefined()
    expect(resolveDefaultSpeechModel({ platform: 'darwin', arch: 'arm64', majorVersion: 13 })).toBe(APPLE_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'darwin', arch: 'x64', majorVersion: 12 })).toBe(KOKORO_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'linux', arch: 'x64' })).toBe(KOKORO_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'linux', arch: 'arm64' })).toBe(KOKORO_TTS_MODEL_ID)
  })
})
