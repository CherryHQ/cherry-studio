import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNormalizedExtension } from '../utils'

const hoisted = vi.hoisted(() => ({
  languages: {
    svg: { extensions: ['.svg'] },
    TypeScript: { extensions: ['.ts'] }
  }
}))

vi.mock('@shared/config/languages', () => ({
  languages: hoisted.languages
}))

describe('getNormalizedExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return custom mapping for custom language', async () => {
    await expect(getNormalizedExtension('svg')).resolves.toBe('xml')
    await expect(getNormalizedExtension('SVG')).resolves.toBe('xml')
  })

  it('should prefer custom mapping when both custom and linguist exist', async () => {
    await expect(getNormalizedExtension('svg')).resolves.toBe('xml')
  })

  it('should return linguist mapping when available (strip leading dot)', async () => {
    await expect(getNormalizedExtension('TypeScript')).resolves.toBe('ts')
  })

  it('should return extension when input already looks like extension (leading dot)', async () => {
    await expect(getNormalizedExtension('.json')).resolves.toBe('json')
  })

  it('should return language as-is when no rules matched', async () => {
    await expect(getNormalizedExtension('unknownLanguage')).resolves.toBe('unknownLanguage')
  })
})
