import { createProxyBypassMatcher } from '@main/services/proxy/bypassRules'
import { configureWorkerProxy } from '@main/services/proxy/workerProxy'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'

/**
 * The capability-agnostic half of the inference worker: init, logging, the package
 * resolvers, the hardware-fallback retry, and dispatch.
 *
 * It knows nothing about embedding or OCR. Each capability module (loaded after this one
 * into the same script scope) registers itself into `CAPABILITIES`, so adding one is a new
 * module rather than another branch in a shared dispatch chain.
 */
export const workerCoreSource = `
const { parentPort } = require('node:worker_threads')

let appPath = null
let transformers = null
let ppu = null
let proxyStatus = 'not-initialized'
const CPU_RUNTIME_PROFILE = ${JSON.stringify(CPU_LOCAL_INFERENCE_PROFILE)}
let runtimeProfile = CPU_RUNTIME_PROFILE

/**
 * request type -> { handle, prepare?, dispose? }, filled in by the capability modules.
 *   handle(msg, prepared)  answers the request; retried once on CPU if hardware fails
 *   prepare(msg)           request setup that must NOT be retried (e.g. reading a file)
 *   dispose()              release cached sessions when a hardware provider is abandoned
 */
const CAPABILITIES = {}

// Injected from services/proxy (a single, unit-tested source). Bound to consts so the call
// sites work even if the bundler renames the functions' own symbols.
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
  if (typeof msg.modelDir === 'string') context.push('modelDir=' + JSON.stringify(msg.modelDir))
  return context.join(' ')
}

/** Cache the loaded resource per key, dropping the promise on failure so a later request
 * can retry. Shared by the capability modules, which each own their own Map. */
function cachedResource(cache, key, load) {
  let promise = cache.get(key)
  if (!promise) {
    promise = load()
    cache.set(key, promise)
    promise.catch(() => cache.delete(key))
  }
  return promise
}

/** Dispose everything in a capability's cache, reporting failures without throwing —
 * a resource that will not release must not block the CPU retry that follows. */
async function disposeCached(cache) {
  const resources = [...cache.values()]
  cache.clear()
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

async function disposeCachedInference() {
  for (const capability of Object.values(CAPABILITIES)) {
    if (capability.dispose) await capability.dispose()
  }
}

async function runWithHardwareFallback(msg, capability) {
  // Request preparation is not a provider failure; keep it outside the retry so a bad
  // image path cannot be blamed on the hardware provider and retried on CPU.
  const prepared = capability.prepare ? await capability.prepare(msg) : undefined
  const run = () => capability.handle(msg, prepared)

  try {
    await run()
  } catch (hardwareError) {
    if (runtimeProfile.id === 'cpu') throw hardwareError

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
      await run()
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
    // ppu-paddle-ocr (getTransformers/getPpu), both of which transitively require
    // onnxruntime-node — see patches/onnxruntime-node@1.25.1.patch.
    if (msg.onnxRuntimeBindingPath) process.env.CHERRY_ONNXRUNTIME_BINDING_PATH = msg.onnxRuntimeBindingPath
    return
  }
  const capability = CAPABILITIES[msg.type]
  if (!capability) {
    parentPort.postMessage({ type: 'error', id: msg.id, message: 'unknown message type: ' + msg.type })
    return
  }
  runWithHardwareFallback(msg, capability).catch((err) => {
    postLog('error', 'request failed ' + requestLogContext(msg) + ' error=' + describeError(err))
    parentPort.postMessage({ type: 'error', id: msg.id, message: err && err.message ? err.message : String(err) })
  })
})
`
