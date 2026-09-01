import { createProxyBypassMatcher } from '@main/services/proxy/bypassRules'
import { configureWorkerProxy } from '@main/services/proxy/workerProxy'

import { CPU_LOCAL_INFERENCE_PROFILE } from '../inferenceAcceleration'

/**
 * The capability-agnostic half of the inference worker: init, logging,
 * hardware-fallback retry, and dispatch.
 *
 * It knows nothing about a concrete runtime, embedding or OCR. The runtime and capability
 * modules loaded after this core register their initialization and request handlers.
 */
export const workerCoreSource = `
const { parentPort } = require('node:worker_threads')

let appPath = null
let workerCapability = null
let proxyStatus = 'not-initialized'
const CPU_RUNTIME_PROFILE = ${JSON.stringify(CPU_LOCAL_INFERENCE_PROFILE)}
let runtimeProfile = CPU_RUNTIME_PROFILE

/**
 * request type -> { handle, prepare?, dispose? }, filled in by the capability modules.
 *   handle(msg, prepared)  answers the request; retried once on CPU if hardware fails
 *   prepare(msg)           request setup that must NOT be retried (e.g. reading a file)
 *   dispose()              release cached sessions when a hardware provider is abandoned
 */
const REQUEST_HANDLERS = {}
const RUNTIME_INITIALIZERS = []

// Injected from services/proxy (a single, unit-tested source). Bound to consts so the call
// sites work even if the bundler renames the functions' own symbols.
const createProxyBypassMatcher = ${createProxyBypassMatcher.toString()}
const configureWorkerProxy = ${configureWorkerProxy.toString()}

function postLog(level, message) {
  parentPort.postMessage({ kind: 'log', level, message })
}

function postResult(msg, payload) {
  parentPort.postMessage({ kind: 'result', requestId: msg.requestId, payload })
}

function postError(requestId, message) {
  parentPort.postMessage({ kind: 'error', requestId, message })
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
  const context = ['capability=' + msg.capability, 'request=' + msg.type, 'proxy=' + proxyStatus]
  if (msg.payload && typeof msg.payload.modelDir === 'string') {
    context.push('modelDir=' + JSON.stringify(msg.payload.modelDir))
  }
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

async function disposeCachedInference() {
  for (const handler of Object.values(REQUEST_HANDLERS)) {
    if (handler.dispose) await handler.dispose()
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
  if (msg.kind === 'init') {
    appPath = msg.appPath
    workerCapability = msg.capability
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
    for (const initialize of RUNTIME_INITIALIZERS) initialize(msg)
    return
  }
  if (msg.kind !== 'request') return
  if (msg.capability !== workerCapability) {
    postError(msg.requestId, 'worker capability mismatch: expected ' + workerCapability + ', received ' + msg.capability)
    return
  }
  const handler = REQUEST_HANDLERS[msg.type]
  if (!handler) {
    postError(msg.requestId, 'unknown request type: ' + msg.type)
    return
  }
  runWithHardwareFallback(msg, handler).catch((err) => {
    postLog('error', 'request failed ' + requestLogContext(msg) + ' error=' + describeError(err))
    postError(msg.requestId, err && err.message ? err.message : String(err))
  })
})
`
