import { describe, expect, it } from 'vitest'

import { serializeError } from '../../utils/serializeError'
import { NonNativeMediaAnalysisError } from '../mediaAnalysisRequestError'

describe('NonNativeMediaAnalysisError', () => {
  it('crosses IPC with its own media category instead of an unknown or safety diagnosis', () => {
    const serialized = serializeError(new NonNativeMediaAnalysisError())

    expect(serialized.i18nKey).toBe('media_unreadable_without_preprocessing')
    expect(serialized.providerErrorCategory).toBe('media')
  })
})
