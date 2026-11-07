import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import type { InferenceInitData } from '../protocol'
import type { EmbeddingHandlers } from './inferenceEntryHarness'
import { loadInferenceEntries } from './inferenceEntryHarness'

/**
 * Covers both embedding ONNX output shapes sharing this runtime through a
 * single tokenize + single model forward per text:
 * - Qwen3-Embedding returns per-token `last_hidden_state` ([1, seq, hidden]);
 *   the handler takes the last token and L2-normalizes it.
 * - Harrier 270M's graph returns only `sentence_embedding` ([1, 640]); the
 *   handler consumes the pooled output directly. Transformers.js 4.2.0's
 *   feature-extraction pipeline ignores that output (resolves to `undefined`),
 *   so the handler never calls the pipeline — calling it first and then the
 *   model again would run Harrier inference twice per text.
 */

const QWEN_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  const extractor = async () => {
    globalThis.__cherryEmbeddingPipelineCalls = (globalThis.__cherryEmbeddingPipelineCalls ?? 0) + 1
    throw new Error('single-forward path must not call the feature-extraction pipeline')
  }
  extractor.tokenizer = Object.assign((text, opts) => ({ input_ids: [1], attention_mask: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.model = async (inputs) => {
    globalThis.__cherryEmbeddingModelCalls = (globalThis.__cherryEmbeddingModelCalls ?? 0) + 1
    return { last_hidden_state: { dims: [1, 2, 2], tolist: () => [[[1, 2], [3, 4]]] } }
  }
  extractor.dispose = async () => {}
  return extractor
}
module.exports = { env, pipeline }
`

const HARRIER_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  // The pipeline would ignore a graph returning only sentence_embedding, so
  // the handler tokenizes and invokes the model directly exactly once.
  const extractor = async () => {
    globalThis.__cherryEmbeddingPipelineCalls = (globalThis.__cherryEmbeddingPipelineCalls ?? 0) + 1
    throw new Error('single-forward path must not call the feature-extraction pipeline')
  }
  const tokenizer = Object.assign((text, opts) => ({ input_ids: [1], attention_mask: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.tokenizer = tokenizer
  extractor.model = async (inputs) => {
    globalThis.__cherryEmbeddingModelCalls = (globalThis.__cherryEmbeddingModelCalls ?? 0) + 1
    return {
      sentence_embedding: { dims: [1, 2], tolist: () => [[3, 4]] }
    }
  }
  extractor.dispose = async () => {}
  return extractor
}
module.exports = { env, pipeline }
`

const POOLER_OUTPUT_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  const extractor = async () => {
    globalThis.__cherryEmbeddingPipelineCalls = (globalThis.__cherryEmbeddingPipelineCalls ?? 0) + 1
    throw new Error('single-forward path must not call the feature-extraction pipeline')
  }
  extractor.tokenizer = Object.assign((text, opts) => ({ input_ids: [1], attention_mask: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.model = async (inputs) => {
    globalThis.__cherryEmbeddingModelCalls = (globalThis.__cherryEmbeddingModelCalls ?? 0) + 1
    return { pooler_output: { dims: [1, 2], tolist: () => [[3, 4]] } }
  }
  extractor.dispose = async () => {}
  return extractor
}
module.exports = { env, pipeline }
`

const UNSUPPORTED_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  const extractor = async () => {
    throw new Error('single-forward path must not call the feature-extraction pipeline')
  }
  extractor.tokenizer = Object.assign((text, opts) => ({ input_ids: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.model = async (inputs) => ({})
  extractor.dispose = async () => {}
  return extractor
}
module.exports = { env, pipeline }
`

let appPath: string
let embedding: EmbeddingHandlers

async function seedTransformersFake(root: string, source: string): Promise<void> {
  const dir = path.join(root, 'node_modules', '@huggingface', 'transformers')
  await mkdir(dir, { recursive: true })
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: '@huggingface/transformers', main: 'index.cjs' })
  )
  await writeFile(path.join(dir, 'index.cjs'), source)
}

async function startWithFake(source: string): Promise<void> {
  vi.resetModules()
  appPath = await mkdtemp(path.join(tmpdir(), 'cherry-inference-embedding-'))
  await seedTransformersFake(appPath, source)
  ;(globalThis as Record<string, unknown>).__cherryEmbeddingPipelineCalls = 0
  ;(globalThis as Record<string, unknown>).__cherryEmbeddingModelCalls = 0
  const initData: InferenceInitData = {
    appPath,
    artifactPaths: {},
    runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
  }
  const loaded = await loadInferenceEntries(initData)
  embedding = loaded.embedding
}

function forwardCounts(): { pipelineCalls: number; modelCalls: number } {
  const globals = globalThis as Record<string, unknown>
  return {
    pipelineCalls: (globals.__cherryEmbeddingPipelineCalls as number) ?? 0,
    modelCalls: (globals.__cherryEmbeddingModelCalls as number) ?? 0
  }
}

afterEach(async () => {
  vi.resetModules()
  if (appPath) await rm(appPath, { recursive: true, force: true })
})

describe('inference entry embedding pooling', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('keeps the Qwen last-token pooling path', async () => {
    await startWithFake(QWEN_FAKE)
    // tokens [[1,2],[3,4]] -> last token [3,4] -> L2-normalized [0.6,0.8]
    await expect(embedding.embed({ modelDir: '/qwen', dtype: 'q8', texts: ['hello', 'world'] })).resolves.toEqual([
      [0.6, 0.8],
      [0.6, 0.8]
    ])
    // One tokenize + one model forward per text; the pipeline itself is never invoked.
    expect(forwardCounts()).toEqual({ pipelineCalls: 0, modelCalls: 2 })
  })

  it('consumes Harrier sentence_embedding with a single forward per text', async () => {
    await startWithFake(HARRIER_FAKE)
    // sentence_embedding [3,4] is already pooled; handler L2-normalizes to [0.6,0.8]
    await expect(embedding.embed({ modelDir: '/harrier', dtype: 'q8', texts: ['hello', 'world'] })).resolves.toEqual([
      [0.6, 0.8],
      [0.6, 0.8]
    ])
    expect(forwardCounts()).toEqual({ pipelineCalls: 0, modelCalls: 2 })
  })

  it('falls back to pooler_output when sentence_embedding is absent', async () => {
    await startWithFake(POOLER_OUTPUT_FAKE)
    await expect(embedding.embed({ modelDir: '/harrier', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([
      [0.6, 0.8]
    ])
    expect(forwardCounts()).toEqual({ pipelineCalls: 0, modelCalls: 1 })
  })

  it('rejects models with neither token nor pooled outputs', async () => {
    await startWithFake(UNSUPPORTED_FAKE)
    await expect(embedding.embed({ modelDir: '/bogus', dtype: 'q8', texts: ['hello'] })).rejects.toThrow(
      /unsupported output/
    )
  })
})
