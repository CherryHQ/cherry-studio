import { describe, expect, it } from 'vitest'

import { PAINTING_ERROR_PARAM_KEYS } from '../../types/appError'
import {
  appErrorContextSchema,
  createAppErrorContext,
  isAppErrorContext,
  projectAppErrorContext,
  summarizeErrorParams,
  summarizeProviderResponse
} from '../appError'
import { REDACTED } from '../redaction'

describe('createAppErrorContext', () => {
  it('keeps an earlier snapshot when the caller mutates the parameter bag', () => {
    const params = { size: '1024x1024', n: 1 }
    const context = createAppErrorContext({
      source: 'painting',
      operation: 'painting.generate',
      message: 'upstream failed',
      params
    })
    params.size = '256x256'
    params.n = 4
    expect(context.params).toEqual({ size: '1024x1024', n: 1 })
    expect(context.params).not.toBe(params)
  })

  it('drops prompt aliases and replaces sensitive keys that carry no token pattern', () => {
    const context = createAppErrorContext({
      source: 'painting',
      operation: 'painting.generate',
      message: 'upstream failed',
      params: {
        size: '1024x1024',
        prompt: 'draw a cat',
        userPrompt: 'draw a dog',
        image: 'raw-bytes',
        apiKey: 'plain-secret-value',
        authorization: 'opaque-value',
        token: 'opaque-value'
      }
    })
    expect(context.params).toEqual({
      size: '1024x1024',
      apiKey: REDACTED,
      authorization: REDACTED,
      token: REDACTED
    })
    expect(JSON.stringify(context)).not.toContain('draw a cat')
    expect(JSON.stringify(context)).not.toContain('plain-secret-value')
  })
})

describe('summarizeErrorParams', () => {
  it('keeps only the painting allowlist and still drops prompt aliases', () => {
    const summary = summarizeErrorParams(
      {
        size: '1024x1024',
        seed: 7,
        prompt: 'draw a cat',
        negative_prompt: 'blur',
        input_image: 'attachment',
        vendor_extra: 'keep-me-out',
        apiKey: 'plain-secret-value'
      },
      PAINTING_ERROR_PARAM_KEYS
    )
    expect(summary).toEqual({ size: '1024x1024', seed: 7 })
  })
})

describe('projectAppErrorContext', () => {
  it('keeps a supplied stack on export and drops it on upload', () => {
    const context = createAppErrorContext({
      id: 'err-1',
      occurredAt: '2026-10-14T00:00:00.000Z',
      source: 'painting',
      operation: 'painting.generate',
      message: 'upstream failed Bearer sk-proj-abcdefghijklmnopqrstuvwxyz123456',
      stack: 'Error: upstream\n    at /Users/alice/app.js',
      params: { size: '1024x1024' }
    })
    const exported = projectAppErrorContext(context, 'export')
    const uploaded = projectAppErrorContext(context, 'upload')
    expect(exported.stack).toContain('Error: upstream')
    expect(exported.message).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    expect(uploaded.stack).toBeUndefined()
    expect(uploaded.params).toEqual({ size: '1024x1024' })
  })

  it('keeps status and a bounded response on export and upload, without prompts or credentials', () => {
    const context = createAppErrorContext({
      id: 'err-429',
      occurredAt: '2026-10-14T00:00:00.000Z',
      source: 'painting',
      operation: 'painting.generate',
      message: 'quota exceeded',
      statusCode: 429,
      responseBody: JSON.stringify({
        error: 'quota',
        prompt: 'draw a cat',
        requestBodyValues: { messages: [{ role: 'user', content: 'private question' }] },
        note: 'Bearer sk-proj-abcdefghijklmnopqrstuvwxyz123456'
      })
    })
    for (const view of ['export', 'upload'] as const) {
      const projected = projectAppErrorContext(context, view)
      expect(projected.statusCode).toBe(429)
      expect(projected.responseBody).toContain('quota')
      expect(JSON.stringify(projected)).not.toContain('draw a cat')
      expect(JSON.stringify(projected)).not.toContain('private question')
      expect(JSON.stringify(projected)).not.toContain('sk-proj-abcdefghijklmnopqrstuvwxyz123456')
    }
    expect(summarizeProviderResponse('{"error":"quota"}')).toBe('{"error":"quota"}')
  })

  it('drops image payloads from a provider response and keeps the failure text', () => {
    const summary = summarizeProviderResponse(
      JSON.stringify({
        error: { message: 'Synthetic failure', code: '400' },
        data: [{ b64_json: 'QA_SYNTHETIC_IMAGE_PAYLOAD', url: 'data:image/png;base64,AAAA' }]
      })
    )

    expect(summary).toContain('Synthetic failure')
    expect(summary).toContain('400')
    expect(summary).not.toContain('QA_SYNTHETIC_IMAGE_PAYLOAD')
    expect(summary).not.toContain('data:image')
    expect(summarizeProviderResponse('data:image/png;base64,AAAA')).toBeUndefined()
  })
})

describe('isAppErrorContext', () => {
  const valid = {
    id: 'err-1',
    occurredAt: '2026-10-14T00:00:00.000Z',
    source: 'painting',
    operation: 'painting.generate',
    message: 'upstream failed'
  }

  it('accepts a complete snapshot and rejects malformed optional fields', () => {
    expect(
      isAppErrorContext({
        ...valid,
        providerId: 'openai',
        imageOnly: true,
        params: { n: 1 },
        statusCode: 429,
        responseBody: 'quota'
      })
    ).toBe(true)
    expect(isAppErrorContext({ ...valid, statusCode: '429' })).toBe(false)
    expect(appErrorContextSchema.safeParse(valid).success).toBe(true)
    expect(isAppErrorContext({ ...valid, providerId: '' })).toBe(false)
    expect(isAppErrorContext({ ...valid, imageOnly: 'yes' })).toBe(false)
    expect(isAppErrorContext({ ...valid, params: { nested: { prompt: 'secret' } } })).toBe(false)
    expect(isAppErrorContext({ ...valid, name: 1 })).toBe(false)
    expect(isAppErrorContext({ ...valid, extra: true })).toBe(false)
  })
})
