import { expect, it, vi } from 'vitest'

vi.mock('@pierre/highlights', () => {
  throw new Error('Metadata must not initialize the WASM engine')
})
const { CODE_LANGUAGES, CODE_THEME_NAMES, normalizeCodeLanguage } = await import('../../../code-highlight')
it('resolves language and theme metadata without initializing the engine', () => {
  expect(normalizeCodeLanguage(' Obj-C++ ')).toBe('objective-c')
  expect(CODE_LANGUAGES.typescript).toContain('ts')
  expect(CODE_THEME_NAMES).toContain('one-light')
})
