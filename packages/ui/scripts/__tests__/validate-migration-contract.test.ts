import { describe, expect, it } from 'vitest'

import { loadMigrationContractSources, validateMigrationContractSources } from '../validate-migration-contract'

describe('validateMigrationContractSources', () => {
  it('accepts the repository migration registry and compatibility bridges', async () => {
    const sources = await loadMigrationContractSources()

    expect(() => validateMigrationContractSources(sources)).not.toThrow()
  })

  it('rejects a compatibility alias that owns a value', async () => {
    const sources = await loadMigrationContractSources()

    expect(() =>
      validateMigrationContractSources({
        ...sources,
        legacyAliases: sources.legacyAliases.replace('var(--cs-text-primary)', '#111')
      })
    ).toThrow('must be a single canonical var() alias')
  })

  it('rejects a compatibility alias outside the canonical contract', async () => {
    const sources = await loadMigrationContractSources()

    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTheme: sources.rendererTheme.replace('var(--cs-icon)', 'var(--cs-unknown-role)')
      })
    ).toThrow('points outside the canonical contract')
  })
})
