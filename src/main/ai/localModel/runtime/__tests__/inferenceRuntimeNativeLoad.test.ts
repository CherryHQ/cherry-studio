import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveLocalInferenceProfile } from '../inferenceAcceleration'
import type { InferenceInitData } from '../protocol'
import { loadInferenceEntries } from './inferenceEntryHarness'

/**
 * Native-runtime load failure (issue #20021): on affected Windows machines
 * `onnxruntime_binding.node` throws `A dynamic link library (DLL)
 * initialization routine failed` while loading, so both OCR and embedding fail
 * even though every file exists on disk. The failure must read as a broken
 * native runtime with a deterministic repair (re-download the runtime), never
 * as a network download failure.
 */

const DIRECTML_PROFILE = resolveLocalInferenceProfile(true, { platform: 'win32', arch: 'x64' })

const DLL_ERROR_MESSAGE =
  'The specified module could not be found. A dynamic link library (DLL) initialization routine failed. \\\\?\\C:\\Users\\test\\onnxruntime_binding.node'

const BROKEN_TRANSFORMERS_FAKE = String.raw`
async function pipeline() {
  const error = new Error('__DLL_MESSAGE__')
  error.code = 'ERR_DLOPEN_FAILED'
  throw error
}
module.exports = { env: {}, pipeline }
`.replace('__DLL_MESSAGE__', DLL_ERROR_MESSAGE)

const BROKEN_PADDLE_FAKE = String.raw`
export class PaddleOcrService {
  constructor() {}
  async initialize() {
    const error = new Error('__DLL_MESSAGE__')
    error.code = 'ERR_DLOPEN_FAILED'
    throw error
  }
  async recognize() {
    throw new Error('unreachable')
  }
  async destroy() {}
}
`.replaceAll('__DLL_MESSAGE__', DLL_ERROR_MESSAGE)

const OCR_MODEL = {
  detection: '/models/det.onnx',
  recognition: '/models/rec.onnx',
  charactersDictionary: '/models/dict.txt'
}
const IMAGE = { kind: 'path', imagePath: import.meta.filename } as const

let appPath: string

async function seedBrokenDependencies(root: string): Promise<void> {
  const transformersDir = path.join(root, 'node_modules', '@huggingface', 'transformers')
  const paddleDir = path.join(root, 'node_modules', 'ppu-paddle-ocr')
  await Promise.all([mkdir(transformersDir, { recursive: true }), mkdir(paddleDir, { recursive: true })])
  await Promise.all([
    writeFile(
      path.join(transformersDir, 'package.json'),
      JSON.stringify({ name: '@huggingface/transformers', main: 'index.cjs' })
    ),
    writeFile(path.join(transformersDir, 'index.cjs'), BROKEN_TRANSFORMERS_FAKE),
    writeFile(
      path.join(paddleDir, 'package.json'),
      JSON.stringify({ name: 'ppu-paddle-ocr', type: 'module', exports: './index.js' })
    ),
    writeFile(path.join(paddleDir, 'index.js'), BROKEN_PADDLE_FAKE)
  ])
}

beforeEach(async () => {
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-native-runtime-load-'))
  await seedBrokenDependencies(appPath)
})

afterEach(async () => {
  vi.resetModules()
  await rm(appPath, { recursive: true, force: true })
})

async function loadBrokenEntries() {
  const initData: InferenceInitData = { appPath, artifactPaths: {}, runtimeProfile: DIRECTML_PROFILE }
  return loadInferenceEntries(initData)
}

describe('native runtime load failure reporting', () => {
  it('reports a broken onnxruntime binding as a native runtime failure with a repair path, not a download failure', async () => {
    const { embedding } = await loadBrokenEntries()
    const failure = await embedding
      .embed({ modelDir: '/models/embedding', dtype: 'q8', texts: ['hello'] })
      .then(() => 'unexpected success')
      .catch((error: unknown) => String(error))

    expect(failure).toContain('native runtime')
    expect(failure).toMatch(/re-?download|reinstall/i)
    expect(failure).toContain('DLL')
    expect(failure).not.toMatch(/mirror|HTTP \d+|sha256 mismatch/i)
  })

  it('reports the same classified failure for OCR', async () => {
    const { ocr } = await loadBrokenEntries()
    const failure = await ocr
      .recognize({ modelPaths: OCR_MODEL, source: IMAGE })
      .then(() => 'unexpected success')
      .catch((error: unknown) => String(error))

    expect(failure).toContain('native runtime')
    expect(failure).toMatch(/re-?download|reinstall/i)
  })

  it('classifies DLL load errors across the cause chain and rejects network errors', async () => {
    const { isNativeRuntimeLoadError } = await import('../utilityEntries/inferenceRuntime')
    const dllError = new Error(`require failed`, {
      cause: Object.assign(new Error(DLL_ERROR_MESSAGE), { code: 'ERR_DLOPEN_FAILED' })
    })
    expect(isNativeRuntimeLoadError(dllError)).toBe(true)
    expect(
      isNativeRuntimeLoadError(
        new Error('The specified module could not be found. \\\\?\\C:\\app\\onnxruntime_binding.node')
      )
    ).toBe(true)
    expect(isNativeRuntimeLoadError(new Error('fetch failed'))).toBe(false)
    expect(isNativeRuntimeLoadError(new Error('HTTP 500 for https://registry.npmjs.org/onnxruntime-node'))).toBe(false)
    expect(isNativeRuntimeLoadError(new Error('sha256 mismatch for https://registry.npmjs.org/x.tgz'))).toBe(false)
  })
})
