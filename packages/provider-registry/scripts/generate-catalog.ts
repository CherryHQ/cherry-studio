#!/usr/bin/env tsx
/**
 * Generate `data/models.json` + `data/provider-models.json` from the hand-maintained registries
 * (`src/creators/` + `src/providers/`), enriched with models.dev / OpenRouter metadata. Both JSON files are
 * PURE ARTIFACTS — never hand-edit them.
 *
 *   MODELSDEV_CACHE=/tmp/md.json OPENROUTER_CACHE=/tmp/or.json \
 *     tsx scripts/generate-catalog.ts            # dry run (prints summary)
 *     tsx scripts/generate-catalog.ts --write    # write both JSON files
 *     tsx scripts/generate-catalog.ts --report   # also dump /tmp/gen-*.txt review files
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ZodType } from 'zod'

import { CREATORS } from '../src/creators'
import { findHeuristicTokenLimits, inferReasoningControls } from '../src/patterns/reasoning-heuristics'
import { PROVIDERS } from '../src/providers'
import type { ProviderEntry } from '../src/providers/types'
import { stripHostReprefix } from '../src/utils/normalize'
import { deriveLegacyReasoningFields } from '../src/utils/reasoningControls'
import { canonOf, prefixHit } from './canonicalize'
import {
  type CherryMeta,
  finalizeMeta,
  mergeMeta,
  type ModelsDevApi,
  ModelsDevApiSchema,
  type OpenRouterApi,
  OpenRouterApiSchema,
  parseMdEntry,
  parseOrEntry
} from './upstream'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MODELS_PATH = process.env.MODELS_OUT || path.join(__dirname, '../data/models.json')
const PROVIDERS_PATH = path.join(__dirname, '../data/providers.json')
const PROVIDER_MODELS_PATH = path.join(__dirname, '../data/provider-models.json')
const WRITE = process.argv.includes('--write')
const REPORT = process.argv.includes('--report')
// Each artifact's `version` is a hash of its own (version-less, key-sorted) content: equal content ⇒
// equal version, ANY content change ⇒ new version. Seeders (`PresetProviderSeeder` via `SeedRunner`)
// skip when the journal version matches, so a date stamp would let a same-day regeneration change
// content without changing version — and the seed would silently never run. Upstream (models.dev/
// OpenRouter) is read live by default; set MODELSDEV_CACHE / OPENROUTER_CACHE to cache it during dev.
const contentVersion = (body: unknown): string =>
  createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16)

/** Key-sort `body`, stamp `version: contentVersion(body)`, and serialize — the single write shape. */
const stampAndSerialize = (body: Record<string, unknown>): string => {
  const sorted = sortKeys(body)
  return JSON.stringify(sortKeys({ ...sorted, version: contentVersion(sorted) }), null, 2) + '\n'
}

// Canonicalization (`canonOf`) + prefix matching (`prefixHit`) live in `./canonicalize` so they can be
// unit-tested / reused without running this script's generation IIFE.

// A host listing (e.g. amazon-bedrock) re-lists OTHER creators' models as `[region.]vendor.model` arns.
// Almost all canonicalize fine — stripping the vendor leaves an id the creator's own idPrefix reclaims
// (`meta.llama4-scout` → `llama4-scout` → meta, `writer.palmyra-x4` → `palmyra-x4` → writer). The
// exception is a vendor whose bedrock ids are BARE (`deepseek.r1` → `r1`): the strip orphans them, so the
// host (amazon) wrongly claims them and they fold over the real `deepseek-r1`. Skip ONLY those — the
// creator supplies them via its own listing / OpenRouter instead.
const creatorById = new Map(CREATORS.map((l) => [l.id, l]))
const crossVendorHost = (id: string, ownerCreatorId: string | undefined) => {
  const vendor = id.match(/^(?:[a-z]+\.)*([a-z]+)\./)?.[1]
  const creator = vendor && vendor !== ownerCreatorId ? creatorById.get(vendor) : undefined
  return !!creator && !(creator.idPrefixes ?? []).some((p) => prefixHit(canonOf(id), p))
}

const sortKeys = (v: any): any =>
  Array.isArray(v)
    ? v.map(sortKeys)
    : v && typeof v === 'object'
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, sortKeys(v[k])])
        )
      : v

/** Load an upstream source (cache file or live URL) and validate its top-level shape with zod. */
async function load<T>(env: string, url: string, schema: ZodType<T>): Promise<T> {
  const cache = process.env[env]
  let raw: unknown
  if (cache) {
    raw = JSON.parse(fs.readFileSync(cache, 'utf8'))
  } else {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} -> ${res.status}`)
    raw = await res.json()
  }
  return schema.parse(raw)
}

// ── canonical metadata index: canonId → metadata UNIONED across every source ──
type IndexEntry = { meta: CherryMeta; providers: Set<string> }
type Index = Map<string, IndexEntry>

/**
 * Build the metadata index. models.dev is read ONLY for the creator providers a creator forward-declares
 * (clean listings); hosts/gateways are ignored — indiscriminate ingestion injected host-prefixed dup
 * ids. Open-weights breadth comes from OpenRouter (clean org/model ids), always read. Metadata is
 * unioned across sources (so one host under-reporting can't hide a capability another reports).
 */
function buildIndex(md: ModelsDevApi, or: OpenRouterApi): Index {
  const index: Index = new Map()
  const consider = (id: string, mapped: CherryMeta | null, provider: string) => {
    if (!mapped) return
    const k = canonOf(id)
    if (!k) return
    const e = index.get(k) ?? { meta: {}, providers: new Set<string>() }
    e.providers.add(provider)
    e.meta = mergeMeta(e.meta, mapped)
    index.set(k, e)
  }
  const ownerOf = new Map<string, string>()
  for (const l of CREATORS) for (const p of l.modelsDevProviders ?? []) ownerOf.set(p, l.id)
  for (const [p, v] of Object.entries(md)) {
    if (!ownerOf.has(p)) continue
    for (const [id, m] of Object.entries(v.models ?? {})) {
      if (crossVendorHost(id, ownerOf.get(p))) continue
      consider(id, parseMdEntry(m), p)
    }
  }
  for (const m of or.data ?? []) consider(m.id, parseOrEntry(m), 'openrouter')

  // Fold host/org re-prefixes WITHOUT a hand-list (stripHostReprefix uses the index as the oracle):
  // databricks-gemini-3-flash → gemini-3-flash, cerebras-llama-4-scout → llama-4-scout, etc. Brands like
  // minimax-m3/deepseek-chat stay (their stem isn't a real id). The dup's metadata merges into the real model.
  for (const canonId of [...index.keys()]) {
    const e = index.get(canonId)
    if (!e) continue
    const target = stripHostReprefix(canonId, (id) => id !== canonId && index.has(id))
    if (target === canonId) continue
    const t = index.get(target)!
    t.meta = mergeMeta(t.meta, e.meta)
    for (const p of e.providers) t.providers.add(p)
    index.delete(canonId)
  }
  return index
}

/** Assign each canonical id to its creator (→ `ownedBy`), most-explicit signal first. */
async function assignCreators(index: Index, md: ModelsDevApi): Promise<Map<string, string>> {
  // each creator's models.dev provider listing (the weakest, provider-listing pass)
  const creatorProviderIds = new Map<string, Set<string>>()
  for (const creator of CREATORS) {
    if (!creator.modelsDevProviders) continue
    const ids = new Set<string>()
    for (const p of creator.modelsDevProviders)
      for (const id of Object.keys(md[p]?.models ?? {})) if (!crossVendorHost(id, creator.id)) ids.add(canonOf(id))
    creatorProviderIds.set(creator.id, ids)
  }
  // each creator's own API list (most native; keyless → empty, falls back to the passes below)
  const creatorFetched = new Map<string, Set<string>>()
  for (const creator of CREATORS) {
    if (!creator.fetchModels) continue
    try {
      const fetched = await creator.fetchModels()
      creatorFetched.set(creator.id, new Set(fetched.map((f) => canonOf(f.id))))
      console.log(`  ${creator.id}: fetched ${fetched.length} from its own API`)
    } catch (e) {
      console.log(`  ${creator.id}: fetchModels → models.dev fallback (${(e as Error).message})`)
    }
  }

  const claimed = new Map<string, string>()
  const claim = (id: string, labId: string) => {
    if (!claimed.has(id)) claimed.set(id, labId)
  }
  // pass 1 — EXPLICIT identity (the id names the creator): fetchModels, manual, idPrefix.
  // `deepseek-r1-distill-qwen` → deepseek (id) beats alibaba (family `qwen` = base arch).
  for (const creator of CREATORS) {
    for (const id of creatorFetched.get(creator.id) ?? []) claim(id, creator.id)
    for (const lm of creator.models ?? []) claim(canonOf(lm.id), creator.id)
    if (creator.idPrefixes)
      for (const canonId of index.keys())
        if (creator.idPrefixes.some((p) => prefixHit(canonId, p))) claim(canonId, creator.id)
  }
  // pass 2 — FAMILY (base architecture, weaker than an explicit id).
  for (const creator of CREATORS) {
    if (!creator.families) continue
    for (const [canonId, e] of index) {
      const fam = e.meta.family
      if (fam && creator.families.some((f) => fam === f || fam.startsWith(f))) claim(canonId, creator.id)
    }
  }
  // pass 3 — PROVIDER LISTING (leftovers; `deepseek-v4-flash` hosted by DashScope is already deepseek's).
  // `creatorProviderIds` is built from the RAW models.dev listing, so it still contains ids that `buildIndex`
  // folded away as host re-prefix duplicates (DashScope's `Moonshot-Kimi-K2-Instruct` → `kimi-k2-instruct`).
  // Gate on the post-fold index so a host can't resurrect a folded duplicate under its own ownership.
  for (const creator of CREATORS)
    for (const id of creatorProviderIds.get(creator.id) ?? []) if (index.has(id)) claim(id, creator.id)
  return claimed
}

/** Build the models.json rows from the claims: enrich from the index, apply manual creator models, tag kind. */
function buildModels(index: Index, claimed: Map<string, string>): Map<string, any> {
  const models = new Map<string, any>()
  for (const [canonId, labId] of claimed) {
    const meta = index.has(canonId) ? finalizeMeta(index.get(canonId)!.meta) : {}
    models.set(canonId, { id: canonId, name: meta.name || canonId, ownedBy: labId, ...meta, metadata: {} })
  }
  // manual creator models (add + override) — always win
  for (const creator of CREATORS) {
    for (const lm of creator.models ?? []) {
      const id = canonOf(lm.id)
      const existing = models.get(id) ?? { id, ownedBy: creator.id, metadata: {} }
      models.set(id, { ...existing, ...lm, id, ownedBy: creator.id, metadata: existing.metadata ?? {} })
    }
  }
  // Heuristic fill — reasoning-capable models with NO reasoning block at all
  // (models.dev has no reasoning_options for them) get their controls from the
  // ID-pattern heuristics (patterns/reasoning-heuristics.ts). Ingest-time only:
  // the knowledge ships as data, never as a runtime capability source (#16598).
  for (const m of models.values()) {
    if (m.reasoning || !(m.capabilities ?? []).includes('reasoning')) continue
    const controls = inferReasoningControls(m.id)
    if (controls) m.reasoning = { controls }
  }
  // Completion passes — models.dev frequently reports only the on/off toggle
  // for models whose family has richer knobs (glm's budget, claude-5.x's
  // effort tiers, the -latest aliases). A missing knob makes the request path
  // inert or budget-less, so merge the heuristic knowledge in when the
  // declaration lacks that control KIND (declared kinds always win).
  for (const m of models.values()) {
    const controls = m.reasoning?.controls
    if (!controls?.length) continue
    if (!controls.some((c: { kind: string }) => c.kind === 'budget')) {
      const limits = findHeuristicTokenLimits(m.id)
      if (limits) controls.push({ kind: 'budget', min: limits.min, max: limits.max })
    }
    if (!controls.some((c: { kind: string }) => c.kind === 'effort')) {
      const inferred = inferReasoningControls(m.id)?.find((c) => c.kind === 'effort')
      if (inferred) controls.unshift(inferred)
    }
  }
  // Reasoning normalization — `controls` is the source of truth: whenever a
  // model declares it (upstream ingest, creator hand-list, or heuristic fill),
  // the legacy pair (supportedEfforts / thinkingTokenLimits) + defaultEffort
  // are re-derived so the shipped JSON can never drift (locked by the catalog
  // invariant test).
  for (const m of models.values()) {
    const controls = m.reasoning?.controls
    if (!controls?.length) continue
    m.reasoning = { controls, ...deriveLegacyReasoningFields(controls) }
  }
  // Tag embedding/rerank — models.dev mislabels these as text. `rerank` in the id wins; else `embed` in
  // the id, or the owning creator's declared `kind` (bge/voyage/jina/… whose ids don't say so). Embedders output `vector`.
  const creatorKind = new Map(CREATORS.map((l) => [l.id, l.kind]))
  for (const m of models.values()) {
    const kind = /rerank/i.test(m.id) ? 'rerank' : /embed/i.test(m.id) ? 'embedding' : creatorKind.get(m.ownedBy)
    if (kind !== 'embedding' && kind !== 'rerank') continue
    m.capabilities = [...new Set([...(m.capabilities ?? []), kind])]
    if (kind === 'embedding') m.outputModalities = ['vector']
    if (!m.inputModalities?.length) m.inputModalities = ['text']
  }
  // Tag web-search — a curated capability upstream never reports (no `inferXxx`): the owning creator declares
  // which of its models carry it, as DATA, via `webSearch` id-prefixes. Union onto upstream capabilities.
  const creatorWebSearch = new Map(CREATORS.map((l) => [l.id, l.webSearch ?? []]))
  for (const m of models.values()) {
    // web-search is a TEXT-CHAT capability: a non-chat SKU never inherits it just for sharing a chat
    // sibling's prefix. Skip image rows (`gpt-5-image*` ride `gpt-5`; they output text too, so the
    // modality gate alone won't catch them) and any row that doesn't converse in text on both sides —
    // TTS (text→audio) and transcription (audio→text). Hand-listed capabilities are unaffected.
    if ((m.capabilities ?? []).includes('image-generation')) continue
    if (!(m.inputModalities ?? ['text']).includes('text') || !(m.outputModalities ?? ['text']).includes('text'))
      continue
    if ((creatorWebSearch.get(m.ownedBy) ?? []).some((p) => prefixHit(m.id, p)))
      m.capabilities = [...new Set([...(m.capabilities ?? []), 'web-search'])]
  }
  return models
}

/**
 * Build providers.json from PROVIDERS: the connection config only (generation-only `modelsDevProvider` /
 * `fetchModels` / `overrides` are dropped), with `description` templated as `"{name} - AI model provider"`.
 * Array order follows PROVIDERS; `sortKeys` orders each provider's keys.
 */
function buildProviders(): ProviderEntry[] {
  // oxlint-disable-next-line no-unused-vars
  return PROVIDERS.map(({ modelsDevProvider, fetchModels, overrides, ...conn }) => ({
    ...conn,
    description: `${conn.name} - AI model provider`
  }))
}

/**
 * Build provider-models.json PURELY from src/providers — no dependency on the previous output (generation is
 * a pure function of the source). Each provider contributes its manual `overrides` (curated pricing /
 * apiModelId maps / imageGeneration — what the runtime can't derive) plus, if it declares a
 * `modelsDevProvider`, one row per served model carrying that listing's PRICING. `modelId` resolves to a
 * base row or is standalone with a `name`.
 */
function buildProviderModels(md: ModelsDevApi, baseIds: Set<string>): { overrides: any[] } {
  const seen = new Set<string>()
  const rows: any[] = []
  const variantsKey = (o: any): string => (o.modelVariants ?? []).slice().sort().join(',')
  // Overrides key on `apiModelId` too, so one provider can serve the SAME canonical model under several
  // apiModelIds (e.g. tokenhub's dated 原厂直供 variants alongside the undated id) — `listProviderRegistryModels`
  // turns each surviving row into a distinct selectable model (its unique id derives from apiModelId).
  const addOverride = (o: any): void => {
    const k = `${o.providerId} ${o.modelId} ${o.apiModelId ?? ''} ${variantsKey(o)}`
    if (seen.has(k)) return
    seen.add(k)
    rows.push(o)
  }
  // md-derived rows key on `modelId` only — upstream date snapshots that canonicalize to one id collapse to
  // a single row. No provider declares both `overrides` and `modelsDevProvider`, so the two paths never
  // share a (providerId, modelId) and an override never needs to shadow an md row.
  const addModel = (o: any): void => {
    const k = `${o.providerId} ${o.modelId} ${variantsKey(o)}`
    if (seen.has(k)) return
    seen.add(k)
    rows.push(o)
  }
  for (const p of PROVIDERS) {
    for (const ov of p.overrides ?? []) addOverride({ providerId: p.id, ...ov })
    const src = p.modelsDevProvider ? (md[p.modelsDevProvider]?.models ?? {}) : {}
    for (const [apiModelId, m] of Object.entries(src)) {
      const meta = parseMdEntry(m)
      if (!meta?.pricing) continue // no pricing → runtime resolves to base, no row needed
      const modelId = canonOf(apiModelId)
      if (!modelId) continue
      const row: any = { providerId: p.id, modelId, apiModelId, pricing: meta.pricing }
      if (!baseIds.has(modelId)) {
        if (!meta.name) continue
        row.name = meta.name // vendor-exclusive → standalone
      }
      addModel(row)
    }
  }
  rows.sort((a, b) => `${a.providerId} ${a.modelId}`.localeCompare(`${b.providerId} ${b.modelId}`))
  return { overrides: rows }
}

void (async () => {
  const md = await load('MODELSDEV_CACHE', 'https://models.dev/api.json', ModelsDevApiSchema)
  const or = await load('OPENROUTER_CACHE', 'https://openrouter.ai/api/v1/models', OpenRouterApiSchema)

  const index = buildIndex(md, or)
  const claimed = await assignCreators(index, md)
  const models = buildModels(index, claimed)

  const unassigned = [...index.keys()].filter((k) => !claimed.has(k))
  console.log(`creators: ${CREATORS.length}`)
  console.log(`canonical models in md∪OR: ${index.size}`)
  console.log(`assigned to a creator: ${models.size}`)
  console.log(`unassigned (no creator claims — dropped): ${unassigned.length}`)
  const byOwner: Record<string, number> = {}
  for (const m of models.values()) byOwner[m.ownedBy] = (byOwner[m.ownedBy] || 0) + 1
  console.log(
    'per-creator:',
    Object.entries(byOwner)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([o, n]) => `${o}:${n}`)
      .join('  ')
  )
  if (REPORT) {
    const lines = unassigned.map((k) => `${index.get(k)!.meta.family || '-'}\t${k}`).sort()
    fs.writeFileSync('/tmp/gen-unassigned.txt', lines.join('\n') + '\n')
    fs.writeFileSync('/tmp/gen-assigned.txt', [...models.keys()].sort().join('\n') + '\n')
  }

  if (!WRITE) {
    console.log('\nDRY RUN — re-run with --write to generate, --report for /tmp review files.')
    return
  }

  const list = [...models.values()].map((m) => {
    const { metadata, ...rest } = m
    return { ...rest, ...(metadata ? { metadata } : {}) }
  })
  fs.writeFileSync(MODELS_PATH, stampAndSerialize({ models: list }))
  console.log(`\nWROTE ${MODELS_PATH} (${list.length} models).`)

  const providers = buildProviders()
  fs.writeFileSync(PROVIDERS_PATH, stampAndSerialize({ providers }))
  console.log(`WROTE ${PROVIDERS_PATH} (${providers.length} providers).`)

  const pm = buildProviderModels(md, new Set(models.keys()))
  fs.writeFileSync(PROVIDER_MODELS_PATH, stampAndSerialize(pm))
  console.log(`WROTE ${PROVIDER_MODELS_PATH} (${pm.overrides.length} rows).`)
})()
