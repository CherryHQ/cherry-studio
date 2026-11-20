import { describe, expect, it, vi } from 'vitest'

import enUS from '@renderer/i18n/locales/en-us.json'
import zhCN from '@renderer/i18n/locales/zh-cn.json'
import { createPaintingGenerateError } from '@shared/ai/paintingGenerateError'

const mocks = vi.hoisted(() => ({ catalog: {} as Record<string, string> }))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string, values?: Record<string, string>) =>
      (mocks.catalog[key] ?? key).replace(/{{(\w+)}}/g, (_m, name: string) => values?.[name] ?? '')
  }
}))
vi.mock('@renderer/services/popup', () => ({ popup: { error: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

import { translatePaintingGenerateError } from '../paintingGenerateError'

describe('translatePaintingGenerateError NO_USABLE_IMAGE', () => {
  it.each([
    ['zh-CN', zhCN as Record<string, string>],
    ['en-US', enUS as Record<string, string>]
  ])('translates the billing warning with the model under %s', (_name, catalog) => {
    mocks.catalog = catalog
    const message = translatePaintingGenerateError(
      createPaintingGenerateError('NO_USABLE_IMAGE', { values: { model: 'gpt-image-1' } })
    )
    expect(message).toBe(catalog['paintings.no_usable_image'].replace('{{model}}', 'gpt-image-1'))
    expect(message).toContain('gpt-image-1')
    expect(message).not.toContain('completed upstream')
  })
})
