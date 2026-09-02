import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveLocalInferenceProfile } from '../inferenceAcceleration'
import type { InferenceInitData, LocalInferenceRuntimeProfile } from '../protocol'
import type { EmbeddingHandlers, OcrHandlers } from './inferenceEntryHarness'
import { loadInferenceEntries } from './inferenceEntryHarness'

/**
 * Exercises the hardware-acceleration policy the two entry modules share: which session
 * options each runtime gets, and the one-shot, process-sticky CPU fallback. The fake
 * packages fail on hardware providers only, so a profile plumbed through wrongly (or a
 * fallback that fires twice, or not at all) changes the result rather than a mock call count.
 */

const DIRECTML_PROFILE = resolveLocalInferenceProfile(true, { platform: 'win32', arch: 'x64' })
const COREML_PROFILE = resolveLocalInferenceProfile(true, { platform: 'darwin', arch: 'arm64' })

const TRANSFORMERS_FAKE = String.raw`
const env = {}

async function pipeline(_task, model, options = {}) {
  const device = options.device
  if (device === 'dml') {
    const session = options.session_options || {}
    const providers = JSON.stringify(session.executionProviders)
    if (providers !== JSON.stringify(['dml', 'cpu']) || session.enableMemPattern !== false || session.executionMode !== 'sequential') {
      throw new Error('invalid DirectML session options')
    }
  }
  if (device === 'coreml') {
    const providers = JSON.stringify(options.session_options?.executionProviders)
    const expected = JSON.stringify([{ name: 'coreml', coreMlFlags: 8 }, 'cpu'])
    if (providers !== expected) throw new Error('invalid CoreML embedding session options')
  }

  const extractor = async () => {
    if (String(model).includes('hardware-fail') && device !== 'cpu') throw new Error('embedding hardware failed')
    if (String(model).includes('both-fail')) throw new Error('embedding failed on ' + device)
    return { dims: [1, 1, 2], tolist: () => [[[3, 4]]] }
  }
  extractor.tokenizer = { encode: (text) => Array.from(String(text)) }
  extractor.dispose = async () => {
    if (String(model).includes('dispose-fail')) throw new Error('embedding dispose failed')
  }
  return extractor
}

module.exports = { env, pipeline }
`

const PADDLE_FAKE = String.raw`
export class PaddleOcrService {
  constructor(options) {
    this.options = options
    this.device = options.session.executionProviders[0]
    if (this.device === 'dml') {
      const session = options.session
      if (JSON.stringify(session.executionProviders) !== JSON.stringify(['dml', 'cpu']) || session.enableMemPattern !== false || session.executionMode !== 'sequential') {
        throw new Error('invalid DirectML session options')
      }
    }
    if (typeof this.device === 'object') throw new Error('OCR must use the dynamic CoreML session options')
  }

  async initialize() {
    if (this.options.model.detection.includes('initialize-fallback') && this.device !== 'cpu') {
      this.device = 'cpu'
      this.options.session.onSessionFallback?.(new Error('OCR session hardware provider failed'))
    }
  }

  async recognize() {
    const detection = this.options.model.detection
    if (detection.includes('runtime-fail') && this.device !== 'cpu') throw new Error('ocr hardware failed')
    if (detection.includes('both-fail')) throw new Error('ocr failed on ' + this.device)
    return { text: this.device === 'cpu' ? 'cpu result' : 'hardware result' }
  }

  async destroy() {}
}
`

const OCR_MODEL = (detection: string) => ({ detection, recognition: '/rec', charactersDictionary: '/dict' })
const IMAGE = { kind: 'path', imagePath: import.meta.filename } as const

let appPath: string
let embedding: EmbeddingHandlers
let ocr: OcrHandlers
let logs: string[]

async function seedFakeDependencies(root: string): Promise<void> {
  const transformersDir = path.join(root, 'node_modules', '@huggingface', 'transformers')
  const paddleDir = path.join(root, 'node_modules', 'ppu-paddle-ocr')
  await Promise.all([mkdir(transformersDir, { recursive: true }), mkdir(paddleDir, { recursive: true })])
  await Promise.all([
    writeFile(
      path.join(transformersDir, 'package.json'),
      JSON.stringify({ name: '@huggingface/transformers', main: 'index.cjs' })
    ),
    writeFile(path.join(transformersDir, 'index.cjs'), TRANSFORMERS_FAKE),
    writeFile(
      path.join(paddleDir, 'package.json'),
      JSON.stringify({ name: 'ppu-paddle-ocr', type: 'module', exports: './index.js' })
    ),
    writeFile(path.join(paddleDir, 'index.js'), PADDLE_FAKE)
  ])
}

async function start(runtimeProfile: LocalInferenceRuntimeProfile = DIRECTML_PROFILE): Promise<void> {
  const initData: InferenceInitData = {
    appPath,
    artifactPaths: {},
    proxyRouting: { version: 0, mode: 'direct' },
    runtimeProfile
  }
  const loaded = await loadInferenceEntries(initData)
  embedding = loaded.embedding
  ocr = loaded.ocr
  logs = loaded.logs
}

beforeEach(async () => {
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-inference-acceleration-'))
  await seedFakeDependencies(appPath)
  await start()
})

afterEach(async () => {
  vi.resetModules()
  await rm(appPath, { recursive: true, force: true })
})

describe('inference entry hardware acceleration', () => {
  it('uses runtime-specific CoreML session options for embedding and OCR', async () => {
    await start(COREML_PROFILE)

    await expect(embedding.embed({ modelDir: '/hardware-ok', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([
      [0.6, 0.8]
    ])
    await expect(ocr.recognize({ modelPaths: OCR_MODEL('/hardware-ok'), source: IMAGE })).resolves.toMatchObject({
      text: 'hardware result'
    })

    expect(logs).toContain('info: hardware provider active provider=coreml runtime=embedding')
    expect(logs).toContain('info: hardware provider active provider=coreml runtime=ocr')
    expect(logs.some((message) => message.includes('falling back'))).toBe(false)
  })

  it('uses DirectML for embedding', async () => {
    await expect(embedding.embed({ modelDir: '/hardware-ok', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([
      [0.6, 0.8]
    ])

    expect(logs).toContain('info: hardware provider active provider=directml runtime=embedding')
    expect(logs.some((message) => message.includes('falling back'))).toBe(false)
  })

  it('falls embedding back to CPU once and keeps CPU for the process lifetime', async () => {
    await expect(embedding.embed({ modelDir: '/hardware-fail', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([
      [0.6, 0.8]
    ])
    await expect(embedding.embed({ modelDir: '/hardware-fail-again', dtype: 'q8', texts: ['again'] })).resolves.toEqual(
      [[0.6, 0.8]]
    )

    expect(logs.filter((message) => message.includes('falling back'))).toHaveLength(1)
  })

  it('logs disposal failures without blocking CPU fallback', async () => {
    await expect(
      embedding.embed({ modelDir: '/hardware-fail-dispose-fail', dtype: 'q8', texts: ['hello'] })
    ).resolves.toEqual([[0.6, 0.8]])

    expect(logs).toContain('warn: failed to dispose cached inference resource error=Error: embedding dispose failed')
  })

  it('uses DirectML for OCR and falls back to CPU on failure', async () => {
    await expect(ocr.recognize({ modelPaths: OCR_MODEL('/hardware-ok'), source: IMAGE })).resolves.toMatchObject({
      text: 'hardware result'
    })
    await expect(ocr.recognize({ modelPaths: OCR_MODEL('/runtime-fail'), source: IMAGE })).resolves.toMatchObject({
      text: 'cpu result'
    })

    expect(logs).toContain('info: hardware provider active provider=directml runtime=ocr')
    expect(logs.filter((message) => message.includes('falling back'))).toHaveLength(1)
  })

  it('turns PaddleOCR internal fallback into sticky process-level CPU fallback', async () => {
    await expect(
      ocr.recognize({ modelPaths: OCR_MODEL('/initialize-fallback'), source: IMAGE })
    ).resolves.toMatchObject({ text: 'cpu result' })
    await expect(
      ocr.recognize({ modelPaths: OCR_MODEL('/hardware-ok-after-fallback'), source: IMAGE })
    ).resolves.toMatchObject({ text: 'cpu result' })

    expect(logs).not.toContain('info: hardware provider active provider=directml runtime=ocr')
    expect(logs.filter((message) => message.includes('falling back'))).toHaveLength(1)
    expect(logs.some((message) => message.includes('OCR session hardware provider failed'))).toBe(true)
  })

  it('reports unreadable OCR images without disabling hardware acceleration', async () => {
    const unreadable = await ocr
      .recognize({
        modelPaths: OCR_MODEL('/hardware-ok'),
        source: { kind: 'path', imagePath: path.join(appPath, 'missing.png') }
      })
      .catch((error: unknown) => String(error))
    expect(unreadable).toContain('ENOENT')
    expect(unreadable).not.toContain('hardware inference failed')

    await expect(ocr.recognize({ modelPaths: OCR_MODEL('/hardware-ok'), source: IMAGE })).resolves.toMatchObject({
      text: 'hardware result'
    })
    expect(logs.some((message) => message.includes('falling back'))).toBe(false)
  })

  it('reports both hardware and CPU errors when the fallback also fails', async () => {
    const failure = await ocr
      .recognize({ modelPaths: OCR_MODEL('/both-fail'), source: IMAGE })
      .catch((error: unknown) => String(error))

    expect(failure).toContain('ocr failed on dml')
    expect(failure).toContain('ocr failed on cpu')
    expect(logs.filter((message) => message.includes('falling back'))).toHaveLength(1)
  })
})
