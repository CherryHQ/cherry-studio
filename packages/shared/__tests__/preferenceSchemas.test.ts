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

  describe('llm model and assistant preference keys', () => {
    it('has model id keys with null defaults (nullable FK references)', () => {
      expect(DefaultPreferences.default['chat.default_model_id']).toBeNull()
      expect(DefaultPreferences.default['topic.naming.model_id']).toBeNull()
      expect(DefaultPreferences.default['feature.quick_assistant.model_id']).toBeNull()
      expect(DefaultPreferences.default['feature.translate.model_id']).toBeNull()
    })

    it('has quickAssistantId with empty string default', () => {
      expect(DefaultPreferences.default['feature.quick_assistant.id']).toBe('')
    })
  })
})
