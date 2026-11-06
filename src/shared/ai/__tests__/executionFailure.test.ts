import { describe, expect, it } from 'vitest'

import { executionFailureSchema } from '@cherrystudio/remote-protocol/failure'

import { toExecutionFailure } from '../executionFailure'
import { NON_VISION_IMAGE_GUIDANCE } from '../nonVisionImageGuidance'

describe('execution failure projection', () => {
  it.each<Record<string, string>>([
    { providerErrorCategory: 'ocr', i18nKey: 'image_unreadable_for_non_vision_model' },
    {}
  ])('projects an unreadable non-vision image as invalid input: %j', (fields) => {
    const failure = toExecutionFailure({
      name: 'NonVisionImageOcrError',
      message: NON_VISION_IMAGE_GUIDANCE,
      stack: null,
      cause: null,
      ...fields
    })
    expect(failure.failure.reasonCode).toBe('invalid_input')
    expect(failure.retryable).toBe(false)
  })

  it('preserves a valid saved unknown snapshot instead of reclassifying it', () => {
    const snapshot = {
      message: NON_VISION_IMAGE_GUIDANCE,
      retryable: false,
      failure: {
        version: 1 as const,
        reasonCode: 'unknown' as const,
        source: { layer: 'runtime' as const },
        context: {}
      }
    }
    expect(
      toExecutionFailure({
        name: 'NonVisionImageOcrError',
        message: NON_VISION_IMAGE_GUIDANCE,
        stack: null,
        providerErrorCategory: 'ocr',
        executionFailure: snapshot
      })
    ).toEqual(snapshot)
  })

  it('keeps a fresh Groq entitlement failure non-retryable with its HTTP status', () => {
    expect(
      toExecutionFailure(
        {
          name: 'APIError',
          stack: null,
          message: `service_tier auto is not available for this org. You can check your plan at
[Billing - Plans](https://console.groq.com/settings/billing/plans), and upgrade to access the
required service tier.`,
          statusCode: 400
        },
        'groq::openai/gpt-oss-20b'
      )
    ).toMatchObject({
      retryable: false,
      failure: { reasonCode: 'permission', context: { statusCode: 400, providerId: 'groq' } }
    })
  })

  it('extracts a subscription rejection from CLI-style errors without confusing it with remote authorization', () => {
    const failure = toExecutionFailure(
      {
        name: 'Error',
        stack: '/Users/private/stack',
        message:
          '403: {"type":"server_error","message":"An active OpenCode Go subscription is required to use Go models.","token":"secret"}'
      },
      'opencode::deepseek-flash'
    )
    expect(failure).toMatchObject({
      message: 'An active OpenCode Go subscription is required to use Go models.',
      retryable: false,
      failure: {
        reasonCode: 'permission',
        source: { layer: 'provider' },
        context: { statusCode: 403, providerId: 'opencode' }
      }
    })
    expect(JSON.stringify(failure)).not.toMatch(/secret|private|stack/)
  })

  it('preserves an existing classification when provider payloads were already redacted', () => {
    expect(
      toExecutionFailure({
        name: 'APIError',
        message: 'Request rejected',
        stack: null,
        providerErrorCategory: 'region',
        statusCode: 403
      }).failure.reasonCode
    ).toBe('region')
  })

  it('keeps diagnostic bytes bounded and excludes credentials and local paths', () => {
    const failure = toExecutionFailure({
      name: 'Error',
      message: 'Cannot read /Users/alice/private/file; token=secret',
      stack: 'private',
      responseBody: null
    })
    expect(failure.message).not.toMatch(/alice|secret/)
    const large = toExecutionFailure({
      name: 'Error',
      message: '\u0001'.repeat(500),
      stack: null,
      providerId: '\u0001'.repeat(128),
      modelId: '\u0001'.repeat(128)
    })
    expect(executionFailureSchema.safeParse(large).success).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(large)).length).toBeLessThanOrEqual(4096)
  })
})
