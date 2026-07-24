import { beforeAll, describe, expect, it } from 'vitest'

import { parseMigrationRegistry } from '../migration-registry'
import { CHERRY_PRODUCT_VARIABLE_TOKENS } from '../theme-contract'
import {
  loadMigrationContractSources,
  type MigrationContractSources,
  validateMigrationContractSources
} from '../validate-migration-contract'

interface MutableMigrationRule {
  source: unknown
  target: unknown
  strategy: unknown
  [key: string]: unknown
}

interface MutableMigrationRegistry {
  version: unknown
  contract: unknown
  defaultKind: unknown
  exclude: unknown[]
  rules: MutableMigrationRule[]
}

function mutateRegistry(
  sources: MigrationContractSources,
  mutate: (registry: MutableMigrationRegistry) => void
): MigrationContractSources {
  const registry = JSON.parse(sources.migrationRegistry) as MutableMigrationRegistry
  mutate(registry)
  return { ...sources, migrationRegistry: JSON.stringify(registry) }
}

describe('validateMigrationContractSources', () => {
  let sources: MigrationContractSources

  beforeAll(async () => {
    sources = await loadMigrationContractSources()
  })

  it('accepts the repository migration registry after compatibility bridge removal', () => {
    expect(sources.legacyAliases).toBe('')
    expect(sources.rendererTheme).not.toContain('--app-')
    expect(() => validateMigrationContractSources(sources)).not.toThrow()
  })

  it('rejects invalid registry JSON', () => {
    expect(() => validateMigrationContractSources({ ...sources, migrationRegistry: '{' })).toThrow(
      /migration registry is not valid JSON/
    )
  })

  it('rejects an invalid registry top-level shape', () => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        migrationRegistry: JSON.stringify({ version: 1, contract: 'shadcn-v2', exclude: [], rules: {} })
      })
    ).toThrow(/invalid top-level shape/)
  })

  it('rejects invalid registry metadata', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.version = '1'
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/registry metadata is invalid/)
  })

  it('rejects invalid migration rule shapes', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].source = 1
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/migration rule 0 has an invalid shape/)
  })

  it('rejects invalid migration source names', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].source = '--legacyVariable'
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/invalid migration source --legacyVariable/)
  })

  it('rejects duplicate migration sources', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules.push({ ...registry.rules[0] })
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/duplicate migration source/)
  })

  it('rejects unknown migration strategies', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].strategy = 'rename'
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/uses unknown migration strategy rename/)
  })

  it('requires exact migrations to have a target', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].strategy = 'exact'
      registry.rules[0].target = null
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/exact migration .* requires a target/)
  })

  it('rejects invalid migration target names', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].target = '--canonicalVariable'
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(
      /invalid migration target --canonicalVariable/
    )
  })

  it('rejects targets outside the canonical contract', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].target = '--not-canonical'
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/points outside the canonical contract/)
  })

  it('rejects self-targeting migrations', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.rules[0].target = registry.rules[0].source
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(/cannot target itself/)
  })

  it('requires every scanner exclusion', () => {
    const invalidSources = mutateRegistry(sources, (registry) => {
      registry.exclude = registry.exclude.filter((entry) => entry !== 'packages/ui/src/styles/theme.css')
    })

    expect(() => validateMigrationContractSources(invalidSources)).toThrow(
      /must exclude packages\/ui\/src\/styles\/theme\.css/
    )
  })

  it('keeps preserve rules explicit and currently empty', () => {
    const registry = parseMigrationRegistry(sources.migrationRegistry)

    expect(registry.rules.filter((rule) => rule.strategy === 'preserve')).toEqual([])
  })

  it('migrates the former prefixed product API to the unprefixed public contract', () => {
    const registry = JSON.parse(sources.migrationRegistry) as {
      rules: Array<{ source: string; target: string | null; strategy: string }>
    }

    for (const token of CHERRY_PRODUCT_VARIABLE_TOKENS) {
      expect(registry.rules).toContainEqual({
        source: `--cs-${token}`,
        target: `--${token}`,
        strategy: 'exact'
      })
    }
  })

  it('keeps renderer Sidebar effects out of the shared migration contract', () => {
    const registry = JSON.parse(sources.migrationRegistry) as {
      rules: Array<{ source: string; target: string | null; strategy: string }>
    }

    for (const source of [
      '--cs-sidebar-active-bg',
      '--cs-sidebar-active-border',
      '--cs-sidebar-glow-bg',
      '--cs-sidebar-glow-line',
      '--app-sidebar-active-bg',
      '--app-sidebar-active-border',
      '--app-sidebar-glow-bg',
      '--app-sidebar-glow-line'
    ]) {
      expect(registry.rules).toContainEqual(expect.objectContaining({ source, target: null, strategy: 'review' }))
    }
  })

  it('rejects a recreated legacy compatibility layer', () => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        legacyAliases: ':root { --color-text-1: #111; }'
      })
    ).toThrow('legacy compatibility layer must remain removed')
  })

  it('keeps host-local variables out of the renderer theme entry', () => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTheme: `${sources.rendererTheme}\n:root { --app-icon: var(--cs-unknown-role); }`
      })
    ).toThrow('renderer theme entry cannot own --app-* variables')
  })

  it('rejects a second renderer Tailwind adapter', () => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTheme: `${sources.rendererTheme}\n@theme inline { --color-example: red; }`
      })
    ).toThrow('must use the shared generated Tailwind adapter')
  })

  it.each(['.example { color: var(--color-primary); }', ':root { --color-example: var(--primary); }'])(
    'keeps Tailwind adapter variables out of renderer styles',
    (rendererStyle) => {
      expect(() =>
        validateMigrationContractSources({
          ...sources,
          rendererStyles: {
            'example.css': rendererStyle
          }
        })
      ).toThrow('cannot use Tailwind adapter variable')
    }
  )

  it.each([
    ['example.ts', "const color = 'var(--color-primary)'"],
    ['example.tsx', 'const Example = () => <div style={{ color: "var(--color-primary)" }} />'],
    ['example.ts', 'const variable = `--color-${token}`']
  ])('keeps Tailwind adapter variables out of renderer TypeScript sources', (fileName, rendererSource) => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTypeScriptSources: {
          [fileName]: rendererSource
        }
      })
    ).toThrow('cannot use Tailwind adapter variable')
  })

  it.each(['--cs-user-font-family', '--primary'])(
    'rejects renderer writes to unregistered shared theme variable %s',
    (variable) => {
      expect(() =>
        validateMigrationContractSources({
          ...sources,
          rendererTypeScriptSources: {
            'example.ts': `document.documentElement.style.setProperty('${variable}', 'value')`
          }
        })
      ).toThrow('cannot write shared theme variable')
    }
  )

  it('allows registered shared inputs and renderer-owned runtime writes', () => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTypeScriptSources: {
          'example.ts': `
            document.documentElement.style.setProperty('--cs-theme-primary', '#00b96b')
            document.documentElement.style.setProperty('--app-user-font-family', 'Inter')
          `
        }
      })
    ).not.toThrow()
  })

  it('allows renderer comments, Tailwind utilities, and runtime semantic variables', () => {
    expect(() =>
      validateMigrationContractSources({
        ...sources,
        rendererTypeScriptSources: {
          'example.tsx': `
            // var(--color-primary) is an adapter implementation detail.
            /* Never assign --color-example from renderer code. */
            const Example = () => <div className="text-primary" style={{ color: 'var(--primary)' }} />
          `
        }
      })
    ).not.toThrow()
  })
})
