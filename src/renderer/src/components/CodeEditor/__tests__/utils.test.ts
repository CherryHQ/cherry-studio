import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getNormalizedExtension } from '../utils'

const mocks = vi.hoisted(() => ({
  getExtensionByLanguage: vi.fn()
}))

vi.mock('@renderer/utils/code-language', () => ({
  getExtensionByLanguage: mocks.getExtensionByLanguage
}))

describe('getNormalizedExtension', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return custom mapping for custom language', async () => {
    mocks.getExtensionByLanguage.mockReturnValue(undefined)
    await expect(getNormalizedExtension('svg')).resolves.toBe('xml')
    await expect(getNormalizedExtension('SVG')).resolves.toBe('xml')
  })

  it('should prefer custom mapping when both custom and linguist exist', async () => {
    mocks.getExtensionByLanguage.mockReturnValue('.svg')
    await expect(getNormalizedExtension('svg')).resolves.toBe('xml')
  })

  it('should return linguist mapping when available (strip leading dot)', async () => {
    mocks.getExtensionByLanguage.mockReturnValue('.ts')
    await expect(getNormalizedExtension('TypeScript')).resolves.toBe('ts')
  })

  it('should return extension when input already looks like extension (leading dot)', async () => {
    mocks.getExtensionByLanguage.mockReturnValue(undefined)
    await expect(getNormalizedExtension('.json')).resolves.toBe('json')
  })

  it('should return language as-is when no rules matched', async () => {
    mocks.getExtensionByLanguage.mockReturnValue(undefined)
    await expect(getNormalizedExtension('unknownLanguage')).resolves.toBe('unknownLanguage')
  })
})
