/**
 * Strategy B refinement: keep model metadata (id/name/capabilities/modalities/
 * family/ownedBy) in models.json as the global catalog; provider-models.json
 * overrides only carry per-provider concerns (imageGeneration + apiModelId).
 *
 * For each provider-models override that carries `imageGeneration` AND also
 * carries metadata fields the previous migration stuffed in (capabilities/
 * inputModalities/outputModalities/name/description/family/ownedBy):
 *   1. If models.json already has an entry for this modelId → strip the
 *      metadata fields from the override (the model entry is the source).
 *   2. Else → restore a stub model entry in models.json carrying just the
 *      metadata, then strip from the override.
 *
 * Override after this script keeps: providerId, modelId, apiModelId?,
 * modelVariants?, imageGeneration, plus genuine override semantics (limits/
 * pricing/reasoning/parameterSupport overrides if any).
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
  [key: string]: unknown
}

interface ProviderModelOverride {
  providerId: string
  modelId: string
  imageGeneration?: unknown
  capabilities?: { force?: string[]; add?: string[]; remove?: string[] }
  inputModalities?: string[]
  outputModalities?: string[]
  name?: string
  description?: string
  family?: string
  ownedBy?: string
  [key: string]: unknown
}

const modelsPath = path.join(DATA_DIR, 'models.json')
const overridesPath = path.join(DATA_DIR, 'provider-models.json')

const modelsData = JSON.parse(fs.readFileSync(modelsPath, 'utf-8')) as { version: string; models: ModelConfig[] }
const overridesData = JSON.parse(fs.readFileSync(overridesPath, 'utf-8')) as {
  version: string
  overrides: ProviderModelOverride[]
}

const modelById = new Map<string, ModelConfig>()
for (const m of modelsData.models) modelById.set(m.id, m)

let stubsAdded = 0
let overridesCleaned = 0

for (const o of overridesData.overrides) {
  if (!o.imageGeneration) continue

  // Override-only model? Restore a stub to models.json.
  let model = modelById.get(o.modelId)
  if (!model) {
    model = {
      id: o.modelId,
      name: o.name ?? o.modelId,
      ...(o.description ? { description: o.description } : {}),
      ...(o.capabilities?.force ? { capabilities: o.capabilities.force } : {}),
      ...(o.inputModalities ? { inputModalities: o.inputModalities } : {}),
      ...(o.outputModalities ? { outputModalities: o.outputModalities } : {}),
      ...(o.family ? { family: o.family } : {}),
      ...(o.ownedBy ? { ownedBy: o.ownedBy } : {})
    }
    modelsData.models.push(model)
    modelById.set(o.modelId, model)
    stubsAdded++
  }

  // Strip metadata from the override — single source of truth is models.json.
  // Keep only imageGeneration + identifier/override semantics.
  let touched = false
  for (const field of [
    'name',
    'description',
    'family',
    'ownedBy',
    'capabilities',
    'inputModalities',
    'outputModalities'
  ] as const) {
    if (field in o) {
      delete (o as Record<string, unknown>)[field]
      touched = true
    }
  }
  if (touched) overridesCleaned++
}

// Newly-added stubs land at the end — keeps the diff minimal by not
// disturbing the existing (non-alphabetical) order of pre-existing entries.
modelsData.version = bumpVersion()
overridesData.version = bumpVersion()

fs.writeFileSync(modelsPath, JSON.stringify(modelsData, null, 2) + '\n')
fs.writeFileSync(overridesPath, JSON.stringify(overridesData, null, 2) + '\n')

console.log(`Stubs added to models.json: ${stubsAdded}`)
console.log(`Overrides cleaned (metadata stripped): ${overridesCleaned}`)
console.log(`models.json model count: ${modelsData.models.length}`)
console.log(`provider-models.json overrides count: ${overridesData.overrides.length}`)

function bumpVersion(): string {
  const now = new Date()
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getDate()).padStart(2, '0')}`
}
