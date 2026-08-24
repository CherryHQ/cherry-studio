import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as z from 'zod'

import type { DshRuntimeEntrySpecifier } from './runtimeEntries'

const require_ = createRequire(import.meta.url)
const runtimeDirectory = fileURLToPath(new URL('./runtime/', import.meta.url))

const DshRuntimeManifestSchema = z.object({
  schemaVersion: z.literal(1),
  entries: z.record(z.string(), z.string().min(1))
})
type DshRuntimeManifest = z.infer<typeof DshRuntimeManifestSchema>

let runtimeManifest: DshRuntimeManifest | undefined

function readRuntimeManifest(): DshRuntimeManifest {
  if (runtimeManifest) return runtimeManifest
  const manifestPath = resolve(runtimeDirectory, 'runtime-manifest.json')
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch (error) {
    throw new Error(`Bundled DSH runtime manifest is unavailable: ${manifestPath}`, { cause: error })
  }
  try {
    runtimeManifest = DshRuntimeManifestSchema.parse(raw)
  } catch (error) {
    throw new Error(`Invalid bundled DSH runtime manifest: ${manifestPath}`, { cause: error })
  }
  return runtimeManifest
}

export function resolveDshRuntimeEntry(specifier: string): string {
  return require_.resolve(specifier)
}

export function resolveBundledDshRuntimeEntry(specifier: DshRuntimeEntrySpecifier): string {
  const entryName = readRuntimeManifest().entries[specifier]
  if (typeof entryName !== 'string' || entryName.length === 0) {
    throw new Error(`Unknown bundled DSH runtime entry: ${specifier}`)
  }
  const entryPath = resolve(runtimeDirectory, entryName)
  const pathFromRuntime = relative(runtimeDirectory, entryPath)
  if (!pathFromRuntime || pathFromRuntime.startsWith('..') || isAbsolute(pathFromRuntime)) {
    throw new Error(`Bundled DSH runtime entry escaped its runtime directory: ${specifier}`)
  }
  return entryPath
}

export function listBundledDshRuntimeEntries(): readonly DshRuntimeEntrySpecifier[] {
  return Object.keys(readRuntimeManifest().entries).sort() as DshRuntimeEntrySpecifier[]
}
