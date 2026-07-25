import { configureInferenceWorkerProxy } from './inferenceWorkerProxy'
import { l2normalize } from './pooling'

/**
 * Inference worker, shipped as an eval'd `worker_threads` source string.
 *
 * Why a string and not a file entry: electron-vite builds the main process as a
 * single bundle (`inlineDynamicImports: true`), which Rollup forbids combining
 * with multiple inputs — so we cannot emit a separate worker chunk. The existing
 * tool-exec worker uses the same string approach. When this host moves to an
 * Electron `utilityProcess` (for crash isolation), extract this source into its
 * own file unchanged — the message protocol and `InferenceServiceBase` API do not move.
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
const pipelines = new Map() // key: repo|dtype|host -> Promise<extractor>
const paddleServices = new Map() // key: det|rec|dict -> Promise<PaddleOcrService>

// Injected from pooling.ts (single, unit-tested source). Bound to a const so the
// call site works even if the bundler renames the function's own symbol.
const l2normalize = ${l2normalize.toString()}
const configureInferenceWorkerProxy = ${configureInferenceWorkerProxy.toString()}

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
  if (msg.source && typeof msg.source.remoteHost === 'string') {
    let source = '<invalid>'
    try {
      source = new URL(msg.source.remoteHost).origin
    } catch {
      // Keep the invalid marker without echoing an untrusted URL into logs.
    }
    context.push('source=' + JSON.stringify(source))
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

function pipelineKey(repo, dtype, source) {
  return repo + '|' + dtype + '|' + source.remoteHost
}

function getPipeline(id, repo, dtype, source, withProgress) {
  const key = pipelineKey(repo, dtype, source)
  let promise = pipelines.get(key)
  if (!promise) {
    promise = (async () => {
      const { pipeline, env } = getTransformers()
      env.allowRemoteModels = true
      if (cacheDir) env.cacheDir = cacheDir
      env.remoteHost = source.remoteHost
      env.remotePathTemplate = source.remotePathTemplate
      const options = { dtype, device: 'cpu', revision: source.revision }
      if (withProgress) {
        options.progress_callback = (p) => {
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
      }
      return pipeline('feature-extraction', repo, options)
    })()
    pipelines.set(key, promise)
    // Drop the cached promise on failure so a later request can retry.
    promise.catch(() => pipelines.delete(key))
  }
  return promise
}

async function handleEmbed(msg) {
  const extractor = await getPipeline(msg.id, msg.modelRepo, msg.dtype, msg.source, false)
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
  await getPipeline(msg.id, msg.modelRepo, msg.dtype, msg.source, true)
  parentPort.postMessage({ type: 'result', id: msg.id, embeddings: null })
}

async function handleCountTokens(msg) {
  const extractor = await getPipeline(msg.id, msg.modelRepo, msg.dtype, msg.source, false)
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
      const service = new PaddleOcrService({
        model: {
          detection: modelPaths.detection,
          recognition: modelPaths.recognition,
          charactersDictionary: modelPaths.charactersDictionary
        },
        session: { executionProviders: ['cpu'] }
      })
      await service.initialize()
      return service
    })()
    paddleServices.set(key, promise)
    // Drop the cached promise on failure so a later request can retry.
    promise.catch(() => paddleServices.delete(key))
  }
  return promise
}

async function handleOcr(msg) {
  const fs = require('node:fs')
  const service = await getPaddleService(msg.modelPaths)
  const buffer = fs.readFileSync(msg.imagePath)
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
  const result = await service.recognize(arrayBuffer)
  parentPort.postMessage({ type: 'result', id: msg.id, text: result.text })
}

parentPort.on('message', (msg) => {
  if (!msg || typeof msg !== 'object') return
  if (msg.type === 'init') {
    cacheDir = msg.cacheDir
    appPath = msg.appPath
    const proxy = configureInferenceWorkerProxy(appPath)
    proxyStatus = proxy.status
    if (proxy.status === 'configured') {
      postLog(
        'info',
        'network proxy configured origins=' +
          proxy.proxyOrigins.join(',') +
          ' bypassRules=' +
          (proxy.bypassRulesConfigured ? 'configured' : 'none')
      )
    } else if (proxy.status === 'direct') {
      postLog('info', 'network proxy not configured; remote model requests use a direct connection')
    } else if (proxy.status === 'unsupported') {
      postLog('warn', 'network proxy protocol is unsupported by the inference worker protocol=' + proxy.protocol)
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
  run(msg).catch((err) => {
    postLog('error', 'request failed ' + requestLogContext(msg) + ' error=' + describeError(err))
    parentPort.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) })
  })
})
`
