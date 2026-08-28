/**
 * Shared child-side runtime for both inference entries: package loading, the hardware
 * fallback policy, and error formatting.
 *
 * Child-safe — no lifecycle container, no logger, no database. Also no network: models are
 * loaded by absolute path and downloading stays in the main process, so this side needs no
 * proxy policy and must never be handed one. `@huggingface/transformers` and `ppu-paddle-ocr`
 * are resolved through `createRequire` off the app root (not a static import) so the bundler
 * leaves them alone and resolution matches the packaged app.
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

import { CPU_LOCAL_INFERENCE_PROFILE } from '@main/ai/localModel/runtime/inferenceAcceleration'
import type { InferenceInitData, LocalInferenceRuntimeProfile } from '@main/ai/localModel/runtime/protocol'
import type { UtilityProcessLogger } from '@main/core/utilityProcess/runtime/serveUtilityProcess'

type DisposableResource = { dispose?: () => unknown; destroy?: () => unknown }

let appPath: string | undefined
let runtimeProfile: LocalInferenceRuntimeProfile = CPU_LOCAL_INFERENCE_PROFILE
let transformers: any = null
let ppu: any = null
let sherpa: any = null

/** Cached heavyweight resources, keyed by whatever identifies the model. */
const cachedResources = new Map<string, Promise<DisposableResource>>()

export function currentRuntimeProfile(): LocalInferenceRuntimeProfile {
  return runtimeProfile
}

export function describeError(error: unknown): string {
  const details: string[] = []
  const seen = new Set<unknown>()
  let current: any = error
  while (current && details.length < 4) {
    if (typeof current === 'object') {
      if (seen.has(current)) break
      seen.add(current)
    }
    const name = current?.name ?? 'Error'
    const message = current?.message ?? String(current)
    const code = current?.code ? ` code=${current.code}` : ''
    details.push(`${name}${code}: ${message}`)
    current = typeof current === 'object' ? current.cause : null
  }
  return details.join(' <- caused by ')
}

/** Applies the connect-time init data: native binding path and hardware profile. */
export function applyInitData(initData: InferenceInitData): void {
  appPath = initData.appPath
  runtimeProfile = initData.runtimeProfile

  // Must be set before the first lazy require of @huggingface/transformers / ppu-paddle-ocr,
  // both of which transitively require onnxruntime-node — see patches/onnxruntime-node@1.25.1.patch.
  const onnxRuntimeBindingPath = initData.artifactPaths['onnxruntime-node']
  if (onnxRuntimeBindingPath) process.env.CHERRY_ONNXRUNTIME_BINDING_PATH = onnxRuntimeBindingPath
  const sherpaOnnxBindingPath = initData.artifactPaths['sherpa-onnx']
  if (sherpaOnnxBindingPath) process.env.CHERRY_SHERPA_ONNX_BINDING_PATH = sherpaOnnxBindingPath
}

/** Resolves off the app root, matching how the packaged app finds these packages. */
function projectRequire(): NodeRequire {
  return createRequire(`${appPath || process.cwd()}/`)
}

export function getTransformers(): any {
  transformers ??= projectRequire()('@huggingface/transformers')
  return transformers
}

export async function getPpu(): Promise<any> {
  if (!ppu) {
    // ppu-paddle-ocr is pure ESM: resolve its entry off the app root, then load it with a
    // dynamic import so this works regardless of the host Node's require(esm) support.
    ppu = await import(pathToFileURL(projectRequire().resolve('ppu-paddle-ocr')).href)
  }
  return ppu
}

export function getSherpa(): any {
  sherpa ??= projectRequire()('sherpa-onnx-node')
  return sherpa
}

/** Memoizes a loaded model, dropping the entry on failure so a later request can retry. */
export function cacheResource<T extends DisposableResource>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = cachedResources.get(key)
  if (existing !== undefined) return existing as Promise<T>
  const promise = load()
  cachedResources.set(key, promise)
  promise.catch(() => cachedResources.delete(key))
  return promise
}

export async function disposeCachedResources(logger: UtilityProcessLogger): Promise<void> {
  const resources = [...cachedResources.values()]
  cachedResources.clear()
  const results = await Promise.allSettled(
    resources.map(async (resourcePromise) => {
      const resource = await resourcePromise
      const dispose = resource.dispose ?? resource.destroy
      if (typeof dispose === 'function') await dispose.call(resource)
    })
  )
  for (const result of results) {
    if (result.status === 'rejected') {
      logger.warn(`failed to dispose cached inference resource error=${describeError(result.reason)}`)
    }
  }
}

/**
 * Runs `operation` on the configured provider and, if it fails on a hardware provider,
 * retries once on CPU — then keeps CPU for this process's lifetime so later cache misses
 * do not retry a broken provider.
 *
 * `retryOnHardwareFailure: false` for downloads: they already run on CPU, so their failures
 * cannot diagnose a hardware provider.
 */
export async function withHardwareFallback<T>(
  operation: () => Promise<T>,
  context: { logger: UtilityProcessLogger; describeRequest: () => string; retryOnHardwareFailure?: boolean }
): Promise<T> {
  try {
    return await operation()
  } catch (hardwareError) {
    if (context.retryOnHardwareFailure === false || runtimeProfile.id === 'cpu') throw hardwareError
    const provider = runtimeProfile.id
    context.logger.warn(
      `hardware inference failed provider=${provider} ${context.describeRequest()} error=${describeError(hardwareError)}; falling back to cpu`
    )
    await disposeCachedResources(context.logger)
    runtimeProfile = CPU_LOCAL_INFERENCE_PROFILE
    try {
      return await operation()
    } catch (cpuError) {
      throw new Error(
        `hardware inference failed provider=${provider} error=${describeError(hardwareError)}; CPU fallback failed error=${describeError(cpuError)}`
      )
    }
  }
}
