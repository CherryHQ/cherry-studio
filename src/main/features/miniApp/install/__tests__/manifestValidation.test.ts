import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { MiniAppDistributionManifestSchema, MiniAppManifestSchema } from '@shared/types/miniAppManifest'

import { formatManifestValidationError } from '../manifestValidation'

const packaged = {
  id: 'com.example.manifesterror',
  name: 'Example',
  description: 'Example app.',
  version: '1.0.0',
  entry: 'index.html'
}
const distribution = {
  ...packaged,
  update: { url: 'https://example.com/manifest.json' },
  package: { url: 'https://example.com/app.miniapp', sha256: 'a'.repeat(64), size: 1024 }
}

type ManifestMutation = (manifest: Record<string, unknown>) => void

beforeEach(() => {
  MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
})

describe('archive manifest validation errors', () => {
  it.each<[string, ManifestMutation, string]>([
    [
      'long description',
      (m) => {
        m.description = 'x'.repeat(201)
      },
      'manifest.json: `description` must be at most 200 characters.'
    ],
    [
      'long name',
      (m) => {
        m.name = 'x'.repeat(65)
      },
      'manifest.json: `name` must be at most 64 characters.'
    ],
    [
      'empty description',
      (m) => {
        m.description = ''
      },
      'manifest.json: `description` must not be empty.'
    ],
    [
      'empty name',
      (m) => {
        m.name = ''
      },
      'manifest.json: `name` must not be empty.'
    ],
    [
      'missing name',
      (m) => {
        delete m.name
      },
      'manifest.json: `name` must be text or an object of text values with "en" or "zh".'
    ],
    [
      'non-text localized name',
      (m) => {
        m.name = { en: 123 }
      },
      'manifest.json: `name` must be text or an object of text values with "en" or "zh".'
    ],
    [
      'long localized name',
      (m) => {
        m.name = { en: 'x'.repeat(65) }
      },
      'manifest.json: `name.en` must be at most 64 characters.'
    ],
    [
      'long release notes',
      (m) => {
        m.releaseNotes = 'x'.repeat(501)
      },
      'manifest.json: `releaseNotes` must be at most 500 characters.'
    ],
    [
      'invalid version',
      (m) => {
        m.version = 'not-semver'
      },
      'manifest.json: `version`: version must be valid semver'
    ],
    [
      'unknown permission',
      (m) => {
        m.permissions = ['fs.read']
      },
      'manifest.json: `permissions.0`: must be a known method (e.g. "file.save") or namespace wildcard (e.g. "file.*")'
    ],
    [
      'multiple issues',
      (m) => {
        m.name = 'x'.repeat(65)
        m.description = 'x'.repeat(201)
      },
      'manifest.json: `name` must be at most 64 characters.'
    ],
    [
      'too many permissions',
      (m) => {
        m.permissions = Array(33).fill('file.save')
      },
      'manifest.json: `permissions`: Too big: expected array to have <=32 items'
    ],
    [
      'missing fallback locale',
      (m) => {
        m.name = { fr: 'Bonjour' }
      },
      'manifest.json: `name`: a localized field must provide at least one of "en" or "zh"'
    ],
    [
      'invalid network host',
      (m) => {
        m.network = ['not a host']
        m.permissions = ['network.fetch']
      },
      'manifest.json: `network.0`: must be a bare hostname'
    ]
  ])('reports %s', (_label, mutate, expected) => {
    const input: Record<string, unknown> = structuredClone(packaged)
    mutate(input)
    const parsed = MiniAppManifestSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected manifest validation to fail')
    expect(formatManifestValidationError(parsed.error, 'archive')).toBe(expected)
  })

  it('preserves a root-level issue message', () => {
    const parsed = MiniAppManifestSchema.safeParse(null)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected manifest validation to fail')
    expect(formatManifestValidationError(parsed.error, 'archive')).toBe(
      'manifest.json: Invalid input: expected object, received null'
    )
  })

  it('keeps missing-name errors eligible for the localized-text message', () => {
    const input: Record<string, unknown> = structuredClone(packaged)
    delete input.name
    const parsed = MiniAppManifestSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected manifest validation to fail')
    expect(parsed.error.issues[0].code).toBe('invalid_union')
    expect(parsed.error.issues[0].path).toEqual(['name'])
  })

  it('accepts a localized name with only the English fallback', () => {
    const input = { ...structuredClone(packaged), name: { en: 'Example' } }
    expect(MiniAppManifestSchema.safeParse(input).success).toBe(true)
  })
})

describe('distribution manifest validation errors', () => {
  it.each<[string, ManifestMutation, string]>([
    [
      'long description',
      (m) => {
        m.description = 'x'.repeat(201)
      },
      '`description` must be at most 200 characters.'
    ],
    [
      'long name',
      (m) => {
        m.name = 'x'.repeat(65)
      },
      '`name` must be at most 64 characters.'
    ],
    [
      'empty description',
      (m) => {
        m.description = ''
      },
      '`description` must not be empty.'
    ],
    [
      'missing name',
      (m) => {
        delete m.name
      },
      '`name` must be text or an object of text values with "en" or "zh".'
    ],
    [
      'missing package',
      (m) => {
        delete m.package
      },
      '`package`: Invalid input: expected object, received undefined'
    ],
    [
      'zero package size',
      (m) => {
        ;(m.package as typeof distribution.package).size = 0
      },
      '`package.size`: Too small: expected number to be >0'
    ]
  ])('reports %s without an archive filename', (_label, mutate, expected) => {
    const input: Record<string, unknown> = structuredClone(distribution)
    mutate(input)
    const parsed = MiniAppDistributionManifestSchema.safeParse(input)
    expect(parsed.success).toBe(false)
    if (parsed.success) throw new Error('Expected manifest validation to fail')
    expect(formatManifestValidationError(parsed.error, 'distribution')).toBe(expected)
  })
})
