import { describe, expect, it } from 'vitest'

import { classifyErrorCategory } from '@shared/utils/errorCategory'

import { serializeError } from '../../utils/serializeError'
import { NonNativeMediaAnalysisError } from '../mediaAnalysisRequestError'

describe('NonNativeMediaAnalysisError', () => {
  it('is diagnosed as a generic failure with settings guidance, not a safety block', () => {
    const serialized = serializeError(new NonNativeMediaAnalysisError())
    // Same precedence as the renderer classifier: an explicit category wins, else the text decides.
    const category = serialized.providerErrorCategory ?? classifyErrorCategory({ text: serialized.message ?? '' })

    expect(serialized.i18nKey).toBe('media_unreadable_without_preprocessing')
    expect(category).toBe('unknown')
  })
})
