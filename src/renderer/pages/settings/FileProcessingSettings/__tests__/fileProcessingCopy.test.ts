import { describe, expect, it } from 'vitest'

import enUs from '@renderer/i18n/locales/en-us.json'
import jaJp from '@renderer/i18n/locales/ja-jp.json'

const catalogs = import.meta.glob<Record<string, string>>('../../../../i18n/locales/*.json', {
  eager: true,
  import: 'default'
})

const scopeKeys = [
  'settings.tool.file_processing.reset_options',
  'settings.tool.file_processing.features.image_to_text.tooltip',
  'settings.tool.file_processing.features.document_to_markdown.tooltip'
] as const

describe('file-processing scope copy', () => {
  it('separates image defaults from overlay OCR and per-base document selection', () => {
    expect(enUs[scopeKeys[1]]).toContain('Screenshot overlay text recognition uses its own OCR')
    expect(enUs[scopeKeys[2]]).toContain('Knowledge bases select their own processor')
    expect(enUs[scopeKeys[2]]).toContain('options configured here')
    expect(enUs[scopeKeys[2]]).toContain('Agents use this processor only as a fallback for scanned PDFs')
    expect(jaJp['settings.tool.file_processing.reset_options_confirm']).toContain('そのキー')
  })

  it('translates reset labels and scope tooltips in every renderer locale', () => {
    expect(Object.keys(catalogs)).toHaveLength(18)
    for (const [path, catalog] of Object.entries(catalogs)) {
      if (path.endsWith('/en-us.json')) continue
      for (const key of scopeKeys) {
        expect(catalog[key], `${path}: ${key}`).toBeTruthy()
        expect(catalog[key], `${path}: ${key}`).not.toBe(enUs[key])
      }
    }
  })
})
