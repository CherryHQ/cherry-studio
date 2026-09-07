import { describe, expect, it } from 'vitest'

import { getCompatibilityPolicyViolations } from '../compatibilityPolicy'

const baseline = (entries: Array<[number, string]>) => new Map(entries)

describe('provider-registry compatibility baseline policy', () => {
  it('accepts the initial v1 baseline', () => {
    expect(
      getCompatibilityPolicyViolations({
        baseVersion: null,
        currentVersion: 1,
        baseBaselines: baseline([]),
        currentBaselines: baseline([[1, 'v1']])
      })
    ).toEqual([])
  })

  it('accepts an unchanged version only when its frozen baseline is unchanged', () => {
    expect(
      getCompatibilityPolicyViolations({
        baseVersion: 1,
        currentVersion: 1,
        baseBaselines: baseline([[1, 'v1']]),
        currentBaselines: baseline([[1, 'v1']])
      })
    ).toEqual([])

    expect(
      getCompatibilityPolicyViolations({
        baseVersion: 1,
        currentVersion: 1,
        baseBaselines: baseline([[1, 'v1']]),
        currentBaselines: baseline([[1, 'rewritten']])
      })
    ).toContain('compat/v1-validator.mjs is frozen and must not be modified')
  })

  it('accepts a one-step bump with one new baseline while preserving history', () => {
    expect(
      getCompatibilityPolicyViolations({
        baseVersion: 1,
        currentVersion: 2,
        baseBaselines: baseline([[1, 'v1']]),
        currentBaselines: baseline([
          [1, 'v1'],
          [2, 'v2']
        ])
      })
    ).toEqual([])
  })

  it('rejects skipped versions, missing baselines, and changes to historical baselines', () => {
    expect(
      getCompatibilityPolicyViolations({
        baseVersion: 1,
        currentVersion: 3,
        baseBaselines: baseline([[1, 'v1']]),
        currentBaselines: baseline([
          [1, 'v1'],
          [3, 'v3']
        ])
      })
    ).toContain('REGISTRY_SCHEMA_VERSION must stay at 1 or increase to 2, received 3')

    expect(
      getCompatibilityPolicyViolations({
        baseVersion: 1,
        currentVersion: 2,
        baseBaselines: baseline([[1, 'v1']]),
        currentBaselines: baseline([[1, 'v1']])
      })
    ).toContain('compat/v2-validator.mjs is required for REGISTRY_SCHEMA_VERSION 2')

    expect(
      getCompatibilityPolicyViolations({
        baseVersion: 1,
        currentVersion: 2,
        baseBaselines: baseline([[1, 'v1']]),
        currentBaselines: baseline([
          [1, 'rewritten'],
          [2, 'v2']
        ])
      })
    ).toContain('compat/v1-validator.mjs is frozen and must not be modified')
  })
})
