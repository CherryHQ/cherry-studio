/**
 * One-shot migration: move vendor-exclusive image-gen models from
 * models.json → provider-models.json with inline imageGeneration override.
 *
 * Triggered by: PR review feedback that models.json shouldn't carry
 * single-provider entries after the unified-schema rewrite.
 *
 * For each model in models.json with an `imageGeneration` block that is
 * seeded by exactly one provider in provider-models.json:
 *   1. Read the existing override entry for (provider, model).
 *   2. Merge the model's metadata (name, description, family, ownedBy,
 *      inputModalities, outputModalities) + imageGeneration block into the
 *      override. Capabilities translated to `{ force: [...] }`.
 *   3. Delete the model from models.json.
 *
 * Idempotent: re-running is a no-op (no model in models.json with
 * imageGeneration that's also single-seeded after the first run).
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '../data')

interface ModelConfig {
  id: string
  name?: string
  description?: string
  family?: string
  ownedBy?: string
  capabilities?: string[]
  inputModalities?: string[]
  outputModalities?: string[]
  imageGeneration?: unknown
  openWeights?: boolean
  pricing?: unknown
  [key: string]: unknown
}

interface ProviderModelOverride {
  providerId: string
  modelId: string
  [key: string]: unknown
}

const modelsPath = path.join(DATA_DIR, 'models.json')
const overridesPath = path.join(DATA_DIR, 'provider-models.json')

const modelsData = JSON.parse(fs.readFileSync(modelsPath, 'utf-8')) as { version: string; models: ModelConfig[] }
const overridesData = JSON.parse(fs.readFileSync(overridesPath, 'utf-8')) as {
  version: string
  overrides: ProviderModelOverride[]
}

// Build provider-set per modelId
const providersByModel = new Map<string, Set<string>>()
for (const o of overridesData.overrides) {
  const set = providersByModel.get(o.modelId) ?? new Set()
  set.add(o.providerId)
  providersByModel.set(o.modelId, set)
}

const moves: Array<{ provider: string; modelId: string }> = []
const keptModels: ModelConfig[] = []

for (const m of modelsData.models) {
  if (!m.imageGeneration) {
    keptModels.push(m)
    continue
  }
  const providers = providersByModel.get(m.id)
  if (!providers || providers.size !== 1) {
    keptModels.push(m)
    continue
  }
  const providerId = [...providers][0]
  // Single-provider image-gen model — move to override.
  moves.push({ provider: providerId, modelId: m.id })

  const overrideIdx = overridesData.overrides.findIndex((o) => o.providerId === providerId && o.modelId === m.id)
  if (overrideIdx === -1) {
    throw new Error(`Expected override for ${providerId}/${m.id} but not found`)
  }
  const existing = overridesData.overrides[overrideIdx]

  // Merge metadata; existing override fields win (in case provider customized).
  const merged: ProviderModelOverride = {
    ...existing,
    ...(existing.name ? {} : m.name && m.name !== m.id ? { name: m.name } : {}),
    ...(existing.description ? {} : m.description ? { description: m.description } : {}),
    ...(existing.family ? {} : m.family ? { family: m.family } : {}),
    ...(existing.ownedBy ? {} : m.ownedBy ? { ownedBy: m.ownedBy } : {}),
    ...(existing.inputModalities ? {} : m.inputModalities ? { inputModalities: m.inputModalities } : {}),
    ...(existing.outputModalities ? {} : m.outputModalities ? { outputModalities: m.outputModalities } : {}),
    ...(existing.imageGeneration ? {} : { imageGeneration: m.imageGeneration }),
    ...(existing.capabilities
      ? {}
      : m.capabilities && m.capabilities.length > 0
        ? { capabilities: { force: m.capabilities } }
        : {})
  }
  overridesData.overrides[overrideIdx] = merged
}

modelsData.models = keptModels
overridesData.version = bumpVersion(overridesData.version)
modelsData.version = bumpVersion(modelsData.version)

fs.writeFileSync(modelsPath, JSON.stringify(modelsData, null, 2) + '\n')
fs.writeFileSync(overridesPath, JSON.stringify(overridesData, null, 2) + '\n')

console.log(`Moved ${moves.length} models from models.json → provider-models.json`)
const byProvider: Record<string, number> = {}
for (const { provider } of moves) byProvider[provider] = (byProvider[provider] ?? 0) + 1
for (const [p, n] of Object.entries(byProvider).sort()) {
  console.log(`  ${p}: ${n}`)
}

function bumpVersion(_v: string): string {
  // Format YYYY.MM.DD; use current date so a re-run reflects the latest schema move.
  const now = new Date()
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
}
