import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { MockUseDataApiUtils, mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'
import type { Provider } from '@shared/data/types/provider'
import { apiKeyModelLimitId } from '@shared/utils/apiKeyLimit'

import { RoutingDestinationHint } from '../RoutingDestinationHint'

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

const originalLanguage = i18n.language

beforeAll(async () => {
  await i18n.changeLanguage('en-US')
})

afterAll(async () => {
  await i18n.changeLanguage(originalLanguage)
})

const modelFixture = (id: string, name: string, providerId: string): Model =>
  ({ id, name, providerId, capabilities: [], supportsStreaming: true, isEnabled: true, isHidden: false }) as Model

const FALLBACK = modelFixture('openai::gpt-4o-mini', 'GPT-4o Mini', 'openai')
const PINNED = modelFixture('anthropic::claude-opus-5', 'Claude Opus 5', 'anthropic')
const PROVIDERS = [
  { id: 'openai', name: 'OpenAI', isEnabled: true, apiKeys: [] } as unknown as Provider,
  { id: 'anthropic', name: 'Anthropic', isEnabled: true, apiKeys: [] } as unknown as Provider
]

beforeEach(() => {
  MockUsePreferenceUtils.resetMocks()
  MockUseCacheUtils.resetMocks()
  MockUseDataApiUtils.resetMocks()
  MockUseDataApiUtils.mockQueryData('/models', [FALLBACK, PINNED])
})

describe('RoutingDestinationHint', () => {
  it('renders nothing when routing would leave the shown model alone', () => {
    render(
      <RoutingDestinationHint
        promptText="naber"
        fallbackModel={FALLBACK}
        hasMentionedModels={false}
        providers={PROVIDERS}
      />
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows the pinned destination and names both models in the accessible label', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.pinned_model', PINNED.id)

    render(
      <RoutingDestinationHint
        promptText="naber"
        fallbackModel={FALLBACK}
        hasMentionedModels={false}
        providers={PROVIDERS}
      />
    )

    const hint = screen.getByRole('status')
    expect(hint).toHaveAccessibleName('Routing will send this message to Claude Opus 5 instead of GPT-4o Mini')
    expect(screen.getByText('Claude Opus 5')).toBeInTheDocument()
  })

  it('stays silent once an explicit @-mention already decides the destination, even with a pinned model set', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.pinned_model', PINNED.id)

    render(
      <RoutingDestinationHint
        promptText="naber"
        fallbackModel={FALLBACK}
        hasMentionedModels={true}
        providers={PROVIDERS}
      />
    )

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('ignores a pinned model the user has since disabled individually, even though its provider stays enabled', () => {
    MockUseDataApiUtils.mockQueryData('/models', [FALLBACK, { ...PINNED, isEnabled: false }])
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.pinned_model', PINNED.id)

    render(
      <RoutingDestinationHint
        promptText="naber"
        fallbackModel={FALLBACK}
        hasMentionedModels={false}
        providers={PROVIDERS}
      />
    )

    // The pinned model no longer exists as far as routing is concerned, so there is nothing to
    // preview — showing it anyway would disagree with what send-time routing actually does.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('fetches quota usage back to the destination key’s own renewal anchor, not the default 1st-of-month', () => {
    const providersWithAnchor = [
      {
        id: 'anthropic',
        name: 'Anthropic',
        isEnabled: true,
        apiKeys: [{ id: 'k1', isEnabled: true, renewalAnchor: '2020-01-20', renewalTimezone: 'UTC' }]
      } as unknown as Provider,
      PROVIDERS[0]
    ]
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.pinned_model', PINNED.id)
    MockUsePreferenceUtils.setPreferenceValue('chat.routing.api_key_limits', {
      [apiKeyModelLimitId('anthropic', 'k1', PINNED.id)]: { limit: 5, period: 'monthly' }
    })

    render(
      <RoutingDestinationHint
        promptText="naber"
        fallbackModel={FALLBACK}
        hasMentionedModels={false}
        providers={providersWithAnchor}
      />
    )

    const call = mockUseQuery.mock.calls.findLast(([path]) => path === '/ai-usage-records/stats')
    const query = (call?.[1] as { query?: { from: number } })?.query
    // Anchored to the 20th, never the naive default of the 1st.
    expect(new Date(query!.from).getUTCDate()).toBe(20)
  })
})
