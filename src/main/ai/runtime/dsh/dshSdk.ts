/**
 * The single runtime entry point to the dsh (DeepSeek Harness) client SDK.
 *
 * `@deepseek-ai/dsh-sdk-client` is ESM-only (`type: module`, `exports` with only
 * `types`/`default` conditions), and Cherry's electron-vite MAIN bundle is CJS
 * with externalized `dependencies` — so a static `import`/`require` would be
 * emitted as a CJS `require()` of an ESM entry and throw at runtime. A native
 * dynamic `import()` is preserved by the bundler and loads the ESM entry
 * correctly (same contract as `pi/piSdk.ts`). Every runtime use of dsh SDK
 * values MUST go through here; `import type` elsewhere is compile-only and safe.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

function loadFromRuntime(specifier: string, runtimeRoot?: string) {
  if (!runtimeRoot) throw new Error(`Missing DSH runtime root for ${specifier}`)
  const entry = createRequire(path.join(runtimeRoot, 'package.json')).resolve(specifier)
  return import(pathToFileURL(entry).href)
}

export function loadDshSdk(runtimeRoot?: string) {
  return runtimeRoot
    ? loadFromRuntime('@deepseek-ai/dsh-sdk-client', runtimeRoot)
    : import('@deepseek-ai/dsh-sdk-client')
}

/** Same ESM-only constraint: the bridge side channel rides `JsonRpcLineTransport` from here. */
export function loadDshSdkProtocol(runtimeRoot?: string) {
  return runtimeRoot
    ? loadFromRuntime('@deepseek-ai/dsh-sdk-protocol', runtimeRoot)
    : import('@deepseek-ai/dsh-sdk-protocol')
}
