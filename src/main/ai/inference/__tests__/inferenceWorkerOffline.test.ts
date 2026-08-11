import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Worker } from 'node:worker_threads'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'
import type { InferenceModelSource, InferenceResponse } from '../inferenceProtocol'
import { inferenceWorkerSource } from '../inferenceWorkerSource'

/**
 * These run the production worker source against the REAL `@huggingface/transformers`,
 * because the bug they guard lives in that dependency: 4.2.0 drops `revision` and
 * `local_files_only` before its file-discovery stage (`get_pipeline_files` ->
 * `get_files` -> `get_config` / `get_tokenizer_files`), which made a ModelScope-only
 * cache — written under a `master/` segment, but looked up as if it were `main` — go to
 * the network and fail offline. A hand-written fake `pipeline` cannot catch that: it
 * would only prove we passed the options, not that they were honoured.
 *
 * The worker's model id is an absolute path, so transformers.js classifies it via
 * `isValidHfModelId` as "not a repo id" and every remote branch in its resolver becomes
 * unreachable. The assertion below is therefore structural: with the network fully
 * blocked, discovery must still resolve the cached files.
 */

const MODEL_REPO = 'test-org/test-embedding'
const MODELSCOPE_SOURCE: InferenceModelSource = {
  remoteHost: 'https://www.modelscope.cn',
  remotePathTemplate: 'models/{model}/resolve/{revision}',
  revision: 'master'
}

/** Marks any network attempt so a failure can be attributed to it rather than to ONNX. */
const NETWORK_TRIPWIRE = 'CHERRY_TEST_NETWORK_BLOCKED'

let appPath: string
let cacheDir: string
let worker: Worker
let workerMessages: InferenceResponse[]

/** Minimal but structurally valid tokenizer — the real 11MB one cannot live in the repo. */
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

/**
 * Seed only the ModelScope layout: `<repo>/master/<file>`. The `main`-revision paths
 * (`<repo>/<file>`) are deliberately absent — that mismatch is exactly what used to send
 * discovery to the network.
 */
async function seedModelScopeCache(): Promise<string> {
  const modelDir = path.join(cacheDir, ...MODEL_REPO.split('/'), MODELSCOPE_SOURCE.revision)
  await mkdir(path.join(modelDir, 'onnx'), { recursive: true })
  await writeFile(path.join(modelDir, 'config.json'), CONFIG_JSON)
  await writeFile(path.join(modelDir, 'tokenizer.json'), TOKENIZER_JSON)
  await writeFile(path.join(modelDir, 'tokenizer_config.json'), TOKENIZER_CONFIG_JSON)
  // Weight bytes are never valid ONNX: these tests stop at file discovery, which is where
  // the regression lives. Shipping a real model would mean a 600MB fixture.
  await writeFile(path.join(modelDir, 'onnx', 'model_quantized.onnx'), Buffer.from([0, 1, 2, 3]))
  return modelDir
}

async function request(message: Record<string, unknown>): Promise<InferenceResponse> {
  const id = String(message.id)
  return await new Promise((resolve, reject) => {
    const onMessage = (response: InferenceResponse) => {
      if ('id' in response && response.id === id) {
        worker.off('error', reject)
        worker.off('message', onMessage)
        resolve(response)
      }
    }
    worker.on('error', reject)
    worker.on('message', onMessage)
    worker.postMessage(message)
  })
}

/**
 * Spawn the worker with the network cut off at the undici dispatcher, i.e. below
 * transformers.js's `env.fetch`. Any request — including the Range probes discovery uses
 * for `tokenizer_config.json` — throws a tagged error we can look for.
 */
function startWorker(): Worker {
  const spawned = new Worker(
    `
    const { Dispatcher, setGlobalDispatcher } = require('undici')
    class BlockedDispatcher extends Dispatcher {
      dispatch() { throw new Error(${JSON.stringify(NETWORK_TRIPWIRE)}) }
    }
    setGlobalDispatcher(new BlockedDispatcher())
    ${inferenceWorkerSource}
    `,
    {
      eval: true,
      env: { ...process.env, HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '' }
    }
  )
  workerMessages = []
  spawned.on('message', (message: InferenceResponse) => workerMessages.push(message))
  spawned.postMessage({
    type: 'init',
    appPath,
    cacheDir,
    onnxRuntimeBindingPath: '',
    runtimeProfile: CPU_LOCAL_INFERENCE_PROFILE,
    proxyRouting: { version: 0, mode: 'direct' }
  })
  return spawned
}

function workerLog(): string {
  return workerMessages
    .filter((message) => message.type === 'log')
    .map((message) => (message as { message: string }).message)
    .join('\n')
}

beforeEach(async () => {
  // The worker resolves @huggingface/transformers off appPath, so point it at the repo
  // root to load the real, version-pinned dependency.
  appPath = process.cwd()
  cacheDir = await mkdtemp(path.join(tmpdir(), 'cherry-inference-cache-'))
  worker = startWorker()
})

afterEach(async () => {
  await worker.terminate()
  await rm(cacheDir, { recursive: true, force: true })
})

describe('inference worker offline embedding', () => {
  it('resolves a ModelScope-revision cache with no network access', async () => {
    const modelDir = await seedModelScopeCache()

    const response = await request({
      type: 'embedding.embed',
      id: 'embed',
      modelDir,
      dtype: 'q8',
      texts: ['hello world']
    })

    // The stub weights cannot produce vectors, so this fails inside onnxruntime — the
    // point is WHERE it fails. Reaching the ONNX session means discovery found
    // config.json, tokenizer.json and tokenizer_config.json under `master/` without a
    // single request, which is what the old repo-id + revision path could not do.
    expect(response.type).toBe('error')
    expect(JSON.stringify(response)).not.toContain(NETWORK_TRIPWIRE)
    expect(workerLog()).not.toContain(NETWORK_TRIPWIRE)
  })

  it('fails without touching the network when the cache is missing entirely', async () => {
    const response = await request({
      type: 'embedding.embed',
      id: 'missing',
      modelDir: path.join(cacheDir, 'never', 'downloaded'),
      dtype: 'q8',
      texts: ['hello world']
    })

    // An absolute model id makes transformers.js reject the id before any request, so a
    // missing cache surfaces as a local-file error rather than a connection timeout —
    // which is what an unreachable proxy would otherwise turn this into.
    expect(response.type).toBe('error')
    expect(JSON.stringify(response)).not.toContain(NETWORK_TRIPWIRE)
  })

  it('reloads from disk after the worker is recycled', async () => {
    const modelDir = await seedModelScopeCache()
    await request({ type: 'embedding.embed', id: 'first', modelDir, dtype: 'q8', texts: ['hello'] })

    // Idle release / a proxy change terminates the worker, dropping the in-memory
    // pipeline. The rebuilt worker must still resolve everything locally — relying on
    // that cached instance is what used to mask the offline failure.
    await worker.terminate()
    worker = startWorker()

    const response = await request({
      type: 'embedding.countTokens',
      id: 'after-restart',
      modelDir,
      dtype: 'q8',
      texts: ['hello']
    })

    expect(response.type).toBe('error')
    expect(JSON.stringify(response)).not.toContain(NETWORK_TRIPWIRE)
    expect(workerLog()).not.toContain(NETWORK_TRIPWIRE)
  })
})
