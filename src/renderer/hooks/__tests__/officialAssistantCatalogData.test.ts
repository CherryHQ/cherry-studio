import { describe, expect, it } from 'vitest'

import agentsEn from '../../../../resources/data/agents-en.json'
import agentsZh from '../../../../resources/data/agents-zh.json'

const BRAND_NAMES = ['Claude', 'ChatGPT', 'Gemini', 'DeepSeek', 'Kimi', 'Doubao']

type CatalogEntry = {
  id: string
  name: string
  description?: string
  prompt?: string
  officialVendor?: string
}

function officialEntries(entries: CatalogEntry[]) {
  return entries.filter((entry) => entry.officialVendor)
}

describe('official assistant catalog data', () => {
  it('ships the six branded presets with stable identities in both catalogs', () => {
    const english = officialEntries(agentsEn)
    const chinese = officialEntries(agentsZh)

    expect(english.map((entry) => entry.name)).toEqual(BRAND_NAMES)
    expect(chinese.map((entry) => entry.name)).toEqual(BRAND_NAMES)
    expect(chinese.map((entry) => entry.id)).toEqual(english.map((entry) => entry.id))
    expect(chinese.map((entry) => entry.description)).not.toEqual(english.map((entry) => entry.description))
  })

  it.each([
    ['English', agentsEn],
    ['Chinese', agentsZh]
  ] as const)('keeps dates and UI language dynamic in the %s prompts', (_, entries) => {
    for (const entry of officialEntries(entries)) {
      expect(entry.prompt).toContain('{{date}}')
      expect(entry.prompt).toContain('{{language}}')
      expect(entry.prompt).not.toMatch(/\b20\d{2}\b/)
    }
  })
})
