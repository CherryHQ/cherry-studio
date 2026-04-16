import { describe, expect, it } from 'vitest'

import { REDUX_STORE_MAPPINGS } from '../PreferencesMappings'

describe('PreferencesMappings', () => {
  it('uses flat file processing default target keys', () => {
    expect(REDUX_STORE_MAPPINGS.preprocess).toContainEqual({
      originalKey: 'defaultProvider',
      targetKey: 'feature.file_processing.default_markdown_conversion'
    })

    expect(REDUX_STORE_MAPPINGS.ocr).toContainEqual({
      originalKey: 'imageProviderId',
      targetKey: 'feature.file_processing.default_text_extraction'
    })

    expect(REDUX_STORE_MAPPINGS.preprocess).not.toContainEqual({
      originalKey: 'defaultProvider',
      targetKey: 'feature.file_processing.default.markdown_conversion'
    })

    expect(REDUX_STORE_MAPPINGS.ocr).not.toContainEqual({
      originalKey: 'imageProviderId',
      targetKey: 'feature.file_processing.default.text_extraction'
    })
  })
})
