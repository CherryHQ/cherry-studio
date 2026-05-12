import { describe, expect, it } from 'vitest'

import type { PreferenceSchemas } from '../data/preference/preferenceSchemas'
import { DefaultPreferences } from '../data/preference/preferenceSchemas'

describe('DefaultPreferences', () => {
  it('uses flat file processing default keys', () => {
    const markdownConversionDefault: PreferenceSchemas['default']['feature.file_processing.default_document_to_markdown'] =
      null

    expect(markdownConversionDefault).toBeNull()
    expect(DefaultPreferences.default['feature.file_processing.default_document_to_markdown']).toBeNull()
    expect(DefaultPreferences.default['feature.file_processing.default_image_to_text']).toBeNull()
    expect('feature.file_processing.default.document_to_markdown' in DefaultPreferences.default).toBe(false)
    expect('feature.file_processing.default.image_to_text' in DefaultPreferences.default).toBe(false)
  })

  it('requires users to choose URL fetch web search provider by default', () => {
    const fetchUrlsDefault: PreferenceSchemas['default']['chat.web_search.default_fetch_urls_provider'] = null

    expect(fetchUrlsDefault).toBeNull()
    expect(DefaultPreferences.default['chat.web_search.default_fetch_urls_provider']).toBeNull()
  })
})
