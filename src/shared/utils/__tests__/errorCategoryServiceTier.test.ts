// Groq service-tier entitlement refusals must not be diagnosed as exhausted quota; see #22165.
import { describe, expect, it } from 'vitest'

import { classifyErrorCategory, isQuotaErrorMessage } from '../errorCategory'

describe('Groq service-tier entitlement', () => {
  const G = `service_tier auto is not available for this org. You can check your plan at
[Billing - Plans](https://console.groq.com/settings/billing/plans), and upgrade to access the
required service tier.`
  const flex = 'service_tier flex is not available for this org. See https://console.groq.com/settings/billing/plans'

  it.each([
    [G, 400, 'permission'],
    [G, 403, 'permission'],
    [G, 429, 'permission'],
    [G, undefined, 'permission'],
    [G, 402, 'quota'],
    [G, 500, 'server'],
    [G, 401, 'auth'],
    [G, 404, 'model'],
    [G + '\ninsufficient_quota', 400, 'quota'],
    [G + '\ninsufficient_quota', 429, 'quota'],
    [G + '\ninsufficient balance', 400, 'quota'],
    [G + '\nbilling_hard_limit_reached', 400, 'quota'],
    [G + '\n余额不足', 400, 'quota'],
    [flex, 400, 'permission'],
    [flex.toUpperCase(), 400, 'permission'],
    [flex.replace(' is not available for this org', ' \nis\t not available  for this org'), 400, 'permission']
  ] as const)('classifies %s at %s as %s', (text, status, expected) => {
    expect(classifyErrorCategory({ text, status })).toBe(expected)
  })

  it('preserves content finish-reason precedence', () => {
    expect(classifyErrorCategory({ text: G, status: 400, finishReason: 'content-filter' })).toBe('content')
  })

  it('keeps the broad quota helper compatible with billing-bearing messages', () => {
    expect(isQuotaErrorMessage(G)).toBe(true)
  })

  it.each([
    ['Payment Required', 402],
    ['insufficient_quota', 429],
    ['insufficient balance', 400],
    ['insufficient_balance', 403],
    ['insufficient credit', 400],
    ['insufficient_credit', 400],
    ['billing_hard_limit_reached', 400],
    ['insufficient balance. See https://console.groq.com/settings/billing/plans', 400],
    ['余额不足', 400],
    ['余额不足', undefined],
    ['账户余额不足，请充值', 400],
    ['billing', 400],
    ['payment', 400]
  ] as const)('keeps exhaustion %s at %s in quota', (text, status) => {
    expect(classifyErrorCategory({ text, status })).toBe('quota')
  })

  it.each([
    ['invalid service_tier', 400, 'bad_request'],
    ['invalid service_tier. See https://console.groq.com/settings/billing/plans', 400, 'quota'],
    ['service_tier auto is temporarily unavailable', 400, 'bad_request'],
    [
      'service_tier auto is temporarily unavailable. Check https://console.groq.com/settings/billing/plans',
      400,
      'quota'
    ],
    [
      'service_tier auto is valid; model x is not available for this org. See https://console.groq.com/settings/billing/plans',
      400,
      'quota'
    ],
    ['service_tier auto is not available for this org.', 400, 'bad_request'],
    ['service_tier auto is not available for this org.', undefined, 'unknown'],
    ['service_tier auto is not available for this org. See Billing - Plans.', 400, 'quota'],
    [
      'service_tier auto is not available for this org. See https://console.example.com/settings/billing/plans',
      400,
      'quota'
    ],
    ['Forbidden', 403, 'permission'],
    ['unsupported_country', 403, 'region'],
    ['Too many requests', 429, 'rate_limit'],
    ['content_filter triggered', 400, 'content'],
    ['prompt is too long', 400, 'context_length'],
    ['余额充足', 400, 'bad_request']
  ] as const)('preserves compatibility for %s at %s', (text, status, expected) => {
    expect(classifyErrorCategory({ text, status })).toBe(expected)
  })
})
