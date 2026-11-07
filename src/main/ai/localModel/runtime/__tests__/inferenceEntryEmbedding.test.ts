import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { InferenceInitData } from '../inferenceAcceleration'
import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import type { EmbeddingHandlers } from './inferenceEntryHarness'
import { loadInferenceEntries } from './inferenceEntryHarness'

/**
 * Covers both embedding ONNX output shapes sharing this runtime:
 * - Qwen3-Embedding returns per-token `last_hidden_state` ([1, seq, hidden]);
 *   the handler takes the last token and L2-normalizes it.
 * - Harrier 270M's graph returns only `sentence_embedding` ([1, 640]), which
 *   Transformers.js 4.2.0's feature-extraction pipeline ignores (resolves to
 *   `undefined`); the handler then runs the cached model directly and consumes
 *   the pooled output.
 */

const QWEN_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  const extractor = async () => ({ dims: [1, 2, 2], tolist: () => [[[1, 2], [3, 4]]] })
  extractor.tokenizer = Object.assign((text, opts) => ({ input_ids: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.model = async () => {
    throw new Error('Qwen path must not reach the direct model fallback')
  }
  extractor.dispose = async () => {}
  return extractor
}
module.exports = { env, pipeline }
`

const HARRIER_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  // Transformers.js 4.2.0 only forwards last_hidden_state/logits/token_embeddings,
  // so a graph returning only sentence_embedding resolves to undefined.
  const extractor = async () => undefined
  const tokenizer = Object.assign((text, opts) => ({ input_ids: [1], attention_mask: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.tokenizer = tokenizer
  extractor.model = async (inputs) => ({
    sentence_embedding: { dims: [1, 2], tolist: () => [[3, 4]] }
  })
  extractor.dispose = async () => {}
  return extractor
}
module.exports = { env, pipeline }
`

const HARRIER_POOLED_2D_FAKE = String.raw`
const env = {}
async function pipeline(_task, model, options = {}) {
  // A future pipeline that forwards the pooled output directly as a 2D tensor.
  const extractor = async () => ({ dims: [1, 2], tolist: () => [[3, 4]] })
  extractor.tokenizer = Object.assign((text, opts) => ({ input_ids: [1] }), {
    encode: (text) => Array.from(String(text))
  })
  extractor.model = async () => {
    throw new Error('pooled 2D path must not reach the direct model fallback')
  }
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
  const initData: InferenceInitData = {
    appPath,
    artifactPaths: {},
    runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
  }
  const loaded = await loadInferenceEntries(initData)
  embedding = loaded.embedding
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
    await expect(embedding.embed({ modelDir: '/qwen', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([[0.6, 0.8]])
  })

  it('consumes Harrier sentence_embedding via the direct model fallback', async () => {
    await startWithFake(HARRIER_FAKE)
    // sentence_embedding [3,4] is already pooled; handler L2-normalizes to [0.6,0.8]
    await expect(embedding.embed({ modelDir: '/harrier', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([
      [0.6, 0.8]
    ])
  })

  it('accepts an already-pooled 2D pipeline tensor without the model fallback', async () => {
    await startWithFake(HARRIER_POOLED_2D_FAKE)
    await expect(embedding.embed({ modelDir: '/harrier', dtype: 'q8', texts: ['hello'] })).resolves.toEqual([
      [0.6, 0.8]
    ])
  })
})
