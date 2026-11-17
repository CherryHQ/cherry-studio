import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fragment, type ReactNode } from 'react'
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
vi.mock('@renderer/hooks/useCherryCloudPlans', () => ({
  useCherryCloudPlans: () => ({
    session: { status: { phase: 'signed-out' } },
    plansQuery: {},
    activePaid: undefined,
    upcomingPaid: undefined,
    isPlansReady: false
  })
}))
const availability = vi.hoisted(() => ({ hidesEveryModel: true }))
vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: () => availability.hidesEveryModel,
    isModelFree: (model: { providerId: string }) => model.providerId === 'cherryai',
    isModelUnavailable: () => false,
    getModelDescription: () => undefined,
    isAvailabilityReady: true,
    availabilityError: undefined
  })
}))
vi.mock('@renderer/services/cherryCloudSubscription', () => ({
  startCherryCloudSubscription: vi.fn(async () => undefined)
}))

const request = vi.mocked(window.api.ipcApi.request)
beforeEach(() => {
  vi.clearAllMocks()
  mockUseQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isRefreshing: false,
    refetch: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined)
  })
})

describe('Cloud selector subscription entries', () => {
  it('reports the empty entry view and preserves its source when clicked', async () => {
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

  it('lists the AMD rows last inside the CherryAI group in the China edition', async () => {
    vi.stubGlobal('__APP_EDITION__', 'cn')
    availability.hidesEveryModel = false
    const providers = [provider('cherryai', 'CherryAI'), provider('openai', 'OpenAI')]
    const models = [model('cherryai', 'qwen'), model('openai', 'gpt-4')]
    mockUseQuery.mockImplementation((path: string) => ({
      data: path === '/models' ? models : path === '/providers' ? providers : [],
      isLoading: false,
      isRefreshing: false,
      refetch: vi.fn(async () => undefined),
      mutate: vi.fn(async () => undefined)
    }))
    try {
      render(
        <CherryCloudModelSelector
          multiple={false}
          open
          onSelect={vi.fn()}
          trigger={<button type="button">Models</button>}
        />
      )
      const amdRow = await screen.findByText('Qwen3.8 27B')
      const text = document.body.textContent ?? ''
      const qwen = [...document.querySelectorAll('*')].find((node) => node.textContent === 'qwen')
      expect(text.indexOf('CherryAI')).toBeLessThan(text.indexOf('Qwen3.8 27B'))
      expect(qwen?.compareDocumentPosition(amdRow)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
      expect(text.slice(text.indexOf('CherryAI'), text.indexOf('DeepSeek V4 Flash'))).not.toContain('gpt-4')
      expect(text).not.toContain('models.amd_free.title')
      // The 免费 filter keeps the AMD rows: they are free once authorized.
      await userEvent.click(within(screen.getByTestId('model-selector-filter-tags')).getByText('models.type.free'))
      expect(await screen.findByText('Qwen3.8 27B')).toBeInTheDocument()
      expect(screen.queryByText('gpt-4')).not.toBeInTheDocument()
      expect(amdRow).toBeInTheDocument()
    } finally {
      vi.stubGlobal('__APP_EDITION__', 'global')
      availability.hidesEveryModel = true
    }
  })
})
