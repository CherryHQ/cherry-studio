/**
 * Golden characterization of the reasoning-effort injection layer (#16598).
 *
 * These snapshots freeze the CURRENT output of the legacy heuristic paths
 * (`getReasoningEffort` branch tower + the native adapter param builders)
 * across the full (provider, model, effort) matrix — see reasoningMatrix.ts.
 *
 * They are the migration oracle, not a spec:
 *  - Phase 3 (registry data population) re-reviews every diff here as an
 *    intentional capability fix and updates the golden.
 *  - Phase 4 (descriptor→serializer swap) must keep them byte-identical.
 * Update with `vitest -u` ONLY alongside a reviewed data/behavior change.
 */
import { describe, expect, it } from 'vitest'

import {
  type BehaviorGroup,
  buildCatalogRows,
  buildEnrichedSyntheticRows,
  buildSyntheticRows,
  captureGenericTower,
  captureNativeParams,
  groupByBehavior,
  type MatrixRow
} from './reasoningMatrix'

function toGoldenJson(rows: MatrixRow[], groups: BehaviorGroup[]): string {
  return `${JSON.stringify({ rows: rows.length, groups: groups.length, behaviors: groups }, null, 2)}\n`
}

describe('reasoning injection golden matrix (characterization)', () => {
  const catalogRows = buildCatalogRows()
  const syntheticRows = buildSyntheticRows()

  it('loads both populations', () => {
    // Loose floors only — exact counts live inside the golden files.
    expect(catalogRows.length).toBeGreaterThan(500)
    expect(syntheticRows.length).toBeGreaterThan(500)
  })

  it('freezes the generic openai-compat tower over catalog rows', async () => {
    const groups = groupByBehavior(catalogRows, captureGenericTower)
    await expect(toGoldenJson(catalogRows, groups)).toMatchFileSnapshot('goldens/generic-tower.catalog.json')
  })

  it('freezes the generic openai-compat tower over synthetic custom rows', async () => {
    const groups = groupByBehavior(syntheticRows, captureGenericTower)
    await expect(toGoldenJson(syntheticRows, groups)).toMatchFileSnapshot('goldens/generic-tower.synthetic.json')
  })

  it('freezes the native adapter params over catalog rows', async () => {
    const groups = groupByBehavior(catalogRows, captureNativeParams)
    await expect(toGoldenJson(catalogRows, groups)).toMatchFileSnapshot('goldens/native-params.catalog.json')
  })

  it('freezes the native adapter params over synthetic custom rows', async () => {
    const groups = groupByBehavior(syntheticRows, captureNativeParams)
    await expect(toGoldenJson(syntheticRows, groups)).toMatchFileSnapshot('goldens/native-params.synthetic.json')
  })

  it('freezes the tower over ingest-ENRICHED synthetic rows (the descriptor-driven custom population)', async () => {
    const enriched = buildEnrichedSyntheticRows()
    // The custom population must be descriptor-driven: ingest inference covers
    // every family the heuristics know (rows without descriptors are the
    // knob-less/fixed-reasoning tail, served by the legacy fallback).
    const withDescriptor = enriched.filter((r) => r.model.reasoning?.type).length
    expect(withDescriptor / enriched.length).toBeGreaterThan(0.75)
    const groups = groupByBehavior(enriched, captureGenericTower)
    await expect(toGoldenJson(enriched, groups)).toMatchFileSnapshot('goldens/generic-tower.synthetic-enriched.json')
  })
})
