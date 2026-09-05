/**
 * Source ↔ data sync guard — fails when `src/creators` or `src/providers` changed but `data/*.json` was
 * NOT regenerated. CI's `catalog-hand-edit-check` only catches the OTHER direction (data edited with no
 * source change); generation reads live upstream, so a full generate-and-diff would be flaky. This test
 * is deterministic instead: it re-derives the facts the generator controls from SOURCE ALONE and asserts
 * the committed JSON reflects them. Coverage is full-payload where the generator output is fully
 * source-derived — the entire provider object (buildProviders strips gen-only fields + templates
 * `description`) and the entire override row (`{ providerId, ...ov }`) — so stale `defaultChatEndpoint`,
 * endpoint dialects, billing facts, `metadata`, override `pricing`/`imageGeneration`, etc. are caught. Creator models stay at
 * presence/`ownedBy`/`name`: their other fields (capabilities, modalities, limits) are unioned with
 * upstream-inferred metadata, so a full compare would be non-deterministic. Upstream-enriched fields
 * (pricing on md-derived rows, inferred metadata) remain out of scope. Runs in the network-free
 * `provider-registry` test project (CI: test:provider-registry).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { canonOf, prefixHit, splitOverrideWireId } from '../../scripts/canonicalize'
import { CREATORS } from '../creators'
import { REASONING_FAMILY_RULES } from '../patterns/reasoning-families.gen'
import {
  SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS,
  WEB_SEARCH_UNSUPPORTED_EFFORTS
} from '../patterns/server-tool-constraints.gen'
import { PROVIDER_SERVER_TOOL_MODEL_IDS } from '../patterns/server-tool-models.gen'
import { PROVIDERS } from '../providers'
import { ReasoningFamilyRuleSchema } from '../schemas/model'

const dataDir = join(fileURLToPath(import.meta.url), '..', '..', '..', 'data')
const read = (f: string) => JSON.parse(readFileSync(join(dataDir, f), 'utf8'))
const models = read('models.json').models as Array<{
  id: string
  name?: string
  ownedBy: string
}>
const providers = read('providers.json').providers as Array<Record<string, unknown> & { id: string }>
const overrides = read('provider-models.json').overrides as Array<
  Record<string, unknown> & { providerId: string; modelId: string; apiModelId?: string; modelVariants?: string[] }
>

const modelById = new Map(models.map((m) => [m.id, m]))
const providerById = new Map(providers.map((p) => [p.id, p]))

// Order-insensitive stringify — the committed JSON has its keys sorted, the source objects don't.
const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val).sort(([a], [b]) => a.localeCompare(b)))
      : val
  )

// Mirror buildProviders: drop the generation-only fields, template `description` (always overrides any
// source `description`). The result is the exact source-derived provider payload the generator emits.
const GEN_ONLY_PROVIDER_FIELDS = ['modelsDevProvider', 'fetchModels', 'standaloneModelIds', 'overrides']
const expectedProviderPayload = (p: Record<string, unknown>) => {
  const conn = { ...p }
  for (const k of GEN_ONLY_PROVIDER_FIELDS) delete conn[k]
  if (Array.isArray(conn.serverTools)) {
    conn.serverTools = conn.serverTools.map((tool) => {
      const config = { ...(tool as Record<string, unknown>) }
      delete config.modelIdPrefixes
      delete config.modelIds
      delete config.imageModelIds
      return config
    })
  }
  return { ...conn, description: `${String(p.name)} - AI model provider` }
}

// Mirror buildProviders' generator identity for overrides: providerId + modelId + apiModelId + sorted
// modelVariants. Used to pair each source override with its committed row.
const overrideIdentity = (o: { providerId: string; modelId: string; apiModelId?: string; modelVariants?: string[] }) =>
  `${o.providerId}|${o.modelId}|${o.apiModelId ?? ''}|${(o.modelVariants ?? []).slice().sort().join(',')}`

describe('catalog ↔ source sync (regenerate guard)', () => {
  it('keeps AMD GPU Cloud in the twentieth slot used to seed new profiles', () => {
    expect(PROVIDERS[19]?.id).toBe('radeon-cloud')
    expect(providers[19]?.id).toBe('radeon-cloud')
  })

  it('classifies every source provider by supported application edition', () => {
    for (const provider of PROVIDERS) {
      expect(provider.availableInEditions).toContain('global')
    }
  })

  it('every src/providers has a providers.json row with the full source-derived payload (and no extra rows)', () => {
    const missing = PROVIDERS.filter((p) => !providerById.has(p.id)).map((p) => p.id)
    expect(missing).toEqual([]) // src has a provider data/ doesn't → run `pnpm generate`

    const extra = providers.filter((p) => !PROVIDERS.some((s) => s.id === p.id)).map((p) => p.id)
    expect(extra).toEqual([]) // data has a provider src doesn't → stale or hand-edited

    const mismatched = PROVIDERS.filter((p) => {
      const row = providerById.get(p.id)
      return row && stable(row) !== stable(expectedProviderPayload(p as unknown as Record<string, unknown>))
    }).map((p) => p.id)
    expect(mismatched).toEqual([]) // a provider field changed in src but data/ wasn't regenerated
  })

  it('every hand-listed creator model is present with the right ownedBy + name', () => {
    const problems: string[] = []
    for (const creator of CREATORS) {
      for (const lm of creator.models ?? []) {
        const id = canonOf(lm.id)
        const row = modelById.get(id)
        if (!row) {
          problems.push(`${creator.id}: missing "${id}"`)
          continue
        }
        if (row.ownedBy !== creator.id) problems.push(`"${id}": ownedBy ${row.ownedBy} ≠ ${creator.id}`)
        if (lm.name && row.name !== lm.name) problems.push(`"${id}": name "${row.name}" ≠ "${lm.name}"`)
      }
    }
    expect(problems).toEqual([])
  })

  it('every provider override is present with its full source-derived payload', () => {
    // The generator emits `{ providerId, ...ov }` per override and dedups on the full identity (providerId
    // + modelId + apiModelId + sorted modelVariants). Pair each source override with its committed row by
    // identity, then compare the WHOLE payload — so a dropped variant (missing row) AND a stale field
    // (pricing/imageGeneration/disabled/… not regenerated) both fail.
    const rowByIdentity = new Map(overrides.map((o) => [overrideIdentity(o), o]))
    const problems: string[] = []
    for (const p of PROVIDERS)
      for (const raw of p.overrides ?? []) {
        if (!raw.modelId) continue
        // Generation splits an authored served-id into canonical key + apiModelId; mirror it here.
        const ov = splitOverrideWireId(raw)
        if (
          p.modelsDevProvider &&
          !ov.apiModelId &&
          (ov.endpointTypes ||
            ov.reasoningContracts ||
            ov.requestControls ||
            ov.parameterSupport ||
            ov.name ||
            ov.ownedBy ||
            Object.hasOwn(ov, 'pricing'))
        ) {
          const rows = overrides.filter((row) => row.providerId === p.id && row.modelId === ov.modelId)
          if (rows.length === 0) problems.push(`missing ${p.id}/${ov.modelId}/model-template`)
          else if (
            rows.some(
              (row) =>
                (Object.hasOwn(ov, 'endpointTypes') && stable(row.endpointTypes) !== stable(ov.endpointTypes)) ||
                (Object.hasOwn(ov, 'pricing') && stable(row.pricing) !== stable(ov.pricing)) ||
                (Object.hasOwn(ov, 'reasoningContracts') &&
                  stable(row.reasoningContracts) !== stable(ov.reasoningContracts)) ||
                (Object.hasOwn(ov, 'requestControls') && stable(row.requestControls) !== stable(ov.requestControls)) ||
                (Object.hasOwn(ov, 'parameterSupport') &&
                  stable(row.parameterSupport) !== stable(ov.parameterSupport)) ||
                (Object.hasOwn(ov, 'name') && stable(row.name) !== stable(ov.name)) ||
                (Object.hasOwn(ov, 'ownedBy') && stable(row.ownedBy) !== stable(ov.ownedBy))
            )
          ) {
            problems.push(`stale ${p.id}/${ov.modelId}/model-template`)
          }
          continue
        }
        const expected = { providerId: p.id, ...ov }
        const row = rowByIdentity.get(overrideIdentity(expected as Parameters<typeof overrideIdentity>[0]))
        if (!row) problems.push(`missing ${p.id}/${ov.modelId}/${ov.apiModelId ?? ''}`)
        else if (stable(row) !== stable(expected)) problems.push(`stale ${p.id}/${ov.modelId}/${ov.apiModelId ?? ''}`)
      }
    expect(problems).toEqual([])
  })

  it('reasoning-families.gen.ts mirrors the creator reasoningFamilies declarations exactly', () => {
    // The runtime artifact is 100% source-derived (no upstream), so a full
    // ordered deep-compare is deterministic: a creator edit without
    // `pnpm generate` — or a hand edit of the .gen file — both fail here.
    const expected = CREATORS.flatMap((c) => c.reasoningFamilies ?? [])
    expect(REASONING_FAMILY_RULES.map(stable)).toEqual(expected.map(stable))
  })

  it('server-tool-models.gen.ts reflects the provider model selectors', () => {
    const problems: string[] = []
    const declaredKeys = new Set<string>()

    for (const provider of PROVIDERS) {
      // Same-tool declarations split the serving scope; align each with its generated entry in order.
      const declarationsByTool = new Map<string, NonNullable<typeof provider.serverTools>>()
      for (const tool of provider.serverTools ?? []) {
        if (tool.modelScope !== 'model-dependent') continue
        declaredKeys.add(`${provider.id}/${tool.id}`)
        const list = declarationsByTool.get(tool.id) ?? []
        list.push(tool)
        declarationsByTool.set(tool.id, list)
      }

      for (const [toolId, declarations] of declarationsByTool) {
        const key = `${provider.id}/${toolId}`
        const generated = PROVIDER_SERVER_TOOL_MODEL_IDS[provider.id]?.[toolId] ?? []

        if (generated.length === 0) problems.push(`${key}: no generated models`)
        if (generated.length !== declarations.length) {
          problems.push(`${key}: ${generated.length} generated entries vs ${declarations.length} declarations`)
        }
        declarations.forEach((tool, i) => {
          const entry = generated[i]
          if (!entry) return
          const exactIds = new Set(tool.modelIds ?? [])
          const prefixes = tool.modelIdPrefixes ?? []

          for (const id of exactIds) {
            if (!entry.ids.includes(id)) problems.push(`${key}[${i}]: exact model ${id} was not generated`)
          }
          for (const id of entry.ids) {
            if (!exactIds.has(id) && !prefixes.some((prefix) => prefixHit(id, prefix))) {
              problems.push(`${key}[${i}]: stale generated model ${id}`)
            }
          }
          const declaredEndpoints = [...(tool.endpointTypes ?? [])].sort().join(',')
          const generatedEndpoints = [...(entry.endpointTypes ?? [])].sort().join(',')
          if (declaredEndpoints !== generatedEndpoints) {
            problems.push(`${key}[${i}]: endpoint scope mismatch (${generatedEndpoints} vs ${declaredEndpoints})`)
          }
        })
      }
    }

    for (const [providerId, tools] of Object.entries(PROVIDER_SERVER_TOOL_MODEL_IDS)) {
      for (const toolId of Object.keys(tools)) {
        const key = `${providerId}/${toolId}`
        if (!declaredKeys.has(key)) problems.push(`${key}: generated without a provider declaration`)
      }
    }

    expect(problems).toEqual([])
  })

  it('server-tool-constraints.gen.ts reflects the creator constraint declarations', () => {
    // The gen file stores ids expanded against the upstream model universe, so a
    // full mirror compare would be flaky (unlike reasoning-families). This checks
    // the deterministic half: a declaration must produce entries, and every
    // declared pattern/prefix must have hit at least one committed id.
    const declaresMixing = CREATORS.some((c) => (c.serverToolFunctionMixing ?? []).length > 0)
    expect(SERVER_TOOL_FUNCTION_MIXING_MODEL_IDS.length > 0).toBe(declaresMixing)

    const declaredEfforts = new Set(
      CREATORS.flatMap((c) => c.webSearchUnsupportedEfforts ?? []).flatMap((r) => r.efforts)
    )
    const generatedEfforts = new Set(Object.values(WEB_SEARCH_UNSUPPORTED_EFFORTS).flat())
    expect([...generatedEfforts].sort()).toEqual([...declaredEfforts].sort())
  })

  it('every creator reasoningFamilies rule is schema-valid', () => {
    const problems: string[] = []
    for (const creator of CREATORS) {
      for (const rule of creator.reasoningFamilies ?? []) {
        const parsed = ReasoningFamilyRuleSchema.safeParse(rule)
        if (!parsed.success) problems.push(`${creator.id}: ${rule.pattern}`)
      }
    }
    expect(problems).toEqual([])
  })
})
