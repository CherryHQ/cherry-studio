import { shell } from 'electron'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  APPLE_ASR_MODEL_ID,
  APPLE_TTS_MODEL_ID,
  FUNASR_MODEL_ID,
  KOKORO_TTS_MODEL_ID,
  WINDOWS_ASR_MODEL_ID,
  WINDOWS_TTS_MODEL_ID
} from '@shared/ai/localVoice'

import {
  getVoiceEnvironment,
  openMicrophoneSettings,
  openSystemVoiceSettings,
  resolveDefaultAsrModel,
  resolveDefaultSpeechModel
} from '../voicePlatform'

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
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'arm64' })).toBe(FUNASR_MODEL_ID)
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
    expect(resolveDefaultSpeechModel({ platform: 'win32', arch: 'arm64' })).toBe(KOKORO_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'darwin', arch: 'arm64', majorVersion: 13 })).toBe(APPLE_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'darwin', arch: 'x64', majorVersion: 12 })).toBe(KOKORO_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'linux', arch: 'x64' })).toBe(KOKORO_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'linux', arch: 'arm64' })).toBe(KOKORO_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'win32', arch: 'x64', majorVersion: 10 })).toBe(WINDOWS_TTS_MODEL_ID)
    expect(resolveDefaultSpeechModel({ platform: 'win32', arch: 'x64', majorVersion: 6 })).toBeUndefined()
  })
})

describe('legacy Windows voice environment and settings guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('excludes both Windows WinRT and sherpa-onnx defaults when Windows majorVersion is below 10', () => {
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'x64', majorVersion: 10 })).toBe(WINDOWS_ASR_MODEL_ID)
    expect(resolveDefaultAsrModel({ platform: 'win32', arch: 'x64', majorVersion: 6 })).toBeUndefined()
    expect(resolveDefaultSpeechModel({ platform: 'win32', arch: 'x64', majorVersion: 6 })).toBeUndefined()
  })

  it('rejects opening Windows ms-settings URIs on Windows 7 while keeping Windows 10 working', async () => {
    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'win32' },
        arch: { value: 'x64' },
        getSystemVersion: { value: () => '6.1.7601' }
      })
    )

    expect(getVoiceEnvironment()).toEqual({ platform: 'win32', arch: 'x64', majorVersion: 6, minorVersion: 1 })
    await expect(openMicrophoneSettings()).rejects.toMatchObject({ reason: 'unsupported' })
    await expect(openSystemVoiceSettings()).rejects.toMatchObject({ reason: 'unsupported' })
    expect(shell.openExternal).not.toHaveBeenCalled()

    vi.stubGlobal(
      'process',
      Object.defineProperties(Object.create(process), {
        platform: { value: 'win32' },
        arch: { value: 'x64' },
        getSystemVersion: { value: () => '10.0.19045' }
      })
    )

    expect(getVoiceEnvironment()).toEqual({ platform: 'win32', arch: 'x64', majorVersion: 10, minorVersion: 0 })
    await openMicrophoneSettings()
    await openSystemVoiceSettings()
    expect(shell.openExternal).toHaveBeenCalledWith('ms-settings:privacy-microphone')
    expect(shell.openExternal).toHaveBeenCalledWith('ms-settings:speech')
  })
})
