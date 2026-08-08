// Exhaustiveness guard for the engine→backup degradation-kind mapping.
//
// `RESTORE_DEGRADATION_KIND` (in ImportOrchestrator) maps the engine's consumer-neutral
// `ReconcileDegradationKind` onto backup's published `RestoreDegradationKind` (the IPC + i18n
// surface). `Record<ReconcileDegradationKind, RestoreDegradation['kind']>` guarantees every engine
// kind has a mapping at compile time — but it CANNOT catch a value typoed to a different
// (type-legal) union member, because `RestoreDegradation['kind']` is a union, not a runtime check.
// Only `RestoreDegradationKindSchema.parse()` validates the value at runtime. This test is that
// runtime check: every mapped value must land inside the published zod enum.
//
// See design.md §4.6 (D2) and README.md §2 of the reconciliation package.
import { RECONCILE_DEGRADATION_KINDS } from '@main/services/reconciliation'
import { RestoreDegradationKindSchema } from '@shared/types/backup'
import { describe, expect, it } from 'vitest'

import { RESTORE_DEGRADATION_KIND } from '../ImportOrchestrator'

describe('RESTORE_DEGRADATION_KIND mapping exhaustiveness', () => {
  it('maps exactly the engine kinds (no missing, no extra)', () => {
    // Record<K,V> already enforces key completeness at compile time; this is the runtime mirror
    // that also fails if someone adds a key the engine vocabulary does not declare.
    const engineKinds = new Set(RECONCILE_DEGRADATION_KINDS)
    const mappedKinds = new Set(Object.keys(RESTORE_DEGRADATION_KIND))
    expect(mappedKinds).toEqual(engineKinds)
  })

  it('every mapped value is a member of the published RestoreDegradationKind zod enum', () => {
    // The one guard Record<K,V> cannot provide: a value typoed to a different type-legal union
    // member (e.g. remote_overwrote_local → 'field_conflict') would typecheck but be semantically
    // wrong and break the renderer i18n lookup. zod parse is the runtime backstop.
    const bad: string[] = []
    for (const [engineKind, restoreKind] of Object.entries(RESTORE_DEGRADATION_KIND)) {
      const parsed = RestoreDegradationKindSchema.safeParse(restoreKind)
      if (!parsed.success) {
        bad.push(`${engineKind} → '${restoreKind}' (not in RestoreDegradationKindSchema)`)
      }
    }
    expect(bad, `these engine kinds map to values outside the published zod enum:\n${bad.join('\n')}`).toEqual([])
  })
})
