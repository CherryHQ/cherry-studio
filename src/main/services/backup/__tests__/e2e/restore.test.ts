/**
 * e2e-restore (批次2) — blocked on restore-quiesce.
 * Skeleton so the AC file path exists; cases stay skipped until quiesce lands.
 */
import { describe, it } from 'vitest'

describe.skip('e2e-restore (batch 2 — waiting on restore-quiesce)', () => {
  it('admit→merge→staging→journal→promotion state machine', () => {
    // TODO(batch2): implement after restore-quiesce
  })

  it('concurrent write during snapshot → 2nd fingerprint mismatch → no journal', () => {
    // TODO(batch2)
  })

  it('skipped owning file_entry cascades prune file_ref rows', () => {
    // TODO(batch2)
  })

  it('KB searchable after knowledge.index-documents enqueue', () => {
    // TODO(batch2)
  })

  it('fault injection: drain straggler / seal fail / fingerprint / preboot', () => {
    // TODO(batch2)
  })
})
