import * as fs from 'node:fs'
import * as path from 'node:path'

import { describe, expect, it } from 'vitest'

type CatalogEntry = {
  id: string
  preview: string
}

type LocalizedTemplate = {
  label: string
  prompt: string
}

const root = path.resolve(__dirname, '..', '..')
const catalogRoot = path.join(root, 'resources', 'data', 'painting-templates')
const catalog = JSON.parse(fs.readFileSync(path.join(catalogRoot, 'catalog.json'), 'utf8')) as CatalogEntry[]
const englishTemplates = JSON.parse(fs.readFileSync(path.join(catalogRoot, 'locales', 'en-us.json'), 'utf8')) as Record<
  string,
  LocalizedTemplate
>
const chineseTemplates = JSON.parse(fs.readFileSync(path.join(catalogRoot, 'locales', 'zh-cn.json'), 'utf8')) as Record<
  string,
  LocalizedTemplate
>

const variableValues = (prompt: string) => [...prompt.matchAll(/\$\{([^{}]+)\}/g)].map((match) => match[1])

const genericVariableLabels = new Set([
  'action',
  'age',
  'author',
  'color',
  'destination',
  'direction',
  'dress',
  'expression',
  'interaction',
  'location',
  'mood',
  'outfit',
  'pet',
  'pose',
  'quote',
  'scene',
  'subject',
  'tagline',
  'texture',
  'theme',
  'title',
  'traveler',
  '人物',
  '动作',
  '场景',
  '年龄',
  '手持物',
  '新人姓名',
  '服装',
  '标题',
  '配色'
])

const isConcreteVariableValue = (value: string) =>
  value === value.trim() &&
  !/[\r\n{}]/.test(value) &&
  !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/.test(value) &&
  !genericVariableLabels.has(value)

const expectedVariableCounts: Record<string, number> = {
  'human-fragments-motion': 9,
  'human-fragments-sport': 9,
  'laundromat-dance': 6,
  'underwater-editorial': 8,
  'wuxia-swordswoman': 6,
  'literary-art-poster': 8,
  'tuscan-residence': 5,
  'summer-hillside': 6,
  'slow-shutter-fashion': 8,
  'crocs-campaign': 9,
  'tennis-collage': 10,
  'deadpan-cat': 5,
  'monochrome-suit': 5,
  'circular-cutout': 6,
  'travel-journal': 6,
  'wedding-invitation': 10,
  'storyboard-sketch': 6,
  'anime-companion': 5,
  'doodle-shadow': 4,
  'y2k-street': 7,
  'birthday-poster': 9,
  'light-trails': 7,
  'anime-companion-variant': 5,
  'train-window': 8,
  'low-angle-fashion': 7
}

describe('painting template catalog contract', () => {
  it('keeps catalog IDs, localized templates, and WebP previews aligned', () => {
    const catalogIds = catalog.map((entry) => entry.id)
    const previews = catalog.map((entry) => entry.preview)

    expect(catalog.length).toBeGreaterThan(5)
    expect(new Set(catalogIds).size).toBe(catalogIds.length)
    expect(Object.keys(englishTemplates).sort()).toEqual([...catalogIds].sort())
    expect(Object.keys(chineseTemplates).sort()).toEqual([...catalogIds].sort())
    expect(Object.keys(expectedVariableCounts).sort()).toEqual([...catalogIds].sort())

    for (const { id, preview } of catalog) {
      expect(id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      expect(preview).toBe(`images/${id}.webp`)

      const image = fs.readFileSync(path.join(catalogRoot, preview))
      expect(image.subarray(0, 4).toString()).toBe('RIFF')
      expect(image.subarray(8, 12).toString()).toBe('WEBP')
    }

    const bundledPreviews = fs
      .readdirSync(path.join(catalogRoot, 'images'))
      .filter((file) => file.endsWith('.webp'))
      .map((file) => `images/${file}`)
      .sort()

    expect([...previews].sort()).toEqual(bundledPreviews)
  })

  it('keeps every localized prompt tokenized with matching concrete example values', () => {
    expect(new Set(Object.values(englishTemplates).map((template) => template.label)).size).toBe(catalog.length)
    expect(new Set(Object.values(chineseTemplates).map((template) => template.label)).size).toBe(catalog.length)

    let englishVariableCount = 0
    let chineseVariableCount = 0

    for (const { id } of catalog) {
      const english = englishTemplates[id]
      const chinese = chineseTemplates[id]
      const englishVariables = variableValues(english.prompt)
      const chineseVariables = variableValues(chinese.prompt)

      expect(english.label.trim()).not.toHaveLength(0)
      expect(chinese.label.trim()).not.toHaveLength(0)
      expect(english.prompt.trim()).not.toHaveLength(0)
      expect(chinese.prompt.trim()).not.toHaveLength(0)
      expect(englishVariables.length).toBeGreaterThan(0)
      expect(englishVariables).toHaveLength(expectedVariableCounts[id])
      expect(chineseVariables).toHaveLength(englishVariables.length)
      expect(new Set(englishVariables).size).toBe(englishVariables.length)
      expect(new Set(chineseVariables).size).toBe(chineseVariables.length)
      expect(englishVariables.every(isConcreteVariableValue)).toBe(true)
      expect(chineseVariables.every(isConcreteVariableValue)).toBe(true)
      expect(english.prompt).not.toMatch(/\{argument\b|\[[A-Z][A-Z_ ]+\]/)
      expect(chinese.prompt).not.toMatch(/\{argument\b|\[[A-Z][A-Z_ ]+\]/)
      expect(english.prompt).not.toMatch(/\$\{[^{}\r\n]*[.!?。！？]\}[.!?。！？]/u)
      expect(chinese.prompt).not.toMatch(/\$\{[^{}\r\n]*[.!?。！？]\}[.!?。！？]/u)
      expect(english.prompt).not.toContain('Suggested defaults')
      expect(chinese.prompt).not.toContain('建议默认')

      englishVariableCount += englishVariables.length
      chineseVariableCount += chineseVariables.length
    }

    expect(englishVariableCount).toBe(174)
    expect(chineseVariableCount).toBe(174)
    expect(englishTemplates['wedding-invitation'].prompt).toContain('${Lin Zhao & Shen Zhiyi}')
    expect(chineseTemplates['wedding-invitation'].prompt).toContain('${Lin Zhao & Shen Zhiyi}')
    expect(englishTemplates['birthday-poster'].prompt).toContain('${2}')
    expect(chineseTemplates['birthday-poster'].prompt).toContain('${2}')
    expect(variableValues(englishTemplates['storyboard-sketch'].prompt)[2]).toContain('watching the horizon')
    expect(variableValues(chineseTemplates['storyboard-sketch'].prompt)[2]).toContain('眺望远方')
  })
})
