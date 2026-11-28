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

  it('accepts usage events built from static identifiers only', () => {
    expect(
      schema.safeParse({
        event: 'ui_clicked',
        ui: 'chat.message-timeline.action.copy',
        page: 'chat',
        element: 'button',
        input: 'pointer'
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({ event: 'ui_clicked', ui: 'Copy message', page: 'chat', element: 'button', input: 'pointer' })
        .success
    ).toBe(false)
    expect(
      schema.safeParse({
        event: 'page_viewed',
        page: 'settings',
        subpage: 'provider',
        durationMs: 1200,
        activeMs: 900,
        endReason: 'navigate',
        capped: false
      }).success
    ).toBe(true)
    expect(
      schema.safeParse({
        event: 'feature_used',
        feature: 'mini_app',
        action: 'opened',
        target: 'https://example.com/app'
      }).success
    ).toBe(false)
  })

  it('accepts chat interaction events with classified reasons and rejects free-form values', () => {
    expect(
      schema.safeParse({ event: 'chat_error_action', action: 'retry', reason: 'rate_limit', surface: 'chat' }).success
    ).toBe(true)
    expect(
      schema.safeParse({ event: 'chat_error_action', action: 'retry', reason: 'Rate limit hit', surface: 'chat' })
        .success
    ).toBe(false)
    expect(schema.safeParse({ event: 'topic_action_used', action: 'topic.export.markdown' }).success).toBe(true)
    expect(schema.safeParse({ event: 'topic_action_used', action: 'topic.move-to-assistant.My%20Bot' }).success).toBe(
      false
    )
    expect(
      schema.safeParse({ event: 'feature_used', feature: 'translate', action: 'translated', errorReason: 'quota' })
        .success
    ).toBe(true)
    expect(
      schema.safeParse({ event: 'feature_used', feature: 'translate', action: 'translated', errorReason: 'oops' })
        .success
    ).toBe(false)
  })

  it('accepts feature outcomes with a classified reason and rejects free-text errors or names', () => {
    const ok = (event: object) => schema.safeParse(event).success
    expect(
      ok({
        event: 'feature_used',
        feature: 'knowledge',
        action: 'item_processed',
        target: 'file',
        status: 'cancelled',
        errorReason: 'indexing_interrupted'
      })
    ).toBe(true)
    expect(ok({ event: 'feature_used', feature: 'mini_app', action: 'opened', trigger: 'launchpad' })).toBe(true)
    expect(
      ok({ event: 'feature_used', feature: 'translate', action: 'document_translated', errorReason: 'ENOENT: /tmp/a' })
    ).toBe(false)
    expect(ok({ event: 'data_imported', source: 'chatgpt', status: 'success', count: 3 })).toBe(true)
    expect(ok({ event: 'data_imported', source: 'gemini', status: 'success' })).toBe(false)
    expect(ok({ event: 'global_search_used', found: true, group: 'knowledge-base' })).toBe(true)
    expect(ok({ event: 'global_search_used', found: false, query: 'secret' })).toBe(false)
    expect(ok({ event: 'window_opened', kind: 'tab_detached' })).toBe(true)
    expect(ok({ event: 'translate_history_used', action: 'starred' })).toBe(true)
    expect(ok({ event: 'announcement_action', action: 'link_clicked', url: 'https://x.y' })).toBe(false)
  })
})
