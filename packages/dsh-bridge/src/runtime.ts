import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { DSH_RUNTIME_ENTRY_NAMES, type DshRuntimeEntrySpecifier } from './runtimeEntries'

const require_ = createRequire(import.meta.url)

export function resolveDshRuntimeEntry(specifier: string): string {
  return require_.resolve(specifier)
}

export function resolveBundledDshRuntimeEntry(specifier: DshRuntimeEntrySpecifier): string {
  const entryName = DSH_RUNTIME_ENTRY_NAMES[specifier]
  if (!entryName) throw new Error(`Unknown bundled DSH runtime entry: ${specifier}`)
  return fileURLToPath(new URL(`./runtime/${entryName}.mjs`, import.meta.url))
}
