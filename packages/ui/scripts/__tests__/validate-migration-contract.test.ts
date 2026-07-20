import { describe, expect, it } from 'vitest'

import { loadMigrationContractSources, validateMigrationContractSources } from '../validate-migration-contract'

describe('validateMigrationContractSources', () => {
  it('accepts the repository migration registry after compatibility bridge removal', async () => {
    const sources = await loadMigrationContractSources()

    expect(sources.legacyAliases).toBe('')
    expect(sources.rendererTheme).not.toContain('--app-')
    expect(() => validateMigrationContractSources(sources)).not.toThrow()
  })

  it('rejects a recreated legacy compatibility layer', async () => {
    const sources = await loadMigrationContractSources()

    expect(() =>
      validateMigrationContractSources({
        ...sources,
        legacyAliases: ':root { --color-text-1: #111; }'
      })
    ).toThrow('legacy compatibility layer must remain removed')
  })

  it('rejects recreated renderer app aliases', async () => {
    const sources = await loadMigrationContractSources()

    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTheme: `${sources.rendererTheme}\n:root { --app-icon: var(--cs-unknown-role); }`
      })
    ).toThrow('renderer app compatibility aliases must remain removed')
  })

  it('rejects a second renderer Tailwind adapter', async () => {
    const sources = await loadMigrationContractSources()

    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTheme: `${sources.rendererTheme}\n@theme inline { --color-example: red; }`
      })
    ).toThrow('must use the shared generated Tailwind adapter')
  })
})
