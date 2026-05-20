/**
 * Generate the "Supported Providers" markdown fragment from the real
 * SystemProviderIds source on main plus a maintained id → category +
 * display-name map.
 *
 * SystemProviderIds (src/renderer/src/types/provider.ts) is the single source
 * of truth for which providers Cherry Studio ships. We parse it with a regex
 * over the `SystemProviderIds = { ... } as const` block — the format is
 * stable, mechanical, and biome-controlled, so regex is enough; if the shape
 * ever changes the generator fails loudly via the no-match guard.
 *
 * Output mirrors the single-line "category: name, name, ... | category: ..."
 * format historically used in cherry-assistant-guide/SKILL.md so the diff
 * stays surgical.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { Language } from '../templating'

const ROOT_DIR = path.resolve(__dirname, '..', '..', '..')
const PROVIDER_IDS_FILE = path.join(ROOT_DIR, 'src/renderer/src/types/provider.ts')
const CATEGORIES_JSON = path.join(__dirname, '..', 'provider-categories.json')

interface ProviderEntry {
  id: string
  name: Record<Language, string>
}

interface CategoryDef {
  label: Record<Language, string>
  providers: ProviderEntry[]
}

interface CategoryFile {
  categories: Record<string, CategoryDef>
  order: string[]
}

const TRAILING_NOTE: Record<Language, string> = {
  'zh-CN': '支持任何 OpenAI 兼容端点',
  'en-US': 'Any OpenAI-compatible endpoint is supported'
}

/**
 * Extract the keys of the `SystemProviderIds = { ... } as const` block.
 *
 * Throws if the block can't be located or has zero entries — both cases mean
 * the upstream source format changed and the generator must be updated.
 */
function loadSystemProviderIds(): string[] {
  const source = fs.readFileSync(PROVIDER_IDS_FILE, 'utf-8')
  const block = source.match(/export const SystemProviderIds\s*=\s*\{([\s\S]*?)\}\s*as const/)
  if (!block) {
    throw new Error(
      `Could not locate "export const SystemProviderIds = { ... } as const" in ${path.relative(ROOT_DIR, PROVIDER_IDS_FILE)}. ` +
        `The upstream format probably changed; update generators/providers.ts to match.`
    )
  }
  const ids: string[] = []
  for (const line of block[1].split('\n')) {
    const m = line.match(/^\s*'?([a-zA-Z0-9_-]+)'?\s*:/)
    if (m) ids.push(m[1])
  }
  if (ids.length === 0) {
    throw new Error('SystemProviderIds block matched but contained zero keys — regex too strict or block empty.')
  }
  return ids
}

function loadCategories(): CategoryFile {
  const raw = JSON.parse(fs.readFileSync(CATEGORIES_JSON, 'utf-8'))
  return { categories: raw.categories, order: raw.order }
}

function bucketize(
  providerIds: string[],
  cats: CategoryFile
): { buckets: Map<string, ProviderEntry[]>; unknown: string[] } {
  const idToEntry = new Map<string, { category: string; entry: ProviderEntry }>()
  for (const [catId, def] of Object.entries(cats.categories)) {
    for (const p of def.providers) {
      idToEntry.set(p.id, { category: catId, entry: p })
    }
  }

  const buckets = new Map<string, ProviderEntry[]>()
  for (const cat of cats.order) buckets.set(cat, [])
  const fallback = 'other'
  const unknown: string[] = []

  for (const id of providerIds) {
    const found = idToEntry.get(id)
    if (found) {
      buckets.get(found.category)!.push(found.entry)
    } else {
      unknown.push(id)
      const stub: ProviderEntry = { id, name: { 'zh-CN': id, 'en-US': id } }
      const bucket = buckets.get(fallback) ?? []
      if (!buckets.has(fallback)) buckets.set(fallback, bucket)
      bucket.push(stub)
    }
  }

  return { buckets, unknown }
}

function renderLine(lang: Language, cats: CategoryFile, buckets: Map<string, ProviderEntry[]>): string {
  const segments: string[] = []
  for (const catId of cats.order) {
    const entries = buckets.get(catId)
    if (!entries || entries.length === 0) continue
    const label = cats.categories[catId].label[lang]
    const names = entries.map((p) => p.name[lang]).join(', ')
    segments.push(`${label}: ${names}`)
  }
  segments.push(TRAILING_NOTE[lang])
  return segments.join(' | ')
}

export interface ProvidersFragment {
  /** Single-line summary string matching legacy SKILL.md format. */
  summary: string
  /** Total provider count, exposed for use in other placeholders. */
  count: number
  /** Provider ids present in SystemProviderIds but missing from the categories map. */
  unknown: string[]
}

export function generateProvidersFragment(lang: Language): ProvidersFragment {
  const providerIds = loadSystemProviderIds()
  const cats = loadCategories()
  const { buckets, unknown } = bucketize(providerIds, cats)
  const summary = renderLine(lang, cats, buckets)
  return { summary, count: providerIds.length, unknown }
}
