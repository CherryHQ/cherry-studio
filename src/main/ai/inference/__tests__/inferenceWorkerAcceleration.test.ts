import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resolveLocalInferenceProfile } from '../inferenceAcceleration'
import type { InferenceRequest, InferenceResponse } from '../inferenceProtocol'
import { inferenceWorkerSource } from '../inferenceWorkerSource'

const DIRECTML_PROFILE = resolveLocalInferenceProfile(true, { platform: 'win32', arch: 'x64' })
const COREML_PROFILE = resolveLocalInferenceProfile(true, { platform: 'darwin', arch: 'arm64' })

const TRANSFORMERS_FAKE = String.raw`
const env = {}

async function pipeline(_task, model, options = {}) {
  const device = options.device
  if (model === 'download-model') {
    if (device !== 'cpu') throw new Error('downloads must stay on cpu')
    options.progress_callback?.({ status: 'ready', progress: 100 })
  }
  if (model === 'download-fail') throw new Error('network download failed')
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

let appPath: string
let worker: Worker
let messages: InferenceResponse[]

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

function startWorker(profile = DIRECTML_PROFILE): Worker {
  const spawned = new Worker(inferenceWorkerSource, { eval: true })
  messages = []
  spawned.on('message', (message: InferenceResponse) => messages.push(message))
  spawned.postMessage({
    type: 'init',
    appPath,
    onnxRuntimeBindingPath: '',
    proxyRouting: { version: 0, mode: 'direct' },
    runtimeProfile: profile
  })
  return spawned
}

function request(message: InferenceRequest): Promise<InferenceResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: InferenceResponse) => {
      if ('id' in response && response.id === message.id && (response.type === 'result' || response.type === 'error')) {
        worker.off('message', onMessage)
        resolve(response)
      }
    }
    worker.on('message', onMessage)
    worker.once('error', reject)
    worker.postMessage(message)
  })
}

function workerLogs(): string[] {
  return messages.filter((message) => message.type === 'log').map((message) => message.message)
}

beforeEach(async () => {
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-inference-acceleration-'))
  await seedFakeDependencies(appPath)
  worker = startWorker()
})

afterEach(async () => {
  await worker.terminate()
  await rm(appPath, { recursive: true, force: true })
})

describe('inference worker hardware acceleration', () => {
  it('uses runtime-specific CoreML session options for embedding and OCR', async () => {
    await worker.terminate()
    worker = startWorker(COREML_PROFILE)

    await expect(
      request({ type: 'embedding.embed', id: 'embed', modelDir: '/hardware-ok', dtype: 'q8', texts: ['hello'] })
    ).resolves.toMatchObject({ type: 'result', embeddings: [[0.6, 0.8]] })
    await expect(
      request({
        type: 'ocr.recognize',
        id: 'ocr',
        modelPaths: { detection: '/hardware-ok', recognition: '/rec', charactersDictionary: '/dict' },
        imagePath: import.meta.filename
      })
    ).resolves.toMatchObject({ type: 'result', text: 'hardware result' })

    expect(workerLogs()).toContain('hardware provider active provider=coreml runtime=embedding')
    expect(workerLogs()).toContain('hardware provider active provider=coreml runtime=ocr')
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('uses DirectML for embedding while keeping the download pipeline on CPU', async () => {
    await expect(
      request({
        type: 'embedding.load',
        id: 'download',
        modelRepo: 'download-model',
        dtype: 'q8',
        source: { remoteHost: 'https://example.com', remotePathTemplate: '{model}', revision: 'main' }
      })
    ).resolves.toMatchObject({ type: 'result', embeddings: null })

    await expect(
      request({ type: 'embedding.embed', id: 'embed', modelDir: '/hardware-ok', dtype: 'q8', texts: ['hello'] })
    ).resolves.toMatchObject({ type: 'result', embeddings: [[0.6, 0.8]] })

    expect(workerLogs()).toContain('hardware provider active provider=directml runtime=embedding')
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('does not treat embedding download failures as hardware failures', async () => {
    const download = await request({
      type: 'embedding.load',
      id: 'download-fail',
      modelRepo: 'download-fail',
      dtype: 'q8',
      source: { remoteHost: 'https://example.com', remotePathTemplate: '{model}', revision: 'main' }
    })
    const embed = await request({
      type: 'embedding.embed',
      id: 'embed-after-download-fail',
      modelDir: '/hardware-ok',
      dtype: 'q8',
      texts: ['hello']
    })

    expect(download).toMatchObject({ type: 'error', message: 'network download failed' })
    expect(embed).toMatchObject({ type: 'result', embeddings: [[0.6, 0.8]] })
    expect(workerLogs()).toContain('hardware provider active provider=directml runtime=embedding')
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('falls embedding back to CPU once and keeps CPU for the worker lifetime', async () => {
    const first = await request({
      type: 'embedding.embed',
      id: 'first',
      modelDir: '/hardware-fail',
      dtype: 'q8',
      texts: ['hello']
    })
    const second = await request({
      type: 'embedding.embed',
      id: 'second',
      modelDir: '/hardware-fail-again',
      dtype: 'q8',
      texts: ['again']
    })

    expect(first).toMatchObject({ type: 'result', embeddings: [[0.6, 0.8]] })
    expect(second).toMatchObject({ type: 'result', embeddings: [[0.6, 0.8]] })
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
  })

  it('logs disposal failures without blocking CPU fallback', async () => {
    const response = await request({
      type: 'embedding.embed',
      id: 'dispose-fail',
      modelDir: '/hardware-fail-dispose-fail',
      dtype: 'q8',
      texts: ['hello']
    })

    expect(response).toMatchObject({ type: 'result', embeddings: [[0.6, 0.8]] })
    expect(messages).toContainEqual({
      type: 'log',
      level: 'warn',
      message: 'failed to dispose cached inference resource error=Error: embedding dispose failed'
    })
  })

  it('uses DirectML for OCR and falls only that worker back to CPU on failure', async () => {
    const hardware = await request({
      type: 'ocr.recognize',
      id: 'hardware',
      modelPaths: { detection: '/hardware-ok', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: import.meta.filename
    })
    const fallback = await request({
      type: 'ocr.recognize',
      id: 'fallback',
      modelPaths: { detection: '/runtime-fail', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: import.meta.filename
    })

    expect(hardware).toMatchObject({ type: 'result', text: 'hardware result' })
    expect(fallback).toMatchObject({ type: 'result', text: 'cpu result' })
    expect(workerLogs()).toContain('hardware provider active provider=directml runtime=ocr')
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
  })

  it('turns PaddleOCR internal fallback into sticky worker-level CPU fallback', async () => {
    const fallback = await request({
      type: 'ocr.recognize',
      id: 'internal-fallback',
      modelPaths: { detection: '/initialize-fallback', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: import.meta.filename
    })
    const nextModel = await request({
      type: 'ocr.recognize',
      id: 'next-model',
      modelPaths: { detection: '/hardware-ok-after-fallback', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: import.meta.filename
    })

    expect(fallback).toMatchObject({ type: 'result', text: 'cpu result' })
    expect(nextModel).toMatchObject({ type: 'result', text: 'cpu result' })
    expect(workerLogs()).not.toContain('hardware provider active provider=directml runtime=ocr')
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
    expect(workerLogs().some((message) => message.includes('OCR session hardware provider failed'))).toBe(true)
  })

  it('reports unreadable OCR images without disabling hardware acceleration', async () => {
    const unreadable = await request({
      type: 'ocr.recognize',
      id: 'unreadable',
      modelPaths: { detection: '/hardware-ok', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: path.join(appPath, 'missing.png')
    })
    const next = await request({
      type: 'ocr.recognize',
      id: 'next',
      modelPaths: { detection: '/hardware-ok', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: import.meta.filename
    })

    expect(unreadable).toMatchObject({ type: 'error' })
    expect(unreadable).toHaveProperty('message', expect.stringContaining('ENOENT'))
    expect(unreadable).toHaveProperty('message', expect.not.stringContaining('hardware inference failed'))
    expect(next).toMatchObject({ type: 'result', text: 'hardware result' })
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('reports both hardware and CPU errors when the fallback also fails', async () => {
    const response = await request({
      type: 'ocr.recognize',
      id: 'both-fail',
      modelPaths: { detection: '/both-fail', recognition: '/rec', charactersDictionary: '/dict' },
      imagePath: import.meta.filename
    })

    expect(response).toMatchObject({ type: 'error' })
    expect(response).toHaveProperty('message', expect.stringContaining('ocr failed on dml'))
    expect(response).toHaveProperty('message', expect.stringContaining('ocr failed on cpu'))
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
  })
})
