import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EmbeddingEmbedPayload } from '../../capabilities/embedding/protocol'
import { embeddingWorkerSource } from '../../capabilities/embedding/worker'
import type { OcrRecognizePayload } from '../../capabilities/ocr/protocol'
import { ocrWorkerSource } from '../../capabilities/ocr/worker'
import { resolveLocalInferenceProfile } from '../inferenceAcceleration'
import type { InferenceRequestMessage, InferenceResponse, LocalInferenceRuntimeProfile } from '../protocol'
import { buildInferenceWorkerSource } from '../worker/buildWorkerSource'

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

type TestRequest =
  | InferenceRequestMessage<'embedding', 'embed', EmbeddingEmbedPayload>
  | InferenceRequestMessage<'ocr', 'recognize', OcrRecognizePayload>

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

function startWorker(
  capability: 'embedding' | 'ocr',
  profile: LocalInferenceRuntimeProfile = DIRECTML_PROFILE
): Worker {
  const moduleSource = capability === 'embedding' ? embeddingWorkerSource : ocrWorkerSource
  const spawned = new Worker(buildInferenceWorkerSource('', moduleSource), { eval: true })
  messages = []
  spawned.on('message', (message: InferenceResponse) => messages.push(message))
  spawned.postMessage({
    kind: 'init',
    capability,
    appPath,
    artifactPaths: {},
    proxyRouting: { version: 0, mode: 'direct' },
    runtimeProfile: profile
  })
  return spawned
}

async function switchWorker(
  capability: 'embedding' | 'ocr',
  profile: LocalInferenceRuntimeProfile = DIRECTML_PROFILE
): Promise<void> {
  await worker.terminate()
  worker = startWorker(capability, profile)
}

function embeddingRequest(requestId: string, modelDir: string): TestRequest {
  return {
    kind: 'request',
    capability: 'embedding',
    type: 'embed',
    requestId,
    payload: { modelDir, dtype: 'q8', texts: ['hello'] }
  }
}

function ocrRequest(requestId: string, detection: string, imagePath = import.meta.filename): TestRequest {
  return {
    kind: 'request',
    capability: 'ocr',
    type: 'recognize',
    requestId,
    payload: {
      modelPaths: { detection, recognition: '/rec', charactersDictionary: '/dict' },
      source: { kind: 'path', imagePath }
    }
  }
}

function request(message: TestRequest): Promise<InferenceResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (response: InferenceResponse) => {
      if (
        'requestId' in response &&
        response.requestId === message.requestId &&
        (response.kind === 'result' || response.kind === 'error')
      ) {
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
  return messages.filter((message) => message.kind === 'log').map((message) => message.message)
}

beforeEach(async () => {
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-inference-acceleration-'))
  await seedFakeDependencies(appPath)
  worker = startWorker('embedding')
})

afterEach(async () => {
  await worker.terminate()
  await rm(appPath, { recursive: true, force: true })
})

describe('inference worker hardware acceleration', () => {
  it('uses runtime-specific CoreML session options for each capability worker', async () => {
    await switchWorker('embedding', COREML_PROFILE)
    await expect(request(embeddingRequest('embed', '/hardware-ok'))).resolves.toMatchObject({
      kind: 'result',
      payload: { embeddings: [[0.6, 0.8]] }
    })
    expect(workerLogs()).toContain('hardware provider active provider=coreml runtime=embedding')

    await switchWorker('ocr', COREML_PROFILE)
    await expect(request(ocrRequest('ocr', '/hardware-ok'))).resolves.toMatchObject({
      kind: 'result',
      payload: { text: 'hardware result' }
    })
    expect(workerLogs()).toContain('hardware provider active provider=coreml runtime=ocr')
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('uses DirectML session options for embedding', async () => {
    await expect(request(embeddingRequest('embed', '/hardware-ok'))).resolves.toMatchObject({
      kind: 'result',
      payload: { embeddings: [[0.6, 0.8]] }
    })

    expect(workerLogs()).toContain('hardware provider active provider=directml runtime=embedding')
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('falls embedding back to CPU once and keeps CPU for the worker lifetime', async () => {
    const first = await request(embeddingRequest('first', '/hardware-fail'))
    const second = await request(embeddingRequest('second', '/hardware-fail-again'))

    expect(first).toMatchObject({ kind: 'result', payload: { embeddings: [[0.6, 0.8]] } })
    expect(second).toMatchObject({ kind: 'result', payload: { embeddings: [[0.6, 0.8]] } })
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
  })

  it('logs disposal failures without blocking CPU fallback', async () => {
    const response = await request(embeddingRequest('dispose-fail', '/hardware-fail-dispose-fail'))

    expect(response).toMatchObject({ kind: 'result', payload: { embeddings: [[0.6, 0.8]] } })
    expect(messages).toContainEqual({
      kind: 'log',
      level: 'warn',
      message: 'failed to dispose cached inference resource error=Error: embedding dispose failed'
    })
  })

  it('uses DirectML for OCR and falls that capability worker back to CPU on failure', async () => {
    await switchWorker('ocr')
    const hardware = await request(ocrRequest('hardware', '/hardware-ok'))
    const fallback = await request(ocrRequest('fallback', '/runtime-fail'))

    expect(hardware).toMatchObject({ kind: 'result', payload: { text: 'hardware result' } })
    expect(fallback).toMatchObject({ kind: 'result', payload: { text: 'cpu result' } })
    expect(workerLogs()).toContain('hardware provider active provider=directml runtime=ocr')
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
  })

  it('turns PaddleOCR internal fallback into sticky worker-level CPU fallback', async () => {
    await switchWorker('ocr')
    const fallback = await request(ocrRequest('internal-fallback', '/initialize-fallback'))
    const nextModel = await request(ocrRequest('next-model', '/hardware-ok-after-fallback'))

    expect(fallback).toMatchObject({ kind: 'result', payload: { text: 'cpu result' } })
    expect(nextModel).toMatchObject({ kind: 'result', payload: { text: 'cpu result' } })
    expect(workerLogs()).not.toContain('hardware provider active provider=directml runtime=ocr')
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
    expect(workerLogs().some((message) => message.includes('OCR session hardware provider failed'))).toBe(true)
  })

  it('reports unreadable OCR images without disabling hardware acceleration', async () => {
    await switchWorker('ocr')
    const unreadable = await request(ocrRequest('unreadable', '/hardware-ok', path.join(appPath, 'missing.png')))
    const next = await request(ocrRequest('next', '/hardware-ok'))

    expect(unreadable).toMatchObject({ kind: 'error' })
    expect(unreadable).toHaveProperty('message', expect.stringContaining('ENOENT'))
    expect(unreadable).toHaveProperty('message', expect.not.stringContaining('hardware inference failed'))
    expect(next).toMatchObject({ kind: 'result', payload: { text: 'hardware result' } })
    expect(workerLogs().some((message) => message.includes('falling back'))).toBe(false)
  })

  it('reports both hardware and CPU errors when the fallback also fails', async () => {
    await switchWorker('ocr')
    const response = await request(ocrRequest('both-fail', '/both-fail'))

    expect(response).toMatchObject({ kind: 'error' })
    expect(response).toHaveProperty('message', expect.stringContaining('ocr failed on dml'))
    expect(response).toHaveProperty('message', expect.stringContaining('ocr failed on cpu'))
    expect(workerLogs().filter((message) => message.includes('falling back'))).toHaveLength(1)
  })
})
