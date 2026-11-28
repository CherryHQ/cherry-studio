import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Fragment, type ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { SubscriptionModelNotice } from '../SubscriptionModelNotice'

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
const plans = vi.hoisted(() => ({
  isPlansReady: true,
  activePaid: undefined as { id: string; plan: { display_name: string } } | undefined
}))
vi.mock('@renderer/hooks/useCherryCloudPlans', () => ({
  useCherryCloudPlans: () => ({
    session: { status: { phase: 'signed-in' } },
    plansQuery: {},
    activePaid: plans.activePaid,
    upcomingPaid: undefined,
    isPlansReady: plans.isPlansReady
  })
}))
vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: () => false,
    isModelFree: () => false,
    isModelUnavailable: () => false,
    getModelDescription: () => undefined,
    isAvailabilityReady: true,
    availabilityError: undefined,
    amdActivationRequiredModels: [
      { id: 'amd/qwen', display_name: 'AMD Qwen', available_features: ['chat', 'translate'] }
    ],
    signInRequiredModels: []
  })
}))

const provider = (id: string, name: string) => ({
  id,
  name,
  apiKeys: [],
  authType: 'api-key',
  reportsActualCost: false,
  settings: {},
  isEnabled: true
})
const model = (providerId: string, modelId: string): Model => ({
  id: `${providerId}::${modelId}`,
  providerId,
  name: modelId,
  capabilities: [],
  supportsStreaming: true,
  isEnabled: true,
  isHidden: false
})

const openaiModel = model('openai', 'gpt-4o')
const subscriptionModel = model('cherryai-subscription', 'claude-sonnet')
const subscriptionEmbedding = model('cherryai-subscription', 'cloud-embedding')

beforeEach(() => {
  vi.clearAllMocks()
  plans.isPlansReady = true
  plans.activePaid = { id: 'pro', plan: { display_name: 'Pro' } }
  const providers = [provider('cherryai-subscription', 'CherryAI'), provider('openai', 'OpenAI')]
  const models = [openaiModel, subscriptionModel, subscriptionEmbedding]
  mockUseQuery.mockImplementation((path: string) => ({
    data: path === '/models' ? models : path === '/providers' ? providers : [],
    isLoading: false,
    isRefreshing: false,
    refetch: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined)
  }))
})

function renderNotice(props: Partial<React.ComponentProps<typeof SubscriptionModelNotice>> = {}) {
  const onSelect = vi.fn()
  render(
    <SWRConfig value={{ provider: () => new Map() }}>
      <SubscriptionModelNotice
        providerFailed
        currentModel={openaiModel}
        filter={(candidate) => candidate.id !== subscriptionEmbedding.id}
        onSelect={onSelect}
        {...props}
      />
    </SWRConfig>
  )
  return onSelect
}

describe('SubscriptionModelNotice', () => {
  it('switches a paid subscriber to a subscription model picked from the notice', async () => {
    const onSelect = renderNotice()

    expect(screen.getByRole('status')).toHaveTextContent('你已订阅 CherryAI，可改用订阅模型继续')
    await userEvent.click(screen.getByRole('button', { name: '改用订阅模型' }))
    await userEvent.click(await screen.findByText('claude-sonnet'))

    expect(onSelect).toHaveBeenCalledWith(subscriptionModel)
  })

  it('lists only subscription models the composer accepts, without locked offer rows', async () => {
    renderNotice()

    await userEvent.click(screen.getByRole('button', { name: '改用订阅模型' }))

    expect(await screen.findByText('claude-sonnet')).toBeInTheDocument()
    expect(screen.queryByText('gpt-4o')).not.toBeInTheDocument()
    expect(screen.queryByText('cloud-embedding')).not.toBeInTheDocument()
    expect(screen.queryByText('AMD Qwen')).not.toBeInTheDocument()
  })

  it.each([
    ['there is no paid plan', () => (plans.activePaid = undefined), {}],
    ['the plans are not fresh', () => (plans.isPlansReady = false), {}],
    ['the latest reply has no qualifying failure', () => undefined, { providerFailed: false }],
    ['the composer already uses a subscription model', () => undefined, { currentModel: subscriptionModel }]
  ])('stays hidden when %s', (_case, arrange, props) => {
    arrange()
    renderNotice(props)

    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })
})
