import { describe, expect, it } from 'vitest'

import { analyticsRequestSchemas } from '../analytics'

describe('analytics.track schema', () => {
  const schema = analyticsRequestSchemas['analytics.track'].input

  it('accepts catalogued renderer events', () => {
    expect(schema.safeParse({ event: 'onboarding_option_selected', option: 'cherryin_login' }).success).toBe(true)
    expect(
      schema.safeParse({ event: 'cherryin_topup_clicked', source: 'provider_settings', flowId: crypto.randomUUID() })
        .success
    ).toBe(true)
  })

  it('rejects uncatalogued events, extra fields, and free-form values', () => {
    expect(schema.safeParse({ event: 'subscription_entry_view', source: 'settings' }).success).toBe(false)
    expect(schema.safeParse({ event: 'app_opened', onboardingStatus: 'pending' }).success).toBe(false)
    expect(
      schema.safeParse({ event: 'onboarding_option_selected', option: 'cherryin_login', email: 'a@b.c' }).success
    ).toBe(false)
    expect(schema.safeParse({ event: 'cherryin_balance_increased', flowId: 'https://example.com' }).success).toBe(false)
  })
})
