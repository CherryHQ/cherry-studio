import { describe, expect, it } from 'vitest'

import {
  createAssistantImportFetchInit,
  isAssistantImportContentTooLarge,
  isAssistantImportResponseTooLarge,
  summarizeAssistantImportOutcomes,
  validateAssistantImportUrl
} from '../ImportAssistantDialog'

describe('ImportAssistantDialog URL guards', () => {
  it('rejects unsupported protocols', () => {
    expect(validateAssistantImportUrl('ftp://raw.githubusercontent.com/org/repo/assistant.json')).toEqual({
      ok: false,
      errorKey: 'library.import_dialog.error.unsupported_protocol'
    })
  })

  it('rejects untrusted hosts', () => {
    expect(validateAssistantImportUrl('https://example.com/assistant.json')).toEqual({
      ok: false,
      errorKey: 'library.import_dialog.error.invalid_url'
    })
  })

  it('allows raw GitHub and Gist hosts', () => {
    expect(validateAssistantImportUrl('https://raw.githubusercontent.com/org/repo/main/assistant.json')).toEqual({
      ok: true,
      url: 'https://raw.githubusercontent.com/org/repo/main/assistant.json'
    })
    expect(validateAssistantImportUrl('https://gist.githubusercontent.com/user/id/raw/assistant.json')).toEqual({
      ok: true,
      url: 'https://gist.githubusercontent.com/user/id/raw/assistant.json'
    })
  })

  it('detects oversized Content-Length responses and downloaded content', () => {
    expect(isAssistantImportResponseTooLarge(new Headers({ 'content-length': `${5 * 1024 * 1024 + 1}` }))).toBe(true)
    expect(isAssistantImportResponseTooLarge(new Headers({ 'content-length': `${5 * 1024 * 1024}` }))).toBe(false)
    expect(isAssistantImportContentTooLarge('x'.repeat(5 * 1024 * 1024 + 1))).toBe(true)
  })

  it('omits credentials and attaches an AbortSignal timeout', () => {
    const init = createAssistantImportFetchInit()
    expect(init.credentials).toBe('omit')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('summarizes partial import success with the first failed draft', () => {
    const t = (key: string, values?: Record<string, unknown>) => `${key}:${JSON.stringify(values)}`

    expect(
      summarizeAssistantImportOutcomes(
        [{ kind: 'ok' }, { kind: 'failed', name: 'Broken assistant', error: 'invalid model' }],
        t
      )
    ).toEqual({
      kind: 'error',
      message:
        'library.import_dialog.partial_success:{"success":1,"failed":1,"first_name":"Broken assistant","first_error":"invalid model"}'
    })
  })
})
