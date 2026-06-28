/**
 * Source ↔ data sync guard — fails when `src/labs` or `src/provider` changed but `data/*.json` was
 * NOT regenerated. CI's `catalog-hand-edit-check` only catches the OTHER direction (data edited with no
 * source change); generation reads live upstream, so a full generate-and-diff would be flaky. This test
 * is deterministic instead: it re-derives only the facts the generator controls from SOURCE ALONE
 * (provider connection config, hand-listed lab models + their `ownedBy`/`name`, provider overrides) and
 * asserts the committed JSON reflects them. Upstream-enriched fields (pricing, inferred metadata) are
 * out of scope here. Runs in the network-free `provider-registry` test project (CI: test:provider-registry).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canonOf } from '../../scripts/canonicalize'
import { LABS } from '../labs'
import { PROVIDERS } from '../provider'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const read = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'))
const models = read('models.json').models as Array<{ id: string; name?: string; ownedBy: string }>
const providers = read('providers.json').providers as Array<{ id: string; endpointConfigs: unknown }>
const overrides = read('provider-models.json').overrides as Array<{
  providerId: string
  modelId: string
  apiModelId?: string
  modelVariants?: string[]
}>

const modelById = new Map(models.map((m) => [m.id, m]))
const providerById = new Map(providers.map((p) => [p.id, p]))

// Order-insensitive stringify — the committed JSON has its keys sorted, the source objects don't.
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  )

describe('catalog ↔ source sync (regenerate guard)', () => {
  it('every src/provider has a providers.json row with matching endpointConfigs (and no extra rows)', () => {
    const missing = PROVIDERS.filter((p) => !providerById.has(p.id)).map((p) => p.id)
    expect(missing).toEqual([]) // src has a provider data/ doesn't → run `pnpm generate`

    const extra = providers.filter((p) => !PROVIDERS.some((s) => s.id === p.id)).map((p) => p.id)
    expect(extra).toEqual([]) // data has a provider src doesn't → stale or hand-edited

    const mismatched = PROVIDERS.filter((p) => {
      const row = providerById.get(p.id)
      return row && stable(row.endpointConfigs) !== stable(p.endpointConfigs)
    }).map((p) => p.id)
    expect(mismatched).toEqual([]) // connection config edited in src but not regenerated
  })

  it('every hand-listed lab model is present with the right ownedBy + name', () => {
    const problems: string[] = []
    for (const lab of LABS) {
      for (const lm of lab.models ?? []) {
        const id = canonOf(lm.id)
        const row = modelById.get(id)
        if (!row) {
          problems.push(`${lab.id}: missing "${id}"`)
          continue
        }
        if (row.ownedBy !== lab.id) problems.push(`"${id}": ownedBy ${row.ownedBy} ≠ ${lab.id}`)
        if (lm.name && row.name !== lm.name) problems.push(`"${id}": name "${row.name}" ≠ "${lm.name}"`)
      }
    }
    expect(problems).toEqual([])
  })

  it('every provider override resolves to a row in provider-models.json (full generator identity)', () => {
    // Mirror the generator's dedup identity exactly — providerId + modelId + apiModelId + sorted
    // modelVariants (see generate-catalog.ts `addOverride`). A provider may serve the same canonical
    // modelId under several apiModelIds (tokenhub's dated 原厂直供 variants); keying on less than the full
    // identity would let a dropped variant — or a stale row with wrong/missing modelVariants — slip through.
    const key = (o: { providerId: string; modelId: string; apiModelId?: string; modelVariants?: string[] }) =>
      `${o.providerId}|${o.modelId}|${o.apiModelId ?? ''}|${(o.modelVariants ?? []).slice().sort().join(',')}`
    const seen = new Set(overrides.map(key))
    const problems: string[] = []
    for (const p of PROVIDERS)
      for (const ov of p.overrides ?? [])
        if (
          ov.modelId &&
          !seen.has(
            key({ providerId: p.id, modelId: ov.modelId, apiModelId: ov.apiModelId, modelVariants: ov.modelVariants })
          )
        )
          problems.push(`${p.id}/${ov.modelId}/${ov.apiModelId ?? ''}`)
    expect(problems).toEqual([])
  })
})
