#!/usr/bin/env tsx
/**
 * Generate `data/models.json` + `data/provider-models.json` from the hand-maintained registries
 * (`src/labs/` + `src/provider/`), enriched with models.dev / OpenRouter metadata. Both JSON files are
 * PURE ARTIFACTS — never hand-edit them.
 *
 *   MODELSDEV_CACHE=/tmp/md.json OPENROUTER_CACHE=/tmp/or.json \
 *     tsx scripts/generate-catalog.ts            # dry run (prints summary)
 *     tsx scripts/generate-catalog.ts --write    # write both JSON files
 *     tsx scripts/generate-catalog.ts --report   # also dump /tmp/gen-*.txt review files
 */
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ZodType } from 'zod'

import { LABS } from '../src/labs'
import { PROVIDERS } from '../src/provider'
import type { ProviderEntry } from '../src/provider/types'
import {
  expandKnownPrefixes,
  normalizeVersionSeparators,
  stripAggregatorPrefixes,
  stripBedrockRevision,
  stripBedrockVendorPrefix,
  stripHostReprefix,
  stripQuantization,
  stripVariantSuffixes
} from '../src/utils/normalize'
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
// Stamp generated files with the generation date (YYYY.MM.DD). Upstream (models.dev/OpenRouter) is read
// live by default; set MODELSDEV_CACHE / OPENROUTER_CACHE to a local file to cache it during dev.
const VERSION = new Date().toISOString().slice(0, 10).replace(/-/g, '.')

// ── canonicalization (shares the runtime resolver's normalizeModelId helpers) ──
// strip the same org/host routing prefixes the runtime resolver does (zai-org-, databricks-, …),
// so a host that flattens `zai-org/glm-5` → `zai-org-glm-5` folds into the real `glm-5`; then peel the
// bedrock cross-vendor `[region.]vendor.` / `vendor-` prefix (shared with the runtime).
const base = (id: string) => stripBedrockVendorPrefix(stripAggregatorPrefixes(id.toLowerCase().split('/').pop()!))
const stripDate = (s: string) =>
  s
    .replace(/@.*$/, '')
    .replace(/-20\d{2}-(?:0[1-9]|1[0-2])-(?:[0-2]\d|3[01])$/, '')
    .replace(/-20\d{2}(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$/, '')
    .replace(/-2\d(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$/, '')
    .replace(/-(?:0[1-9]|1[0-2])(?:[0-2]\d|3[01])$/, '')
    .replace(/-2\d(?:0[1-9]|1[0-2])$/, '')
// Minus param-size stripping — the catalog keeps `qwen3-235b` ≠ `qwen3-30b`. Order matters: strip the
// `-thinking`/`-free` variant BEFORE the date so the date ends the token.
const canonOf = (id: string) => {
  let s = base(id) // split('/').pop, lowercase, strip aggregator + bedrock-vendor prefix
  s = stripBedrockRevision(s) // bedrock arn revision: claude-…-v1:0 / …:0 (keeps whisper-v3)
  s = expandKnownPrefixes(s) // mm- → minimax-
  s = stripVariantSuffixes(s) // -free / -thinking / -tee / -low / :free / (free) …
  s = stripQuantization(s) // -fp8 / -fp16 / -awq …
  s = stripDate(s) // trailing release-date stamps
  s = normalizeVersionSeparators(s) // 4.6 → 4-6
  return s
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}
// a `-` OR a digit ends the prefix word, so `qwen` claims both `qwen-max` and `qwen3-30b-a3b`
const prefixHit = (id: string, p: string) =>
  id === p || id.startsWith(`${p}-`) || (id.startsWith(p) && /\d/.test(id[p.length] ?? ''))

// A host listing (e.g. amazon-bedrock) re-lists OTHER creators' models as `[region.]vendor.model` arns.
// Almost all canonicalize fine — stripping the vendor leaves an id the creator's own idPrefix reclaims
// (`meta.llama4-scout` → `llama4-scout` → meta, `writer.palmyra-x4` → `palmyra-x4` → writer). The
// exception is a vendor whose bedrock ids are BARE (`deepseek.r1` → `r1`): the strip orphans them, so the
// host (amazon) wrongly claims them and they fold over the real `deepseek-r1`. Skip ONLY those — the
// creator supplies them via its own listing / OpenRouter instead.
const labById = new Map(LABS.map((l) => [l.id, l]))
const crossVendorHost = (id: string, ownerLabId: string | undefined) => {
  const vendor = id.match(/^(?:[a-z]+\.)*([a-z]+)\./)?.[1]
  const lab = vendor && vendor !== ownerLabId ? labById.get(vendor) : undefined
  return !!lab && !(lab.idPrefixes ?? []).some((p) => prefixHit(canonOf(id), p))
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
 * Build the metadata index. models.dev is read ONLY for the creator providers a lab forward-declares
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
  for (const l of LABS) for (const p of l.modelsDevProviders ?? []) ownerOf.set(p, l.id)
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

/** Assign each canonical id to its lab (→ `ownedBy`), most-explicit signal first. */
async function assignLabs(index: Index, md: ModelsDevApi): Promise<Map<string, string>> {
  // each lab's models.dev provider listing (the weakest, provider-listing pass)
  const labProviderIds = new Map<string, Set<string>>()
  for (const lab of LABS) {
    if (!lab.modelsDevProviders) continue
    const ids = new Set<string>()
    for (const p of lab.modelsDevProviders)
      for (const id of Object.keys(md[p]?.models ?? {})) if (!crossVendorHost(id, lab.id)) ids.add(canonOf(id))
    labProviderIds.set(lab.id, ids)
  }
  // each lab's own API list (most native; keyless → empty, falls back to the passes below)
  const labFetched = new Map<string, Set<string>>()
  for (const lab of LABS) {
    if (!lab.fetchModels) continue
    try {
      const fetched = await lab.fetchModels()
      labFetched.set(lab.id, new Set(fetched.map((f) => canonOf(f.id))))
      console.log(`  ${lab.id}: fetched ${fetched.length} from its own API`)
    } catch (e) {
      console.log(`  ${lab.id}: fetchModels → models.dev fallback (${(e as Error).message})`)
    }
  }

  const claimed = new Map<string, string>()
  const claim = (id: string, labId: string) => {
    if (!claimed.has(id)) claimed.set(id, labId)
  }
  // pass 1 — EXPLICIT identity (the id names the creator): fetchModels, manual, idPrefix.
  // `deepseek-r1-distill-qwen` → deepseek (id) beats alibaba (family `qwen` = base arch).
  for (const lab of LABS) {
    for (const id of labFetched.get(lab.id) ?? []) claim(id, lab.id)
    for (const lm of lab.models ?? []) claim(canonOf(lm.id), lab.id)
    if (lab.idPrefixes)
      for (const canonId of index.keys()) if (lab.idPrefixes.some((p) => prefixHit(canonId, p))) claim(canonId, lab.id)
  }
  // pass 2 — FAMILY (base architecture, weaker than an explicit id).
  for (const lab of LABS) {
    if (!lab.families) continue
    for (const [canonId, e] of index) {
      const fam = e.meta.family
      if (fam && lab.families.some((f) => fam === f || fam.startsWith(f))) claim(canonId, lab.id)
    }
  }
  // pass 3 — PROVIDER LISTING (leftovers; `deepseek-v4-flash` hosted by DashScope is already deepseek's).
  for (const lab of LABS) for (const id of labProviderIds.get(lab.id) ?? []) claim(id, lab.id)
  return claimed
}

/** Build the models.json rows from the claims: enrich from the index, apply manual lab models, tag kind. */
function buildModels(index: Index, claimed: Map<string, string>): Map<string, any> {
  const models = new Map<string, any>()
  for (const [canonId, labId] of claimed) {
    const meta = index.has(canonId) ? finalizeMeta(index.get(canonId)!.meta) : {}
    models.set(canonId, { id: canonId, name: meta.name || canonId, ownedBy: labId, ...meta, metadata: {} })
  }
  // manual lab models (add + override) — always win
  for (const lab of LABS) {
    for (const lm of lab.models ?? []) {
      const id = canonOf(lm.id)
      const existing = models.get(id) ?? { id, ownedBy: lab.id, metadata: {} }
      models.set(id, { ...existing, ...lm, id, ownedBy: lab.id, metadata: existing.metadata ?? {} })
    }
  }
  // Tag embedding/rerank — models.dev mislabels these as text. `rerank` in the id wins; else `embed` in
  // the id, or the owning lab's declared `kind` (bge/voyage/jina/… whose ids don't say so). Embedders output `vector`.
  const labKind = new Map(LABS.map((l) => [l.id, l.kind]))
  for (const m of models.values()) {
    const kind = /rerank/i.test(m.id) ? 'rerank' : /embed/i.test(m.id) ? 'embedding' : labKind.get(m.ownedBy)
    if (kind !== 'embedding' && kind !== 'rerank') continue
    m.capabilities = [...new Set([...(m.capabilities ?? []), kind])]
    if (kind === 'embedding') m.outputModalities = ['vector']
    if (!m.inputModalities?.length) m.inputModalities = ['text']
  }
  // Tag web-search — a curated capability upstream never reports (no `inferXxx`): the owning lab declares
  // which of its models carry it, as DATA, via `webSearch` id-prefixes. Union onto upstream capabilities.
  const labWebSearch = new Map(LABS.map((l) => [l.id, l.webSearch ?? []]))
  for (const m of models.values()) {
    // An image-generation model never inherits a text sibling's web search just for sharing its prefix
    // (`gpt-5-image*` ride the `gpt-5` prefix). web-search is a text capability — skip the image rows.
    if ((m.capabilities ?? []).includes('image-generation')) continue
    if ((labWebSearch.get(m.ownedBy) ?? []).some((p) => prefixHit(m.id, p)))
      m.capabilities = [...new Set([...(m.capabilities ?? []), 'web-search'])]
  }
  return models
}

/**
 * Build providers.json from PROVIDERS: the connection config only (generation-only `modelsDevProvider` /
 * `fetchModels` / `overrides` are dropped), with `description` templated as `"{name} - AI model provider"`.
 * Array order follows PROVIDERS; `sortKeys` orders each provider's keys.
 */
function buildProviders(): { providers: ProviderEntry[]; version: string } {
  // oxlint-disable-next-line no-unused-vars
  const providers = PROVIDERS.map(({ modelsDevProvider, fetchModels, overrides, ...conn }) => ({
    ...conn,
    description: `${conn.name} - AI model provider`
  }))
  return { providers, version: VERSION }
}

/**
 * Build provider-models.json PURELY from src/provider — no dependency on the previous output (generation is
 * a pure function of the source). Each provider contributes its manual `overrides` (curated pricing /
 * apiModelId maps / imageGeneration — what the runtime can't derive) plus, if it declares a
 * `modelsDevProvider`, one row per served model carrying that listing's PRICING. `modelId` resolves to a
 * base row or is standalone with a `name`.
 */
function buildProviderModels(md: ModelsDevApi, baseIds: Set<string>): { root: any; rows: number } {
  const seen = new Set<string>()
  const rows: any[] = []
  const add = (o: any): void => {
    const k = `${o.providerId} ${o.modelId} ${(o.modelVariants ?? []).slice().sort().join(',')}`
    if (seen.has(k)) return
    seen.add(k)
    rows.push(o)
  }
  for (const p of PROVIDERS) {
    // manual overrides first so they win the dedup
    for (const ov of p.overrides ?? []) add({ providerId: p.id, ...ov })
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
      add(row)
    }
  }
  rows.sort((a, b) => `${a.providerId} ${a.modelId}`.localeCompare(`${b.providerId} ${b.modelId}`))
  return { root: { overrides: rows, version: VERSION }, rows: rows.length }
}

void (async () => {
  const md = await load('MODELSDEV_CACHE', 'https://models.dev/api.json', ModelsDevApiSchema)
  const or = await load('OPENROUTER_CACHE', 'https://openrouter.ai/api/v1/models', OpenRouterApiSchema)

  const index = buildIndex(md, or)
  const claimed = await assignLabs(index, md)
  const models = buildModels(index, claimed)

  const unassigned = [...index.keys()].filter((k) => !claimed.has(k))
  console.log(`labs: ${LABS.length}`)
  console.log(`canonical models in md∪OR: ${index.size}`)
  console.log(`assigned to a lab: ${models.size}`)
  console.log(`unassigned (no lab claims — dropped): ${unassigned.length}`)
  const byOwner: Record<string, number> = {}
  for (const m of models.values()) byOwner[m.ownedBy] = (byOwner[m.ownedBy] || 0) + 1
  console.log(
    'per-lab:',
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
  fs.writeFileSync(MODELS_PATH, JSON.stringify(sortKeys({ models: list, version: VERSION }), null, 2) + '\n')
  console.log(`\nWROTE ${MODELS_PATH} (${list.length} models).`)

  const providers = buildProviders()
  fs.writeFileSync(PROVIDERS_PATH, JSON.stringify(sortKeys(providers), null, 2) + '\n')
  console.log(`WROTE ${PROVIDERS_PATH} (${providers.providers.length} providers).`)

  const pm = buildProviderModels(md, new Set(models.keys()))
  fs.writeFileSync(PROVIDER_MODELS_PATH, JSON.stringify(sortKeys(pm.root), null, 2) + '\n')
  console.log(`WROTE ${PROVIDER_MODELS_PATH} (${pm.rows} rows).`)
})()
