import { describe, expect, it } from 'vitest'

import agentsEn from '../../../../resources/data/agents-en.json'
import agentsZh from '../../../../resources/data/agents-zh.json'

const EXPECTED_IDENTITIES = [
  { id: '7a65fb18-8fa8-4b71-9dcb-5b3ce319d0d1', name: 'Claude', officialVendor: 'anthropic' },
  { id: '87bf2bd5-88c9-4ea7-984f-7c75d4e70244', name: 'ChatGPT', officialVendor: 'openai' },
  { id: '984168e8-805e-4b43-9018-d4bd0f4c5515', name: 'Gemini', officialVendor: 'gemini' },
  { id: 'a3b811bc-bd5c-4f55-9d73-18cb53ff404f', name: 'DeepSeek', officialVendor: 'deepseek' },
  { id: 'b76d4a0f-09a7-48e9-894f-681552a9bca3', name: 'Kimi', officialVendor: 'kimi' },
  { id: 'c983559a-53fb-4a83-8142-d59c794681ff', name: 'Doubao', officialVendor: 'doubao' }
] as const

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
    const identities = (entries: CatalogEntry[]) =>
      entries.map(({ id, name, officialVendor }) => ({ id, name, officialVendor }))

    expect(identities(english)).toEqual(EXPECTED_IDENTITIES)
    expect(identities(chinese)).toEqual(EXPECTED_IDENTITIES)
  })

  it('provides a distinct non-empty description for every English and Chinese preset', () => {
    for (const { id } of EXPECTED_IDENTITIES) {
      const englishDescription = officialEntries(agentsEn)
        .find((entry) => entry.id === id)
        ?.description?.trim()
      const chineseDescription = officialEntries(agentsZh)
        .find((entry) => entry.id === id)
        ?.description?.trim()

      expect(englishDescription).toBeTruthy()
      expect(chineseDescription).toBeTruthy()
      expect(chineseDescription).not.toBe(englishDescription)
    }
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
