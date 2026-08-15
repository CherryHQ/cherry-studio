import { createProxyBypassMatcher } from '@main/services/proxy/bypassRules'
import { configureWorkerProxy } from '@main/services/proxy/workerProxy'

import { CPU_LOCAL_INFERENCE_PROFILE } from './inferenceAcceleration'
import { l2normalize } from './pooling'

/**
 * Inference worker, shipped as an eval'd `worker_threads` source string.
 *
 * Why a string and not a file entry: electron-vite builds the main process as a
 * single bundle (`inlineDynamicImports: true`), which Rollup forbids combining
 * with multiple inputs — so we cannot emit a separate worker chunk. The existing
 * tool-exec worker uses the same string approach. When this host moves to an
 * Electron `utilityProcess` (for crash isolation), extract this source into its
 * own file unchanged — the message protocol and `InferenceServiceBase` API do not
 * move, and the proxy installer already lives in `@main/services/proxy/workerProxy`
 * so the utilityProcess entry imports it directly instead of baking it in.
 *
 * The worker only `require`s external packages (resolved from node_modules at
 * runtime, since they are externalized from the bundle) and Node built-ins; it
 * never imports project modules. Pooling math therefore can't be imported at
 * runtime, so `pooling.ts`'s unit-tested `l2normalize` is baked into the source
 * string below via `.toString()` at build time — one source, so it can't drift.
 *
 * TODO(packaged): the worker resolves `@huggingface/transformers` and
 * `ppu-paddle-ocr` off `app.root`; verify both resolve once the packaged-app build
 * is exercised. The onnxruntime-node native binding is downloaded on demand (not
 * bundled/asarUnpack'd) — see OnnxRuntimeBinaryService.
 */
export const inferenceWorkerSource = `
const { parentPort } = require('node:worker_threads')

let cacheDir = null
let appPath = null
let transformers = null
let ppu = null
let proxyStatus = 'not-initialized'
const CPU_RUNTIME_PROFILE = ${JSON.stringify(CPU_LOCAL_INFERENCE_PROFILE)}
let runtimeProfile = CPU_RUNTIME_PROFILE
const pipelines = new Map() // key: modelDir|dtype -> Promise<extractor>
const paddleServices = new Map() // key: det|rec|dict -> Promise<PaddleOcrService>

// Injected from pooling.ts and services/proxy (single, unit-tested sources). Bound to
// consts so the call sites work even if the bundler renames the functions' own symbols.
const l2normalize = ${l2normalize.toString()}
const createProxyBypassMatcher = ${createProxyBypassMatcher.toString()}
const configureWorkerProxy = ${configureWorkerProxy.toString()}

function postLog(level, message) {
  parentPort.postMessage({ type: 'log', level, message })
}

function describeError(error) {
  const details = []
  const seen = new Set()
  let current = error
  while (current && details.length < 4) {
    if (typeof current === 'object') {
      if (seen.has(current)) break
      seen.add(current)
    }
    const name = current && current.name ? current.name : 'Error'
    const message = current && current.message ? current.message : String(current)
    const code = current && current.code ? ' code=' + current.code : ''
    details.push(name + code + ': ' + message)
    current = current && typeof current === 'object' ? current.cause : null
  }
  return details.join(' <- caused by ')
}

function requestLogContext(msg) {
  const context = ['request=' + msg.type, 'proxy=' + proxyStatus]
  if (typeof msg.modelRepo === 'string') context.push('model=' + JSON.stringify(msg.modelRepo))
  if (typeof msg.modelDir === 'string') context.push('modelDir=' + JSON.stringify(msg.modelDir))
  if (msg.source) {
    let origin
    try {
      origin = new URL(msg.source.remoteHost).origin
    } catch {
      // Keep the invalid marker without echoing an untrusted URL into logs.
      origin = '<invalid>'
    }
    context.push('source=' + JSON.stringify(origin))
  }
  return context.join(' ')
}

function getTransformers() {
  if (!transformers) {
    // Resolve from the app root rather than the worker's cwd, so it works both
    // in dev (project root) and in the packaged app (app.asar).
    const { createRequire } = require('node:module')
    const projectRequire = createRequire((appPath || process.cwd()) + '/')
    transformers = projectRequire('@huggingface/transformers')
  }
  return transformers
}

async function getPpu() {
  if (!ppu) {
    // ppu-paddle-ocr is pure ESM. Resolve its entry off app.root (dev + packaged),
    // then load it with a dynamic import so this works regardless of the host
    // Node's require(esm) support.
    const { createRequire } = require('node:module')
    const { pathToFileURL } = require('node:url')
    const projectRequire = createRequire((appPath || process.cwd()) + '/')
    const entry = projectRequire.resolve('ppu-paddle-ocr')
    ppu = await import(pathToFileURL(entry).href)
  }
  return ppu
}

/**
 * Load the cached model straight off disk. The model id is an absolute directory, which
 * transformers.js rejects as a repo id (isValidHfModelId) — and every remote branch in its
 * resolver is gated on that check, so file discovery cannot reach the network no matter
 * what \`revision\`/\`local_files_only\` its internal stages default to. That matters because
 * 4.2.0 drops both options before discovery (get_pipeline_files -> get_files -> get_config /
 * get_tokenizer_files), which is what made a ModelScope-only cache unusable offline.
 */
function getLocalPipeline(modelDir, dtype) {
  const key = modelDir + '|' + dtype
  let promise = pipelines.get(key)
  if (!promise) {
    promise = (async () => {
      const { pipeline, env } = getTransformers()
      // Leave env.remoteHost/remotePathTemplate untouched: an absolute model id never
      // consults them, and clearing them would race the download path sharing this env.
      if (cacheDir) env.cacheDir = cacheDir
      const extractor = await pipeline('feature-extraction', modelDir, {
        dtype,
        device: runtimeProfile.transformersDevice,
        session_options: runtimeProfile.embeddingSessionOptions || runtimeProfile.sessionOptions
      })
      if (runtimeProfile.id !== 'cpu') {
        postLog('info', 'hardware provider active provider=' + runtimeProfile.id + ' runtime=embedding')
      }
      return extractor
    })()
    pipelines.set(key, promise)
    // Drop the cached promise on failure so a later request can retry.
    promise.catch(() => pipelines.delete(key))
  }
  return promise
}

/**
 * Download the model into the transformers.js cache. Unlike inference this needs a repo id
 * and the mirror env, and the resulting pipeline is discarded: inference reloads by
 * absolute path, so keeping this instance would pin ~600MB for nothing.
 */
async function downloadPipeline(id, repo, dtype, source) {
  const { pipeline, env } = getTransformers()
  env.allowRemoteModels = true
  if (cacheDir) env.cacheDir = cacheDir
  env.remoteHost = source.remoteHost
  env.remotePathTemplate = source.remotePathTemplate
  await pipeline('feature-extraction', repo, {
    dtype,
    device: 'cpu',
    revision: source.revision,
    progress_callback: (p) => {
      parentPort.postMessage({
        type: 'progress',
        id,
        status: p.status,
        file: p.file,
        loaded: p.loaded,
        total: p.total,
        progress: p.progress
      })
    }
  })
}

async function handleEmbed(msg) {
  const extractor = await getLocalPipeline(msg.modelDir, msg.dtype)
  const vectors = []
  for (const text of msg.texts) {
    // pooling:'none' -> tensor of shape [batch=1, sequence, hidden].
    const output = await extractor(text, { pooling: 'none', normalize: false })
    const seq = output.dims[1]
    const tokens = output.tolist()[0]
    vectors.push(l2normalize(tokens[seq - 1]))
  }
  parentPort.postMessage({ type: 'result', id: msg.id, embeddings: vectors })
}

async function handleLoad(msg) {
  await downloadPipeline(msg.id, msg.modelRepo, msg.dtype, msg.source)
  parentPort.postMessage({ type: 'result', id: msg.id, embeddings: null })
}

async function handleCountTokens(msg) {
  const extractor = await getLocalPipeline(msg.modelDir, msg.dtype)
  const tokenCounts = msg.texts.map((text) => extractor.tokenizer.encode(text, { add_special_tokens: true }).length)
  parentPort.postMessage({ type: 'result', id: msg.id, tokenCounts })
}

function ocrKey(paths) {
  return paths.detection + '|' + paths.recognition + '|' + paths.charactersDictionary
}

function getPaddleService(modelPaths) {
  const key = ocrKey(modelPaths)
  let promise = paddleServices.get(key)
  if (!promise) {
    promise = (async () => {
      const { PaddleOcrService } = await getPpu()
      let sessionFallbackError = null
      const service = new PaddleOcrService({
        model: {
          detection: modelPaths.detection,
          recognition: modelPaths.recognition,
          charactersDictionary: modelPaths.charactersDictionary
        },
        session: {
          ...runtimeProfile.sessionOptions,
          onSessionFallback: (error) => {
            sessionFallbackError = sessionFallbackError || error
          }
        }
      })
      await service.initialize()
      if (sessionFallbackError) {
        try {
          await service.destroy()
        } catch (error) {
          postLog('warn', 'failed to dispose internally-fallen-back OCR service error=' + describeError(error))
        }
        throw new Error('OCR hardware session fell back internally to CPU', { cause: sessionFallbackError })
      }
      if (runtimeProfile.id !== 'cpu') {
        postLog('info', 'hardware provider active provider=' + runtimeProfile.id + ' runtime=ocr')
      }
      return service
    })()
    paddleServices.set(key, promise)
    // Drop the cached promise on failure so a later request can retry.
    promise.catch(() => paddleServices.delete(key))
  }
  return promise
}

async function handleOcr(msg, buffer) {
  const service = await getPaddleService(msg.modelPaths)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const result = await service.recognize(arrayBuffer)
  parentPort.postMessage({ type: 'result', id: msg.id, text: result.text })
}

async function disposeCachedInference() {
  const resources = [...pipelines.values(), ...paddleServices.values()]
  pipelines.clear()
  paddleServices.clear()
  const results = await Promise.allSettled(
    resources.map(async (resourcePromise) => {
      const resource = await resourcePromise
      const dispose = typeof resource.dispose === 'function' ? resource.dispose : resource.destroy
      if (typeof dispose === 'function') await dispose.call(resource)
    })
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      postLog('warn', 'failed to dispose cached inference resource error=' + describeError(result.reason))
    }
  }
}

async function runWithHardwareFallback(msg, run) {
  if (msg.type === 'ocr.recognize') {
    // File access is request preparation, not a provider failure; keep it outside fallback.
    const fs = require('node:fs')
    const buffer = fs.readFileSync(msg.imagePath)
    run = () => handleOcr(msg, buffer)
  }

  try {
    await run(msg)
  } catch (hardwareError) {
    // Downloads already run on CPU, so their failures cannot diagnose a hardware provider.
    if (msg.type === 'embedding.load' || runtimeProfile.id === 'cpu') throw hardwareError

    const provider = runtimeProfile.id
    postLog(
      'warn',
      'hardware inference failed provider=' +
        provider +
        ' ' +
        requestLogContext(msg) +
        ' error=' +
        describeError(hardwareError) +
        '; falling back to cpu'
    )
    await disposeCachedInference()
    // Keep CPU for this worker's lifetime so later cache misses do not retry a broken provider.
    runtimeProfile = CPU_RUNTIME_PROFILE

    try {
      await run(msg)
    } catch (cpuError) {
      throw new Error(
        'hardware inference failed provider=' +
          provider +
          ' error=' +
          describeError(hardwareError) +
          '; CPU fallback failed error=' +
          describeError(cpuError)
      )
    }
  }
}

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'init') {
    cacheDir = msg.cacheDir
    appPath = msg.appPath
    runtimeProfile = msg.runtimeProfile
    const proxy = configureWorkerProxy(appPath, msg.proxyRouting, createProxyBypassMatcher)
    proxyStatus = proxy.status
    if (proxy.status === 'configured') {
      postLog(
        'info',
        'network proxy configured origin=' + proxy.proxyOrigin + ' bypassRules=' + proxy.bypassRuleCount
      )
    } else if (proxy.status === 'direct') {
      postLog('info', 'network proxy not configured; remote model requests use a direct connection')
    } else {
      postLog('error', 'network proxy configuration failed: ' + proxy.error)
    }
    // Must be set before the first lazy require of @huggingface/transformers /
    // ppu-paddle-ocr below (getTransformers/getPpu), both of which transitively
    // require onnxruntime-node — see patches/onnxruntime-node@1.24.3.patch.
    if (msg.onnxRuntimeBindingPath) process.env.CHERRY_ONNXRUNTIME_BINDING_PATH = msg.onnxRuntimeBindingPath
    return
  }
  const run =
    msg.type === 'embedding.embed'
      ? handleEmbed
      : msg.type === 'embedding.load'
        ? handleLoad
        : msg.type === 'embedding.countTokens'
          ? handleCountTokens
          : msg.type === 'ocr.recognize'
            ? handleOcr
            : null
  if (!run) {
    parentPort.postMessage({ type: 'error', id: msg.id, message: 'unknown message type: ' + msg.type })
    return
  }
  runWithHardwareFallback(msg, run).catch((err) => {
    postLog('error', 'request failed ' + requestLogContext(msg) + ' error=' + describeError(err))
    parentPort.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) })
  })
})
`
