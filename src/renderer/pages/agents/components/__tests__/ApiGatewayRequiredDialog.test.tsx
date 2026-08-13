import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { API_GATEWAY_REQUIRED_I18N_KEY } from '@shared/types/apiGateway'
import { describe, expect, it } from 'vitest'

import { retryText } from '../ApiGatewayRequiredDialog'

/**
 * The prompt fires on prewarm too (opening a session primes an idle connection), so it can land on
 * history it did not cause. Resending the wrong turn re-spends tokens and re-runs tool side effects.
 */

const userMessage = (text: string): CherryUIMessage =>
  ({ id: 'user-1', role: 'user', parts: [{ type: 'text', text }] }) as unknown as CherryUIMessage

const failedAssistant = (parts: CherryMessagePart[]): CherryUIMessage =>
  ({ id: 'assistant-1', role: 'assistant', metadata: { status: 'error' }, parts }) as unknown as CherryUIMessage

const errorPart = (i18nKey?: string): CherryMessagePart =>
  ({
    type: 'data-error',
    data: { name: 'Error', message: 'boom', ...(i18nKey ? { i18nKey } : {}) }
  }) as CherryMessagePart

const textPart = (text: string): CherryMessagePart => ({ type: 'text', text }) as CherryMessagePart

describe('retryText', () => {
  it('resends the pending text when the last turn died on the disabled gateway', () => {
    const messages = [userMessage('run the migration'), failedAssistant([errorPart(API_GATEWAY_REQUIRED_I18N_KEY)])]

    expect(retryText(messages, {})).toBe('run the migration')
  })

  it('ignores markers that are not output when deciding the turn produced nothing', () => {
    const messages = [
      userMessage('run the migration'),
      failedAssistant([{ type: 'step-start' } as CherryMessagePart, errorPart(API_GATEWAY_REQUIRED_I18N_KEY)])
    ]

    expect(retryText(messages, {})).toBe('run the migration')
  })

  it('refuses to resend when the last turn failed for an unrelated reason', () => {
    const messages = [userMessage('run the migration'), failedAssistant([errorPart('auth_failed')])]

    expect(retryText(messages, {})).toBeUndefined()
  })

  it('refuses to resend a turn that already produced output before failing', () => {
    const messages = [
      userMessage('run the migration'),
      failedAssistant([textPart('dropping table'), errorPart(API_GATEWAY_REQUIRED_I18N_KEY)])
    ]

    expect(retryText(messages, {})).toBeUndefined()
  })

  it('refuses to resend when the session simply ends on a successful turn', () => {
    const messages = [
      userMessage('run the migration'),
      { id: 'assistant-1', role: 'assistant', metadata: { status: 'success' }, parts: [textPart('done')] }
    ] as unknown as CherryUIMessage[]

    expect(retryText(messages, {})).toBeUndefined()
  })

  it('reads the live streaming parts in preference to the persisted ones', () => {
    const messages = [userMessage('run the migration'), failedAssistant([])]

    expect(retryText(messages, { 'assistant-1': [errorPart(API_GATEWAY_REQUIRED_I18N_KEY)] })).toBe('run the migration')
  })
})
