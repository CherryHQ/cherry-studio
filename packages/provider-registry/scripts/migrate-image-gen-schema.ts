/**
 * One-shot codemod that migrates `data/models.json` and
 * `data/provider-models.json` from the legacy `ImageGenerationSupport`
 * shape (modes:string[] + modeSchemas + top-level sizes/batch/customSize +
 * heterogeneous supports + keyMap) to the new unified shape (modes:
 * Record<Mode, { supports: Record<string, SupportSpec>, vendorTransport?
 * }>) declared in `src/schemas/model.ts`.
 *
 * Run once:
 *   pnpm tsx packages/provider-registry/scripts/migrate-image-gen-schema.ts
 *
 * The script is idempotent: re-running on already-migrated data is a no-op
 * (it detects the new shape and skips). PPIO transport routing (endpoint
 * URL + isSync flag) is pulled from
 * `src/renderer/src/pages/paintings/providers/ppio/models.ts:PPIO_MODELS`
 * and attached to each ppio model's per-mode `vendorTransport`.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

type LegacyRange = { min?: number; max?: number; default?: number }
type LegacySupports = Record<string, boolean | string[] | LegacyRange>
type LegacyParams = {
  sizes?: string[]
  sizeMode?: 'pixel' | 'aspect' | 'either'
  defaultSize?: string
  allowAutoSize?: boolean
  batch?: LegacyRange
  customSize?: { min: number; max: number }
  supports?: LegacySupports
  vendorParams?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
  keyMap?: Record<string, string>
}
type LegacyImageGeneration = LegacyParams & {
  modes?: string[]
  modeSchemas?: Record<string, Partial<LegacyParams>>
}

type SupportSpec =
  | { type: 'switch'; default?: boolean }
  | { type: 'enum'; options: string[]; default?: string; render?: 'select' | 'chips'; columns?: number }
  | { type: 'range'; min: number; max: number; default?: number; step?: number }
  | { type: 'size'; minSide: number; maxSide: number; pairedEnumKey?: string }
  | { type: 'text'; multiline?: boolean }
type ModeDef = { supports: Record<string, SupportSpec>; vendorTransport?: { endpoint: string; isSync?: boolean } }
type NewImageGeneration = {
  modes: Record<string, ModeDef>
  vendorParams?: Record<string, unknown>
  inputSchema?: Record<string, unknown>
}

const REPO_ROOT = resolve(__dirname, '../../..')
const MODELS_JSON = resolve(REPO_ROOT, 'packages/provider-registry/data/models.json')
const PROVIDER_MODELS_JSON = resolve(REPO_ROOT, 'packages/provider-registry/data/provider-models.json')
const PROVIDERS_JSON = resolve(REPO_ROOT, 'packages/provider-registry/data/providers.json')
const PPIO_MODELS_TS = resolve(REPO_ROOT, 'src/renderer/src/pages/paintings/providers/ppio/models.ts')

/** Keys whose legacy `boolean: true` value is semantically a text input,
 *  not a switch (seed accepts a numeric/string; negativePrompt is a textarea). */
const BOOLEAN_KEYS_THAT_ARE_TEXT = new Set(['seed', 'negativePrompt'])
/** Enum keys that render as chip rows instead of dropdowns. */
const ENUM_KEYS_RENDERED_AS_CHIPS = new Set(['aspectRatio', 'imageResolution'])

/**
 * `ASPECT_1_1` / `ASPECT_3_4` (the @google/genai SDK enum format) →
 * `'1:1'` / `'3:4'` (wire format imagen + AI SDK expect). Idempotent on
 * already-converted strings.
 */
function aspectFromEnum(value: string): string {
  return value.replace(/^ASPECT_/, '').replace('_', ':')
}

function isNewShape(value: unknown): value is NewImageGeneration {
  if (!value || typeof value !== 'object') return false
  const modes = (value as { modes?: unknown }).modes
  return modes !== undefined && !Array.isArray(modes) && typeof modes === 'object'
}

function legacySupportsToNewSpecs(
  supports: LegacySupports | undefined,
  sizeKey: string | null
): Record<string, SupportSpec> {
  const out: Record<string, SupportSpec> = {}
  if (!supports) return out
  for (const [key, value] of Object.entries(supports)) {
    // The legacy aspectRatio key sometimes overlaps with the new
    // `aspectRatio` size entry; the caller's sizeKey wins and we skip
    // here to avoid double-writing.
    if (sizeKey === 'aspectRatio' && key === 'aspectRatio') continue
    if (typeof value === 'boolean') {
      if (!value) continue
      if (BOOLEAN_KEYS_THAT_ARE_TEXT.has(key)) {
        out[key] = key === 'negativePrompt' ? { type: 'text', multiline: true } : { type: 'text' }
      } else {
        out[key] = { type: 'switch' }
      }
    } else if (Array.isArray(value)) {
      const spec: SupportSpec = { type: 'enum', options: value as string[] }
      if (ENUM_KEYS_RENDERED_AS_CHIPS.has(key)) (spec as { render?: 'chips' }).render = 'chips'
      out[key] = spec
    } else if (typeof value === 'object' && value !== null) {
      const r = value as LegacyRange
      const spec: SupportSpec = {
        type: 'range',
        min: r.min ?? 0,
        max: r.max ?? Number.MAX_SAFE_INTEGER
      }
      if (r.default !== undefined) (spec as { default?: number }).default = r.default
      out[key] = spec
    }
  }
  return out
}

function migrateMode(
  legacy: LegacyParams & { keyMap?: Record<string, string> },
  legacyKeyMap: Record<string, string>
): ModeDef {
  const supports: Record<string, SupportSpec> = {}

  // Resolve which canonical name holds the size — `aspectRatio` for models
  // whose legacy `keyMap.size === 'aspectRatio'` (Ideogram V_*) OR whose
  // `sizeMode === 'aspect'`; `size` otherwise.
  let sizeKey: string | null = null
  if (legacy.sizes?.length) {
    sizeKey = legacy.sizeMode === 'aspect' || legacyKeyMap.size === 'aspectRatio' ? 'aspectRatio' : 'size'
    const options = sizeKey === 'aspectRatio' ? legacy.sizes.map(aspectFromEnum) : legacy.sizes
    const spec: SupportSpec = {
      type: 'enum',
      options,
      render: 'chips'
    }
    if (legacy.defaultSize !== undefined) {
      ;(spec as { default?: string }).default =
        sizeKey === 'aspectRatio' ? aspectFromEnum(legacy.defaultSize) : legacy.defaultSize
    }
    supports[sizeKey] = spec
  }

  if (legacy.batch) {
    const r = legacy.batch
    const spec: SupportSpec = {
      type: 'range',
      min: r.min ?? 1,
      max: r.max ?? 10
    }
    if (r.default !== undefined) (spec as { default?: number }).default = r.default
    supports.numImages = spec
  }

  if (legacy.customSize) {
    supports.customSize = {
      type: 'size',
      minSide: legacy.customSize.min,
      maxSide: legacy.customSize.max,
      pairedEnumKey: sizeKey ?? 'size'
    }
  }

  Object.assign(supports, legacySupportsToNewSpecs(legacy.supports, sizeKey))
  return { supports }
}

function migrateImageGeneration(legacy: LegacyImageGeneration): NewImageGeneration {
  if (isNewShape(legacy)) return legacy as unknown as NewImageGeneration

  const keyMap = legacy.keyMap ?? {}
  const modesList = legacy.modes ?? ['generate']
  const newModes: Record<string, ModeDef> = {}
  for (const modeName of modesList) {
    const override = legacy.modeSchemas?.[modeName] ?? {}
    const merged: LegacyParams = {
      sizes: override.sizes ?? legacy.sizes,
      sizeMode: override.sizeMode ?? legacy.sizeMode,
      defaultSize: override.defaultSize ?? legacy.defaultSize,
      batch: override.batch ?? legacy.batch,
      customSize: override.customSize ?? legacy.customSize,
      supports: { ...legacy.supports, ...override.supports }
    }
    newModes[modeName] = migrateMode(merged, keyMap)
  }

  const out: NewImageGeneration = { modes: newModes }
  if (legacy.vendorParams) out.vendorParams = legacy.vendorParams
  if (legacy.inputSchema) out.inputSchema = legacy.inputSchema
  return out
}

interface PpioRouting {
  endpoint: string
  isSync: boolean
  ppioMode: 'ppio_draw' | 'ppio_edit'
}

function splitPpioBlocks(body: string): string[] {
  const blocks: string[] = []
  let depth = 0
  let start = -1
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{') {
      if (depth === 0) start = i
      depth += 1
    } else if (ch === '}') {
      depth -= 1
      if (depth === 0 && start !== -1) {
        blocks.push(body.slice(start, i + 1))
        start = -1
      }
    }
  }
  return blocks
}

function loadPpioRouting(): Map<string, PpioRouting[]> {
  const src = readFileSync(PPIO_MODELS_TS, 'utf-8')
  // PPIO_MODELS is a hand-maintained TS const; brace-counting yields
  // discrete object blocks without lookahead leaking `isSync` across
  // entries (a single greedy regex over the whole array body did exactly
  // that in the first version of this script).
  const arrayMatch = src.match(/export const PPIO_MODELS:[^=]*=\s*\[([\s\S]*?)\n\]/)
  if (!arrayMatch) throw new Error('Could not locate PPIO_MODELS array in ' + PPIO_MODELS_TS)
  const blocks = splitPpioBlocks(arrayMatch[1])
  const byModelId = new Map<string, PpioRouting[]>()
  for (const block of blocks) {
    const id = /id:\s*'([^']+)'/.exec(block)?.[1]
    const endpoint = /endpoint:\s*'([^']+)'/.exec(block)?.[1]
    const mode = /mode:\s*'([^']+)'/.exec(block)?.[1]
    if (!id || !endpoint || !mode) continue
    const routing: PpioRouting = {
      endpoint,
      isSync: /isSync:\s*true/.test(block),
      ppioMode: mode as 'ppio_draw' | 'ppio_edit'
    }
    const list = byModelId.get(id) ?? []
    list.push(routing)
    byModelId.set(id, list)
  }
  return byModelId
}

function attachPpioTransport(ig: NewImageGeneration, routings: PpioRouting[]): NewImageGeneration {
  for (const routing of routings) {
    const targetMode = routing.ppioMode === 'ppio_edit' ? 'edit' : 'generate'
    const def = ig.modes[targetMode]
    if (def) {
      def.vendorTransport = { endpoint: routing.endpoint }
      if (routing.isSync) def.vendorTransport.isSync = true
    } else {
      // Model declares modes in models.json that diverge from PPIO_MODELS;
      // synthesize an empty supports mode so the routing lands somewhere.
      ig.modes[targetMode] = {
        supports: {},
        vendorTransport: routing.isSync ? { endpoint: routing.endpoint, isSync: true } : { endpoint: routing.endpoint }
      }
    }
  }
  return ig
}

type ImageGenerationField = LegacyImageGeneration | NewImageGeneration
type WithImageGeneration<T extends string> = { [K in T]?: ImageGenerationField }

function main(): void {
  // 1. models.json — base catalog
  const modelsRaw = JSON.parse(readFileSync(MODELS_JSON, 'utf-8')) as {
    models: (WithImageGeneration<'imageGeneration'> & { id: string })[]
  }
  let modelsTouched = 0
  const ppioRouting = loadPpioRouting()
  for (const model of modelsRaw.models) {
    if (!model.imageGeneration) continue
    if (isNewShape(model.imageGeneration)) continue
    const migrated = migrateImageGeneration(model.imageGeneration)
    const routings = ppioRouting.get(model.id)
    model.imageGeneration = routings ? attachPpioTransport(migrated, routings) : migrated
    modelsTouched += 1
  }
  if (modelsTouched > 0) writeFileSync(MODELS_JSON, JSON.stringify(modelsRaw, null, 2) + '\n')

  // 2. provider-models.json — per-provider overrides
  const overridesRaw = JSON.parse(readFileSync(PROVIDER_MODELS_JSON, 'utf-8')) as {
    overrides: (WithImageGeneration<'imageGeneration'> & { providerId: string; modelId: string })[]
  }
  let overridesTouched = 0
  for (const override of overridesRaw.overrides) {
    if (!override.imageGeneration) continue
    if (isNewShape(override.imageGeneration)) continue
    override.imageGeneration = migrateImageGeneration(override.imageGeneration)
    overridesTouched += 1
  }
  if (overridesTouched > 0) writeFileSync(PROVIDER_MODELS_JSON, JSON.stringify(overridesRaw, null, 2) + '\n')

  // 3. providers.json — `paintingDefaults` (uses same schema). Only OVMS today.
  const providersRaw = JSON.parse(readFileSync(PROVIDERS_JSON, 'utf-8')) as {
    providers: (WithImageGeneration<'paintingDefaults'> & { id: string })[]
  }
  let providersTouched = 0
  for (const provider of providersRaw.providers) {
    if (!provider.paintingDefaults) continue
    if (isNewShape(provider.paintingDefaults)) continue
    provider.paintingDefaults = migrateImageGeneration(provider.paintingDefaults)
    providersTouched += 1
  }
  if (providersTouched > 0) writeFileSync(PROVIDERS_JSON, JSON.stringify(providersRaw, null, 2) + '\n')

  console.log(
    `Migrated: ${modelsTouched} model entries · ${overridesTouched} override entries · ${providersTouched} provider paintingDefaults`
  )
}

main()
