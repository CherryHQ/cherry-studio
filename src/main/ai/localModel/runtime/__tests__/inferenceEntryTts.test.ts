import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SHARED_ARTIFACTS } from '../../catalog/catalog'
import mlxNodeRelease from '../../catalog/mlxNodeRelease.json'

let modelDir: string

beforeEach(async () => {
  vi.resetModules()
  modelDir = await mkdtemp(path.join(tmpdir(), 'cherry-tts-package-'))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(modelDir, { recursive: true, force: true })
})

describe('application-owned TTS JavaScript package', () => {
  it('loads the application API before requiring any downloaded native code', async () => {
    await writeFile(path.join(modelDir, 'config.json'), JSON.stringify({ model_type: 'unsupported' }))
    vi.stubEnv('NAPI_RS_NATIVE_LIBRARY_PATH', '')
    const { initializeTts, ttsHandlers } = await import('../utilityEntries/inferenceTtsHandlers')
    initializeTts({ appPath: process.cwd(), bindingPath: path.join(modelDir, 'missing.node') })

    await expect(
      ttsHandlers.synthesize(
        {
          modelDir,
          text: 'Hello',
          voice: 'vivian',
          language: 'English',
          speed: 1,
          outputPath: path.join(modelDir, 'out.wav')
        },
        {
          signal: new AbortController().signal,
          emit: () => {},
          logger: { debug() {}, info() {}, warn() {}, error() {} }
        }
      )
    ).rejects.toMatchObject({
      code: 'TTS_MODEL_LOAD_FAILED',
      cause: { message: 'Unsupported TTS model family: unsupported' }
    })
  })

  it('uses the host-provided native path when inference starts', async () => {
    await writeFile(path.join(modelDir, 'config.json'), JSON.stringify({ model_type: 'qwen3_tts' }))
    vi.stubEnv('NAPI_RS_NATIVE_LIBRARY_PATH', '')
    const bindingPath = path.join(modelDir, 'missing-verified-binding.node')
    const { initializeTts, ttsHandlers } = await import('../utilityEntries/inferenceTtsHandlers')
    initializeTts({ appPath: process.cwd(), bindingPath })
    const error = await Promise.resolve(
      ttsHandlers.synthesize(
        {
          modelDir,
          text: 'Hello',
          voice: 'vivian',
          language: 'English',
          speed: 1,
          outputPath: path.join(modelDir, 'out.wav')
        },
        {
          signal: new AbortController().signal,
          emit: () => {},
          logger: { debug() {}, info() {}, warn() {}, error() {} }
        }
      )
    ).catch((cause: Error) => cause)
    expect(error).toMatchObject({ code: 'TTS_MODEL_LOAD_FAILED' })
    const causes: string[] = []
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) causes.push(cause.message)
    expect(causes.join('\n')).toContain(bindingPath)
  })

  it('ships JavaScript with the app and downloads only matching native files', async () => {
    const entry = createRequire(`${process.cwd()}/`).resolve('@cherrystudio/mlx-tts')
    const packageDir = path.resolve(path.dirname(entry), '..')
    const manifest = JSON.parse(await readFile(path.join(packageDir, 'package.json'), 'utf8'))
    expect(manifest.upstreamRevision).toBe(mlxNodeRelease.sourceRevision)
    const packageFiles = await readdir(packageDir, { recursive: true })
    expect(packageFiles.some((file) => /\.(node|metallib|safetensors)$/.test(file))).toBe(false)
    const native = SHARED_ARTIFACTS['mlx-node'].platforms['darwin-arm64']
    expect(native.entryFile).toMatch(/\.node$/)
    expect([native.entryFile, ...native.supportFiles].some((file) => /\.[cm]?js$/.test(file))).toBe(false)
  })
})
