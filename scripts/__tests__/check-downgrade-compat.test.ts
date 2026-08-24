import { describe, expect, it } from 'vitest'

import {
  advanceBaseline,
  type Contract,
  getDowngradeViolations,
  reconcile,
  type Snapshot
} from '../check-downgrade-compat'

function snapshot(tables: Snapshot['tables']): Snapshot {
  return { tables }
}

const BASELINE = snapshot({
  prompt: {
    columns: {
      id: { name: 'id', notNull: true },
      title: { name: 'title', notNull: true },
      note: { name: 'note' }
    },
    indexes: {},
    checkConstraints: {}
  }
})

function contract(overrides: Partial<Contract> = {}): Contract {
  return {
    baseline: { version: '2.0.8', snapshot: '0011_rare_vertigo' },
    scheduled: [],
    acknowledged: [],
    ...overrides
  }
}

describe('getDowngradeViolations', () => {
  it('reports a dropped table and a dropped column the released app still selects', () => {
    const violations = getDowngradeViolations(
      snapshot({ ...BASELINE.tables, gone: { columns: { id: { name: 'id' } } } }),
      snapshot({ prompt: { columns: { id: { name: 'id' }, title: { name: 'title', notNull: true } } } })
    )

    expect(violations.map((violation) => `${violation.kind} ${violation.id}`)).toEqual([
      'column-removed prompt.note',
      'table-removed gone'
    ])
  })

  it('reports NOT NULL arriving without a default, in both directions', () => {
    const violations = getDowngradeViolations(
      BASELINE,
      snapshot({
        prompt: {
          columns: {
            id: { name: 'id', notNull: true },
            title: { name: 'title', notNull: true },
            note: { name: 'note', notNull: true },
            visibility: { name: 'visibility', notNull: true }
          }
        }
      })
    )

    expect(violations.map((violation) => `${violation.kind} ${violation.id}`)).toEqual([
      'notnull-tightened prompt.note',
      'notnull-added prompt.visibility'
    ])
  })

  it('clears a new NOT NULL column once it carries a DB default, but not a tightened one', () => {
    const violations = getDowngradeViolations(
      BASELINE,
      snapshot({
        prompt: {
          columns: {
            id: { name: 'id', notNull: true },
            title: { name: 'title', notNull: true },
            // A DEFAULT applies only when the column is omitted, and the released app
            // has `note` in its own schema — it writes NULL explicitly.
            note: { name: 'note', notNull: true, default: "'x'" },
            visibility: { name: 'visibility', notNull: true, default: "'global'" }
          }
        }
      })
    )

    expect(violations.map((violation) => `${violation.kind} ${violation.id}`)).toEqual([
      'notnull-tightened prompt.note'
    ])
  })

  it('reports a NOT NULL column losing its default, which the released app relies on', () => {
    const violations = getDowngradeViolations(
      snapshot({ prompt: { columns: { visibility: { name: 'visibility', notNull: true, default: "'global'" } } } }),
      snapshot({ prompt: { columns: { visibility: { name: 'visibility', notNull: true } } } })
    )

    expect(violations.map((violation) => `${violation.kind} ${violation.id}`)).toEqual([
      'default-removed prompt.visibility'
    ])
  })

  it('ignores a nullable column losing its default, since the insert just lands NULL', () => {
    const violations = getDowngradeViolations(
      snapshot({ prompt: { columns: { note: { name: 'note', default: "'x'" } } } }),
      snapshot({ prompt: { columns: { note: { name: 'note' } } } })
    )

    expect(violations).toEqual([])
  })

  it('reports a same-named unique index that narrows to fewer columns', () => {
    const columns = BASELINE.tables.prompt.columns
    const violations = getDowngradeViolations(
      snapshot({ prompt: { columns, indexes: { prompt_uniq: { isUnique: true, columns: ['title', 'note'] } } } }),
      snapshot({ prompt: { columns, indexes: { prompt_uniq: { isUnique: true, columns: ['title'] } } } })
    )

    expect(violations.map((violation) => `${violation.kind} ${violation.id}`)).toEqual([
      'unique-added prompt.prompt_uniq'
    ])
  })

  it('reports a changed CHECK and a new unique, since narrowing rejects the released app writes', () => {
    const columns = BASELINE.tables.prompt.columns
    const violations = getDowngradeViolations(
      snapshot({ prompt: { columns, checkConstraints: { c: { value: "title IN ('a','b')" } } } }),
      snapshot({
        prompt: {
          columns,
          checkConstraints: { c: { value: "title IN ('a')" } },
          uniqueConstraints: { prompt_title_unique: {} },
          indexes: { prompt_note_idx: { isUnique: true } }
        }
      })
    )

    expect(violations.map((violation) => `${violation.kind} ${violation.id}`)).toEqual([
      'check-changed prompt.c',
      'unique-added prompt.prompt_title_unique',
      'unique-added prompt.prompt_note_idx'
    ])
  })

  it('passes additive changes the released app can ignore', () => {
    const violations = getDowngradeViolations(
      BASELINE,
      snapshot({
        prompt: {
          columns: { ...BASELINE.tables.prompt.columns, extra: { name: 'extra' } },
          indexes: { prompt_note_idx: { isUnique: false } }
        },
        fresh_table: { columns: { id: { name: 'id', notNull: true } } }
      })
    )

    expect(violations).toEqual([])
  })
})

describe('reconcile', () => {
  const dropped = getDowngradeViolations(BASELINE, snapshot({ prompt: { columns: { id: { name: 'id' } } } }))

  it('fails an undisposed violation with both ways out', () => {
    const [failure] = reconcile(dropped, contract())

    expect(failure).toContain('prompt.title')
    expect(failure).toContain('migrations/downgrade-contract.json')
  })

  it('accepts a break scheduled for a future minor', () => {
    const scheduled = dropped.map((violation) => ({
      id: violation.id,
      kind: violation.kind,
      in: '2.1.0',
      reason: 'retired'
    }))

    expect(reconcile(dropped, contract({ scheduled }))).toEqual([])
  })

  it('rejects scheduling a break into a patch release', () => {
    const scheduled = dropped.map((violation) => ({
      id: violation.id,
      kind: violation.kind,
      in: '2.0.9',
      reason: 'retired'
    }))

    expect(reconcile(dropped, contract({ scheduled })).join('\n')).toContain('not a minor release')
  })

  it('rejects a landed break scheduled for a minor the baseline already passed', () => {
    const scheduled = dropped.map((violation) => ({
      id: violation.id,
      kind: violation.kind,
      in: '2.0.0',
      reason: 'retired'
    }))

    expect(reconcile(dropped, contract({ scheduled })).join('\n')).toContain('is not above the baseline 2.0.8')
  })

  it('chases a scheduled break that its release shipped without', () => {
    const failures = reconcile(
      [],
      contract({
        baseline: { version: '2.1.0', snapshot: '0020_whatever' },
        scheduled: [{ id: 'user_provider.api_features', kind: 'column-removed', in: '2.1.0', reason: 'retired' }]
      })
    )

    expect(failures.join('\n')).toContain('2.1.0 shipped without this landing')
  })

  it('stops an acknowledged CHECK from covering a later edit of the same constraint', () => {
    const columns = BASELINE.tables.prompt.columns
    const narrowed = getDowngradeViolations(
      snapshot({ prompt: { columns, checkConstraints: { c: { value: "title IN ('a','b')" } } } }),
      snapshot({ prompt: { columns, checkConstraints: { c: { value: "title IN ('a')" } } } })
    )

    const failures = reconcile(
      narrowed,
      contract({
        acknowledged: [{ id: 'prompt.c', kind: 'check-changed', value: "title IN ('a','b','c')", reason: 'widened' }]
      })
    )

    expect(failures.join('\n')).toContain('no longer detected')
    expect(failures.join('\n')).toContain('CHECK `c` on `prompt`')
  })

  it('rejects an acknowledgement that no longer matches anything', () => {
    const failures = reconcile(
      [],
      contract({ acknowledged: [{ id: 'prompt.stale_check', kind: 'check-changed', reason: 'widened' }] })
    )

    expect(failures.join('\n')).toContain('no longer detected')
  })
})

describe('advanceBaseline', () => {
  const dropped = getDowngradeViolations(BASELINE, snapshot({ prompt: { columns: { id: { name: 'id' } } } }))
  const scheduled = dropped.map((violation) => ({
    id: violation.id,
    kind: violation.kind,
    in: '2.1.0',
    reason: 'retired'
  }))

  it('refuses to move the baseline onto a prerelease', () => {
    expect(() => advanceBaseline(contract(), { version: '2.1.0-rc.1', snapshot: '0018_head' }, [])).toThrow(
      'only a stable x.y.z release'
    )
  })

  it.each(['2.0.8', '2.0.7'])('refuses to move the baseline backward or onto itself (%s)', (version) => {
    expect(() => advanceBaseline(contract(), { version, snapshot: '0018_head' }, [])).toThrow(
      'must be newer than the current baseline 2.0.8'
    )
  })

  it('refuses to absorb an undisposed downgrade violation', () => {
    expect(() => advanceBaseline(contract(), { version: '2.1.0', snapshot: '0018_head' }, dropped)).toThrow(
      'has unresolved downgrade-compatibility violations'
    )
  })

  it('refuses to cut a patch release that carries a landed minor-scheduled break', () => {
    expect(() =>
      advanceBaseline(contract({ scheduled }), { version: '2.0.9', snapshot: '0018_head' }, dropped)
    ).toThrow('scheduled for 2.1.0')
  })

  it('refuses to cut the release a scheduled break was promised for while it is still missing', () => {
    expect(() => advanceBaseline(contract({ scheduled }), { version: '2.1.0', snapshot: '0018_head' }, [])).toThrow(
      'never landed'
    )
  })

  it('absorbs what the new baseline now contains and clears acknowledgements', () => {
    const changedCheck = getDowngradeViolations(
      snapshot({
        prompt: {
          columns: BASELINE.tables.prompt.columns,
          checkConstraints: { c: { value: "title IN ('a','b')" } }
        }
      }),
      snapshot({
        prompt: { columns: BASELINE.tables.prompt.columns, checkConstraints: { c: { value: "title IN ('a')" } } }
      })
    )
    const advanced = advanceBaseline(
      contract({
        scheduled: [...scheduled, { id: 'x.y', kind: 'column-removed', in: '2.2.0', reason: 'later' }],
        acknowledged: [{ id: 'prompt.c', kind: 'check-changed', value: "title IN ('a')", reason: 'reviewed' }]
      }),
      { version: '2.1.0', snapshot: '0018_head' },
      [...dropped, ...changedCheck]
    )

    expect(advanced).toEqual({
      baseline: { version: '2.1.0', snapshot: '0018_head' },
      scheduled: [{ id: 'x.y', kind: 'column-removed', in: '2.2.0', reason: 'later' }],
      acknowledged: []
    })
  })
})
