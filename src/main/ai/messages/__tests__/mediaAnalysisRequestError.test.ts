import { describe, expect, it } from 'vitest'

import { serializeError } from '../../utils/serializeError'
import { NonNativeMediaAnalysisError } from '../mediaAnalysisRequestError'

describe('NonNativeMediaAnalysisError', () => {
  it('crosses IPC with its own media category instead of an unknown or safety diagnosis', () => {
    const serialized = serializeError(new NonNativeMediaAnalysisError())

    expect(serialized.i18nKey).toBe('media_unreadable_without_preprocessing')
    expect(serialized.providerErrorCategory).toBe('media')
  })

  it.each([
    [{ vision: true, speech: false }, 'media_unreadable_need_vision_model'],
    [{ vision: false, speech: true }, 'media_unreadable_need_speech_model'],
    [{ vision: true, speech: true }, 'media_unreadable_without_preprocessing'],
    [undefined, 'media_unreadable_without_preprocessing']
  ] as const)('names only the missing piece for gaps %o', (gaps, i18nKey) => {
    expect(new NonNativeMediaAnalysisError(gaps).i18nKey).toBe(i18nKey)
  })
})
