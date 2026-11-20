import { MockDataApiUtils } from '@test-mocks/renderer/DataApiService'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fragment, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'

import { CherryCloudModelSelector } from '../CherryCloudModelSelector'

vi.unmock('@cherrystudio/ui')
vi.mock('@renderer/components/VirtualList', () => ({
  DynamicVirtualList: ({
    list,
    children
  }: {
    list: { key: string }[]
    children: (item: any, index: number) => ReactNode
  }) => list.map((item, index) => <Fragment key={item.key}>{children(item, index)}</Fragment>)
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => (key === 'settings.subscription.go_to_subscribe' ? 'Subscribe' : key) })
}))
const plans = vi.hoisted(() => ({ phase: 'signed-out' as 'signed-out' | 'signed-in' }))
vi.mock('@renderer/hooks/useCherryCloudPlans', () => ({
  useCherryCloudPlans: () => ({
    session: { status: { phase: plans.phase } },
    plansQuery: {},
    activePaid: undefined,
    upcomingPaid: undefined,
    isPlansReady: plans.phase === 'signed-in'
  })
}))
const availability = vi.hoisted(() => ({
  hidesEveryModel: true,
  amdLocked: [] as { id: string; display_name: string; available_features: ('chat' | 'translate')[] }[]
}))
vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: () => availability.hidesEveryModel,
    isModelFree: (model: { providerId: string }) => model.providerId === 'cherryai',
    isModelUnavailable: () => false,
    getModelDescription: () => undefined,
    isAvailabilityReady: true,
    availabilityError: undefined,
    amdActivationRequiredModels: availability.amdLocked,
    signInRequiredModels: []
  })
}))
vi.mock('@renderer/services/cherryCloudSubscription', () => ({
  startCherryCloudSubscription: vi.fn(async () => undefined)
}))

const request = vi.mocked(window.api.ipcApi.request)
beforeEach(() => {
  vi.clearAllMocks()
  plans.phase = 'signed-out'
  mockUseQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isRefreshing: false,
    refetch: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined)
  })
})

describe('Cloud selector subscription entries', () => {
  it('offers no header subscription before sign-in', () => {
    render(
      <CherryCloudModelSelector
        multiple={false}
        open
        onSelect={vi.fn()}
        trigger={<button type="button">Models</button>}
      />
    )
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument()
  })

  it('reports the empty entry view to an unsubscribed account and preserves its source when clicked', async () => {
    plans.phase = 'signed-in'
    const user = userEvent.setup()
    render(
      <CherryCloudModelSelector
        multiple={false}
        open
        onSelect={vi.fn()}
        trigger={<button type="button">Models</button>}
      />
    )
    const entry = await screen.findByRole('button', { name: 'Subscribe' })
    await waitFor(() =>
      expect(request).toHaveBeenCalledWith('cherry_cloud.analytics.track', {
        payload: { event: 'subscription_entry_view', source: 'selector_header' },
        scopeId: undefined
      })
    )
    await user.click(entry)
    expect(startCherryCloudSubscription).toHaveBeenCalledWith('selector_header')
  })

  it('keeps empty capability-only pickers free of unrelated marketing', () => {
    render(
      <CherryCloudModelSelector
        multiple={false}
        open
        showSubscriptionOffers={false}
        onSelect={vi.fn()}
        trigger={<button type="button">Models</button>}
      />
    )
    expect(screen.queryByRole('button', { name: 'Subscribe' })).not.toBeInTheDocument()
  })
})

describe('AMD free models', () => {
  const provider = (id: string, name: string) => ({
    id,
    name,
    apiKeys: [],
    authType: 'api-key',
    reportsActualCost: false,
    settings: {},
    isEnabled: true
  })
  const model = (providerId: string, modelId: string) => ({
    id: `${providerId}::${modelId}`,
    providerId,
    name: modelId,
    capabilities: [],
    supportsStreaming: true,
    isEnabled: true,
    isHidden: false
  })

  const general = ['agent', 'chat', 'translate'] as const
  const publicCatalog = {
    measured_at: '2026-11-09T00:00:00Z',
    plans: [
      {
        id: '4ac04749-49f0-4930-9f9b-fbfe62999227',
        display_name: 'Free',
        is_free: true,
        models: [{ id: 'free-model', display_name: 'Free Model', available_features: [...general] }]
      }
    ]
  }

  it('lists the server catalog in the CherryAI group, with AMD rows last, and unlocks each its own way', async () => {
    availability.hidesEveryModel = false
    availability.amdLocked = [{ id: 'amd/qwen', display_name: 'AMD Qwen', available_features: ['chat', 'translate'] }]
    const freeModelId = 'cherryai-subscription::free-model'
    const freeModel = model('cherryai-subscription', 'free-model')
    MockDataApiUtils.setCustomResponse(`/models/${freeModelId}`, 'GET', freeModel)
    const onSelect = vi.fn()
    const providers = [provider('cherryai', 'CherryAI'), provider('openai', 'OpenAI')]
    const models = [model('cherryai', 'qwen'), model('openai', 'gpt-4')]
    mockUseQuery.mockImplementation((path: string) => ({
      data: path === '/models' ? models : path === '/providers' ? providers : [],
      isLoading: false,
      isRefreshing: false,
      refetch: vi.fn(async () => undefined),
      mutate: vi.fn(async () => undefined)
    }))
    const replies: Record<string, unknown> = {
      'cherry_cloud.public_plans.get': publicCatalog,
      'cherry_cloud.login.start': { outcome: 'signed-in', status: {} },
      'cherry_cloud.models.sync': { availableModelIds: { agent: [freeModelId], general: [freeModelId] } }
    }
    request.mockImplementation(async (route: string) => ({ ok: true, data: replies[route] }))
    const selector = () => (
      <SWRConfig value={{ provider: () => new Map() }}>
        <CherryCloudModelSelector
          multiple={false}
          open
          onSelect={onSelect}
          trigger={<button type="button">Models</button>}
        />
      </SWRConfig>
    )
    try {
      const { rerender } = render(selector())
      const amdRow = await screen.findByText('AMD Qwen')
      const text = document.body.textContent ?? ''
      expect(text.indexOf('CherryAI')).toBeLessThan(text.indexOf('Free Model'))
      expect(screen.getByText('Free Model').compareDocumentPosition(amdRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(text.slice(text.indexOf('CherryAI'), text.indexOf('AMD Qwen'))).not.toContain('gpt-4')
      // The Free filter keeps both locked rows: each is free once unlocked.
      await userEvent.click(within(screen.getByTestId('model-selector-filter-tags')).getByText('models.type.free'))
      expect(await screen.findByText('AMD Qwen')).toBeInTheDocument()
      expect(screen.getByText('Free Model')).toBeInTheDocument()
      expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()

      await userEvent.click(screen.getByText('AMD Qwen'))
      expect(request).toHaveBeenCalledWith('cherry_cloud.amd_entry.open', { modelId: 'amd/qwen' })
      rerender(selector())
      await userEvent.click(await screen.findByText('Free Model'))
      expect(request).toHaveBeenCalledWith('cherry_cloud.login.start', undefined)
      // Signing in finishes the click: the model the row stood for becomes the selection.
      await waitFor(() => expect(onSelect).toHaveBeenCalledWith(freeModel))
      expect(startCherryCloudSubscription).not.toHaveBeenCalled()
    } finally {
      availability.hidesEveryModel = true
      availability.amdLocked = []
    }
  })
  it('keeps locked AMD rows out of a picker that disables offers, as the subscription recovery picker does', async () => {
    plans.phase = 'signed-in'
    availability.hidesEveryModel = false
    availability.amdLocked = [{ id: 'amd/qwen', display_name: 'AMD Qwen', available_features: ['chat', 'translate'] }]
    const providers = [provider('cherryai', 'CherryAI')]
    const models = [model('cherryai', 'qwen')]
    mockUseQuery.mockImplementation((path: string) => ({
      data: path === '/models' ? models : path === '/providers' ? providers : [],
      isLoading: false,
      isRefreshing: false,
      refetch: vi.fn(async () => undefined),
      mutate: vi.fn(async () => undefined)
    }))
    try {
      render(
        <SWRConfig value={{ provider: () => new Map() }}>
          <CherryCloudModelSelector
            multiple={false}
            open
            showSubscriptionOffers={false}
            onSelect={vi.fn()}
            trigger={<button type="button">Models</button>}
          />
        </SWRConfig>
      )
      expect(await screen.findByText('qwen')).toBeInTheDocument()
      expect(screen.queryByText('AMD Qwen')).not.toBeInTheDocument()
    } finally {
      availability.hidesEveryModel = true
      availability.amdLocked = []
    }
  })
})
