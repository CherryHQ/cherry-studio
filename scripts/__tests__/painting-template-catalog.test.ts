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

const variableNames = (prompt: string) => [...prompt.matchAll(/\$\{([^{}]+)\}/g)].map((match) => match[1])

describe('painting template catalog contract', () => {
  it('keeps catalog IDs, localized templates, and WebP previews aligned', () => {
    const catalogIds = catalog.map((entry) => entry.id)
    const previews = catalog.map((entry) => entry.preview)

    expect(catalog.length).toBeGreaterThan(5)
    expect(new Set(catalogIds).size).toBe(catalogIds.length)
    expect(Object.keys(englishTemplates).sort()).toEqual([...catalogIds].sort())
    expect(Object.keys(chineseTemplates).sort()).toEqual([...catalogIds].sort())

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

  it('keeps every localized prompt tokenized with matching variable counts', () => {
    expect(new Set(Object.values(englishTemplates).map((template) => template.label)).size).toBe(catalog.length)
    expect(new Set(Object.values(chineseTemplates).map((template) => template.label)).size).toBe(catalog.length)

    for (const { id } of catalog) {
      const english = englishTemplates[id]
      const chinese = chineseTemplates[id]
      const englishVariables = variableNames(english.prompt)
      const chineseVariables = variableNames(chinese.prompt)

      expect(english.label.trim()).not.toHaveLength(0)
      expect(chinese.label.trim()).not.toHaveLength(0)
      expect(english.prompt.trim()).not.toHaveLength(0)
      expect(chinese.prompt.trim()).not.toHaveLength(0)
      expect(englishVariables.length).toBeGreaterThan(0)
      expect(chineseVariables).toHaveLength(englishVariables.length)
      expect(new Set(englishVariables).size).toBe(englishVariables.length)
      expect(new Set(chineseVariables).size).toBe(chineseVariables.length)
      expect(englishVariables.every((name) => /^[a-z][a-z0-9_]*$/.test(name))).toBe(true)
      expect(chineseVariables.every((name) => /\p{Script=Han}/u.test(name))).toBe(true)
      expect(english.prompt).not.toMatch(/\{argument\b|\[[A-Z][A-Z_ ]+\]/)
      expect(chinese.prompt).not.toMatch(/\{argument\b|\[[A-Z][A-Z_ ]+\]/)
    }
  })
})
