import { describe, expect, it } from 'vitest'

import type { CherryUIMessage } from '@shared/data/types/message'

import { endsWithProviderQuotaError } from '../providerQuotaError'

const quotaError = { name: 'AI_APICallError', message: 'Payment Required', statusCode: 402 }
const authError = { name: 'AI_APICallError', message: 'Unauthorized', statusCode: 401 }

function user(id: string): CherryUIMessage {
  return { id, role: 'user', parts: [{ type: 'text', text: 'hi' }] }
}

function reply(id: string, modelId: string, error?: Record<string, unknown>): CherryUIMessage {
  return {
    id,
    role: 'assistant',
    parts: error ? [{ type: 'data-error', data: error }] : [{ type: 'text', text: 'ok' }],
    metadata: { modelId, status: error ? 'error' : 'success' }
  } as CherryUIMessage
}

describe('endsWithProviderQuotaError', () => {
  it('finds a third-party quota error on the latest reply', () => {
    const messages = [user('u1'), reply('a1', 'cherryin::deepseek-v4-pro', quotaError)]
    expect(endsWithProviderQuotaError(messages)).toBe(true)
  })

  it('recognises a quota error by its body when the status is not 402', () => {
    const error = { name: 'AI_APICallError', message: 'insufficient_quota', statusCode: 429 }
    expect(endsWithProviderQuotaError([reply('a1', 'openai::gpt-5', error)])).toBe(true)
  })

  it('ignores a quota error that a later successful reply already superseded', () => {
    const messages = [reply('a1', 'cherryin::m', quotaError), user('u2'), reply('a2', 'cherryin::m')]
    expect(endsWithProviderQuotaError(messages)).toBe(false)
  })

  it('ignores a turn the user has already followed up on', () => {
    expect(endsWithProviderQuotaError([reply('a1', 'cherryin::m', quotaError), user('u2')])).toBe(false)
  })

  it('leaves Cherry Cloud quota to its own notice', () => {
    expect(endsWithProviderQuotaError([reply('a1', 'cherryai-subscription::qwen', quotaError)])).toBe(false)
  })

  it('ignores errors that are not about quota', () => {
    expect(endsWithProviderQuotaError([reply('a1', 'cherryin::m', authError)])).toBe(false)
  })

  it('reads the active branch rather than the last loaded message', () => {
    const messages = [user('u1'), reply('a1', 'cherryin::m', quotaError), reply('a2', 'cherryin::m')]
    expect(endsWithProviderQuotaError(messages, 'a1')).toBe(true)
    expect(endsWithProviderQuotaError(messages, 'a2')).toBe(false)
  })
})
