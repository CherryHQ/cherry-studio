import { resetPopupMocks } from '@test-mocks/renderer/popup'
import { resetToastMocks } from '@test-mocks/renderer/toast'
import { beforeEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { popup } from '@renderer/services/popup'
import { toast } from '@renderer/services/toast'

import {
  createPaintingGenerateError,
  presentPaintingGenerateError,
  translatePaintingGenerateError
} from '../paintingGenerateError'

describe('translatePaintingGenerateError', () => {
  beforeEach(() => {
    resetToastMocks()
    resetPopupMocks()
  })

  it('wraps a remote provider failure and keeps the provider payload', () => {
    const cause = Object.assign(new Error('quota exceeded'), {
      responseBody: '{"error":"quota"}',
      statusCode: 429
    })
    const error = createPaintingGenerateError('REMOTE_ERROR', {
      cause,
      message: 'quota exceeded',
      presentation: 'toast'
    })

    expect(translatePaintingGenerateError(error)).toBe(i18n.t('paintings.generate_failed'))
    presentPaintingGenerateError(error)

    expect(toast.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause,
        data: expect.objectContaining({
          errorContext: expect.objectContaining({ message: 'quota exceeded', source: 'painting' }),
          localizedErrorMessage: i18n.t('paintings.generate_failed'),
          serializedError: expect.objectContaining({
            message: 'quota exceeded',
            responseBody: '{"error":"quota"}',
            statusCode: 429
          })
        }),
        title: i18n.t('paintings.generate_failed')
      })
    )
  })

  it('keeps a known painting code on its own translation', () => {
    expect(translatePaintingGenerateError(createPaintingGenerateError('PROVIDER_DISABLED'))).toBe(
      i18n.t('error.provider_disabled')
    )
  })

  it('wraps a non-domain error without dropping its message', () => {
    const error = new Error('socket hang up')
    presentPaintingGenerateError(error)

    expect(popup.error).toHaveBeenCalledWith(
      expect.objectContaining({
        cause: error,
        content: i18n.t('paintings.generate_failed'),
        data: expect.objectContaining({
          errorContext: expect.objectContaining({ message: 'socket hang up' }),
          localizedErrorMessage: i18n.t('paintings.generate_failed')
        })
      })
    )
  })
})
