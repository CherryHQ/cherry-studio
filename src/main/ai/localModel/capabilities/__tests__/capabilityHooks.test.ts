import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { beforeEach, describe, expect, it } from 'vitest'

import { capabilityHooksFor } from '../capabilityHooks'

describe('OCR capability removal', () => {
  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
  })

  it('clears every default processor that depends on the removed OCR model', async () => {
    MockMainPreferenceServiceUtils.setMultiplePreferenceValues({
      'feature.file_processing.default_image_to_text': 'local-paddleocr',
      'feature.file_processing.default_document_to_markdown': 'local-document'
    })

    await capabilityHooksFor('ocr').afterRemove?.()

    expect(
      MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.default_image_to_text')
    ).toBeNull()
    expect(
      MockMainPreferenceServiceUtils.getPreferenceValue('feature.file_processing.default_document_to_markdown')
    ).toBeNull()
  })
})
