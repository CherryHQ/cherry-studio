import { beforeEach, describe, expect, it, vi } from 'vitest'

import { IpcRouter } from '@main/ipc/IpcRouter'
import { IpcErrorCode } from '@shared/ipc/errors/IpcError'
import { analyticsRequestSchemas } from '@shared/ipc/schemas/analytics'

import { analyticsHandlers } from '../analytics'

const { trackProductEvent } = vi.hoisted(() => ({ trackProductEvent: vi.fn() }))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({ AnalyticsService: { trackProductEvent } })
})

describe('analytics.track through the real IpcRouter', () => {
  const router = new IpcRouter(analyticsRequestSchemas, analyticsHandlers)
  const track = (event: object) => router.dispatch('analytics.track', event, { senderId: 'main' })

  beforeEach(() => {
    trackProductEvent.mockReset()
  })

  it.each([
    { event: 'onboarding_option_selected', option: 'cherryin_login' },
    { event: 'cherryin_topup_clicked', source: 'provider_settings', flowId: crypto.randomUUID() },
    { event: 'ui_clicked', ui: 'chat.message-timeline.action.copy', page: 'chat', element: 'button', input: 'pointer' },
    {
      event: 'page_viewed',
      page: 'settings',
      subpage: 'provider',
      durationMs: 1200,
      activeMs: 900,
      endReason: 'navigate',
      capped: false
    },
    { event: 'chat_error_action', action: 'retry', reason: 'rate_limit', surface: 'chat' },
    { event: 'topic_action_used', action: 'topic.export.markdown' },
    { event: 'feature_used', feature: 'translate', action: 'translated', errorReason: 'quota' },
    {
      event: 'feature_used',
      feature: 'knowledge',
      action: 'item_processed',
      target: 'file',
      status: 'cancelled',
      errorReason: 'indexing_interrupted'
    },
    { event: 'feature_used', feature: 'mini_app', action: 'opened', trigger: 'launchpad' },
    { event: 'data_imported', source: 'chatgpt', status: 'success', count: 3 },
    { event: 'global_search_used', found: true, group: 'knowledge-base' },
    { event: 'window_opened', kind: 'tab_detached' },
    { event: 'translate_history_used', action: 'starred' }
  ])('delivers a catalogued renderer event to analytics: $event', async (event) => {
    await track(event)

    expect(trackProductEvent).toHaveBeenCalledExactlyOnceWith(event)
  })

  it.each([
    ['a main-only event', { event: 'app_opened', onboardingStatus: 'pending' }],
    ['a subscription insight', { event: 'subscription_entry_view', source: 'settings' }],
    ['an extra field', { event: 'onboarding_option_selected', option: 'cherryin_login', email: 'a@b.c' }],
    ['a malformed flow id', { event: 'cherryin_balance_increased', flowId: 'https://example.com' }],
    [
      'a free-text control name',
      { event: 'ui_clicked', ui: 'Copy message', page: 'chat', element: 'button', input: 'pointer' }
    ],
    [
      'a URL as a target',
      { event: 'feature_used', feature: 'mini_app', action: 'opened', target: 'https://example.com/app' }
    ],
    [
      'a free-text error reason',
      { event: 'chat_error_action', action: 'retry', reason: 'Rate limit hit', surface: 'chat' }
    ],
    ['an encoded name', { event: 'topic_action_used', action: 'topic.move-to-assistant.My%20Bot' }],
    [
      'a file path as a reason',
      { event: 'feature_used', feature: 'translate', action: 'document_translated', errorReason: 'ENOENT: /tmp/a' }
    ],
    ['an unknown import source', { event: 'data_imported', source: 'gemini', status: 'success' }],
    ['a search query', { event: 'global_search_used', found: false, query: 'secret' }],
    ['a link URL', { event: 'announcement_action', action: 'link_clicked', url: 'https://x.y' }]
  ])('rejects %s before it reaches analytics', async (_, event) => {
    await expect(track(event)).rejects.toMatchObject({ code: IpcErrorCode.VALIDATION_FAILED })

    expect(trackProductEvent).not.toHaveBeenCalled()
  })
})
