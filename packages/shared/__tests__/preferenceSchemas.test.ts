import { describe, expect, it } from 'vitest'

import type { PreferenceSchemas } from '../data/preference/preferenceSchemas'
import { DefaultPreferences } from '../data/preference/preferenceSchemas'

describe('DefaultPreferences', () => {
  it('uses flat file processing default keys', () => {
    const markdownConversionDefault: PreferenceSchemas['default']['feature.file_processing.default_markdown_conversion'] =
      null

    expect(markdownConversionDefault).toBeNull()
    expect(DefaultPreferences.default['feature.file_processing.default_markdown_conversion']).toBeNull()
    expect(DefaultPreferences.default['feature.file_processing.default_text_extraction']).toBeNull()
    expect('feature.file_processing.default.markdown_conversion' in DefaultPreferences.default).toBe(false)
    expect('feature.file_processing.default.text_extraction' in DefaultPreferences.default).toBe(false)
  })
})
