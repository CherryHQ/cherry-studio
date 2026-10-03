import { describe, expect, it } from 'vitest'

import { resolveLocalInferenceProfile } from '../inferenceAcceleration'
import { applyInitData, isNativeRuntimeLoadError, withHardwareFallback } from '../utilityEntries/inferenceRuntime'

const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }

describe('native runtime load failure classification', () => {
  it('requires an onnxruntime-related signal alongside a loader error', () => {
    expect(
      isNativeRuntimeLoadError(new Error('The specified module could not be found. onnxruntime_binding.node'))
    ).toBe(true)
    expect(isNativeRuntimeLoadError(new Error('The specified module could not be found.'))).toBe(false)
    expect(isNativeRuntimeLoadError(new Error('fetch failed'))).toBe(false)
    expect(isNativeRuntimeLoadError(new Error('HTTP 500 for https://registry.npmjs.org/onnxruntime-node'))).toBe(false)
  })

  it('walks causes and recognizes the Windows DLL initialization failure', () => {
    const error = new Error('require failed', {
      cause: Object.assign(
        new Error('A dynamic link library (DLL) initialization routine failed for onnxruntime_binding.node'),
        { code: 'ERR_DLOPEN_FAILED' }
      )
    })

    expect(isNativeRuntimeLoadError(error)).toBe(true)
  })

  it('keeps the CPU diagnostic when native loading also fails during fallback', async () => {
    applyInitData({
      appPath: '/tmp/cherry-studio',
      artifactPaths: {},
      runtimeProfile: resolveLocalInferenceProfile(true, { platform: 'win32', arch: 'x64' })
    })
    let attempts = 0

    const failure = await withHardwareFallback(
      async () => {
        attempts += 1
        if (attempts === 1) throw new Error('ERR_DLOPEN_FAILED onnxruntime_binding.node')
        throw new Error('CPU inference failed while loading the model')
      },
      { logger, describeRequest: () => 'request=test' }
    ).catch((error: unknown) => String(error))

    expect(failure).toContain('native runtime')
    expect(failure).toContain('CPU fallback failed')
    expect(failure).toContain('CPU inference failed')
  })
})
