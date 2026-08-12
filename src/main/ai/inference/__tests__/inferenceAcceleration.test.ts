import { describe, expect, it } from 'vitest'

import { isLocalInferenceHardwareAccelerationSupported, resolveLocalInferenceProfile } from '../inferenceAcceleration'

describe('local inference acceleration profiles', () => {
  it.each([
    { platform: 'win32', arch: 'x64' },
    { platform: 'win32', arch: 'arm64' },
    { platform: 'darwin', arch: 'arm64' }
  ] as const)('keeps the CPU profile when acceleration is disabled on $platform-$arch', (target) => {
    expect(resolveLocalInferenceProfile(false, target)).toEqual({
      id: 'cpu',
      transformersDevice: 'cpu',
      sessionOptions: { executionProviders: ['cpu'] }
    })
  })

  it.each([
    { platform: 'win32', arch: 'x64' },
    { platform: 'win32', arch: 'arm64' }
  ] as const)('uses the DirectML-safe profile on $platform-$arch', (target) => {
    expect(isLocalInferenceHardwareAccelerationSupported(target)).toBe(true)
    expect(resolveLocalInferenceProfile(true, target)).toEqual({
      id: 'directml',
      transformersDevice: 'dml',
      sessionOptions: {
        executionProviders: ['dml', 'cpu'],
        enableMemPattern: false,
        executionMode: 'sequential'
      }
    })
  })

  it('uses CoreML on Apple Silicon', () => {
    const target = { platform: 'darwin', arch: 'arm64' } as const

    expect(isLocalInferenceHardwareAccelerationSupported(target)).toBe(true)
    expect(resolveLocalInferenceProfile(true, target)).toEqual({
      id: 'coreml',
      transformersDevice: 'coreml',
      sessionOptions: { executionProviders: ['coreml', 'cpu'] },
      embeddingSessionOptions: {
        executionProviders: [{ name: 'coreml', coreMlFlags: 8 }, 'cpu']
      }
    })
  })

  it.each([
    { platform: 'linux', arch: 'x64' },
    { platform: 'linux', arch: 'arm64' },
    { platform: 'darwin', arch: 'x64' }
  ] as const)('keeps CPU and reports no hardware option on $platform-$arch', (target) => {
    expect(isLocalInferenceHardwareAccelerationSupported(target)).toBe(false)
    expect(resolveLocalInferenceProfile(true, target).id).toBe('cpu')
  })
})
