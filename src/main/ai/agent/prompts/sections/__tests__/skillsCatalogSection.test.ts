import type { Model, UniqueModelId } from '@shared/data/types/model'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { listCatalogMock } = vi.hoisted(() => ({ listCatalogMock: vi.fn() }))

vi.mock('@main/utils/prompt', () => ({
  replacePromptVariables: vi.fn(async (input: string) => input)
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('../../../../skills/catalog', () => ({
  listCatalog: listCatalogMock
}))

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'

import { buildSystemPrompt } from '../buildSystemPrompt'

const model = { id: 'x::y' as UniqueModelId, providerId: 'x', name: 'Y' } as Model

beforeEach(() => {
  MockMainPreferenceServiceUtils.setPreferenceValue('feature.system_prompt.output_style', 'default')
})

afterEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  vi.clearAllMocks()
})

describe('skillsCatalogSection', () => {
  /**
   * End-to-end contract: an empty skill catalog must produce no
   * `skills_catalog` section in the final prompt. We assert through
   * `buildSystemPrompt` rather than calling the contributor in
   * isolation because the real bug class is "section appears in the
   * prompt with empty content" — the surrounding builder filters
   * empty `text`, so a contributor that returns `{ text: '' }`
   * accidentally still survives at the section level. The section-
   * not-in-final-prompt assertion catches both shapes of regression.
   */
  it('does not emit a skills_catalog section when the catalog is empty', async () => {
    listCatalogMock.mockResolvedValue([])
    const sections = await buildSystemPrompt({ model })
    expect(sections.find((s) => s.id === 'skills_catalog')).toBeUndefined()
  })

  /**
   * Non-empty catalog renders alphabetically sorted, with long
   * descriptions truncated. Insertion-order output across node
   * versions and fs walk implementations would produce non-
   * deterministic prompts and bust prompt cache; truncation keeps
   * token cost bounded.
   */
  it('renders skills as XML <skill> entries inside <available-skills>, sorted with long descriptions truncated', async () => {
    listCatalogMock.mockResolvedValue([
      { name: 'gamma', description: 'g desc' },
      { name: 'alpha', description: 'a desc' },
      {
        name: 'beta',
        description: 'this is a very long description '.repeat(20)
      }
    ])
    const sections = await buildSystemPrompt({ model })
    const section = sections.find((s) => s.id === 'skills_catalog')
    expect(section).toBeDefined()
    if (!section) return
    const text = section.text
    // XML envelope (matches <deferred-tools> convention)
    expect(text).toContain('<available-skills>')
    expect(text).toContain('</available-skills>')
    // Each skill is its own <skill name="..."> child
    expect(text).toContain('<skill name="alpha">')
    expect(text).toContain('<skill name="beta">')
    expect(text).toContain('<skill name="gamma">')
    // Sorted: alpha < beta < gamma
    const aIdx = text.indexOf('name="alpha"')
    const bIdx = text.indexOf('name="beta"')
    const gIdx = text.indexOf('name="gamma"')
    expect(aIdx).toBeLessThan(bIdx)
    expect(bIdx).toBeLessThan(gIdx)
    // Truncation indicator present for the long description
    expect(text).toContain('…')
    // Long description must be cut to bounded size
    expect(text.length).toBeLessThan(2000)
  })
})
