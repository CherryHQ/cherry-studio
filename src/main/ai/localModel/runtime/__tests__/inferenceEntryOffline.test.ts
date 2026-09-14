import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import type { EmbeddingHandlers } from './inferenceEntryHarness'
import { loadInferenceEntries } from './inferenceEntryHarness'

/**
 * These run the production embedding handlers against the real transformers package.
 * Absolute model paths must keep discovery offline, including legacy ModelScope installs
 * nested below a `master` directory.
 */
const MODEL_REPO = 'test-org/test-embedding'
const MODELSCOPE_REVISION = 'master'
const NETWORK_TRIPWIRE = 'CHERRY_TEST_NETWORK_BLOCKED'

class BlockedDispatcher extends Dispatcher {
  override dispatch(): boolean {
    throw new Error(NETWORK_TRIPWIRE)
  }
}

let cacheDir: string
let embedding: EmbeddingHandlers
let logs: string[]
let previousDispatcher: Dispatcher

const TOKENIZER_JSON = JSON.stringify({
  version: '1.0',
  truncation: null,
  padding: null,
  added_tokens: [],
  normalizer: null,
  pre_tokenizer: { type: 'WhitespaceSplit' },
  post_processor: null,
  decoder: null,
  model: {
    type: 'WordLevel',
    vocab: { '[UNK]': 0, hello: 1, world: 2 },
    unk_token: '[UNK]'
  }
})

const TOKENIZER_CONFIG_JSON = JSON.stringify({
  tokenizer_class: 'PreTrainedTokenizer',
  unk_token: '[UNK]',
  model_max_length: 512
})

const CONFIG_JSON = JSON.stringify({
  model_type: 'bert',
  hidden_size: 8,
  num_attention_heads: 1,
  num_hidden_layers: 1,
  vocab_size: 3
})

async function seedModelScopeCache(): Promise<string> {
  const modelDir = path.join(cacheDir, ...MODEL_REPO.split('/'), MODELSCOPE_REVISION)
  await mkdir(path.join(modelDir, 'onnx'), { recursive: true })
  await writeFile(path.join(modelDir, 'config.json'), CONFIG_JSON)
  await writeFile(path.join(modelDir, 'tokenizer.json'), TOKENIZER_JSON)
  await writeFile(path.join(modelDir, 'tokenizer_config.json'), TOKENIZER_CONFIG_JSON)
  await writeFile(path.join(modelDir, 'onnx', 'model_quantized.onnx'), Buffer.from([0, 1, 2, 3]))
  return modelDir
}

async function failureOf(operation: Promise<unknown>): Promise<string> {
  try {
    await operation
    return 'unexpectedly succeeded'
  } catch (error) {
    return String(error)
  }
}

async function startProcess(): Promise<void> {
  const loaded = await loadInferenceEntries({
    appPath: process.cwd(),
    artifactPaths: {},
    runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE
  })
  embedding = loaded.embedding
  logs = loaded.logs
}

beforeAll(() => {
  previousDispatcher = getGlobalDispatcher()
  setGlobalDispatcher(new BlockedDispatcher())
})

afterAll(() => {
  setGlobalDispatcher(previousDispatcher)
})

beforeEach(async () => {
  cacheDir = await mkdtemp(path.join(tmpdir(), 'cherry-inference-cache-'))
  await startProcess()
})

afterEach(async () => {
  await rm(cacheDir, { recursive: true, force: true })
})

describe('inference entry offline embedding', () => {
  it('resolves a ModelScope-revision cache with no network access', async () => {
    const modelDir = await seedModelScopeCache()

    const failure = await failureOf(embedding.embed({ modelDir, dtype: 'q8', texts: ['hello world'] }))

    expect(failure).toContain(path.join(modelDir, 'onnx', 'model_quantized.onnx'))
    expect(failure).not.toContain(NETWORK_TRIPWIRE)
    expect(logs.join('\n')).not.toContain(NETWORK_TRIPWIRE)
  })

  it('fails without touching the network when the cache is missing entirely', async () => {
    const failure = await failureOf(
      embedding.embed({ modelDir: path.join(cacheDir, 'never', 'downloaded'), dtype: 'q8', texts: ['hello world'] })
    )

    expect(failure).not.toBe('unexpectedly succeeded')
    expect(failure).not.toContain(NETWORK_TRIPWIRE)
  })

  it('reloads from disk after the process is recycled', async () => {
    const modelDir = await seedModelScopeCache()
    await embedding.embed({ modelDir, dtype: 'q8', texts: ['hello'] }).catch(() => {})

    await startProcess()

    const failure = await failureOf(embedding.countTokens({ modelDir, dtype: 'q8', texts: ['hello'] }))

    expect(failure).toContain(path.join(modelDir, 'onnx', 'model_quantized.onnx'))
    expect(failure).not.toContain(NETWORK_TRIPWIRE)
    expect(logs.join('\n')).not.toContain(NETWORK_TRIPWIRE)
  })
})
