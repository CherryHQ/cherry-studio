import { describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'
import { LocalizedToastError } from '@renderer/utils/errorToast'

import { getStreamBlockedError } from '../getStreamBlockedMessage'

describe('getStreamBlockedError', () => {
  it('marks the paused copy as a localized toast summary', () => {
    const error = getStreamBlockedError({ mode: 'blocked', reason: 'paused' })

    expect(error).toBeInstanceOf(LocalizedToastError)
    expect(error.message).toBe(i18n.t('restore.messages_paused'))
  })

  it('keeps a workspace refusal as raw error text', () => {
    const error = getStreamBlockedError({
      mode: 'blocked',
      reason: 'agent-session-workspace',
      message: 'workspace is unavailable'
    })

    expect(error).not.toBeInstanceOf(LocalizedToastError)
    expect(error.message).toBe('workspace is unavailable')
  })
})
