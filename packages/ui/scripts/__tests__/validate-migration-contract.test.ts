import { beforeAll, describe, expect, it } from 'vitest'

import { CHERRY_PRODUCT_VARIABLE_TOKENS } from '../theme-contract'
import {
  loadMigrationContractSources,
  type MigrationContractSources,
  validateMigrationContractSources
} from '../validate-migration-contract'

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
