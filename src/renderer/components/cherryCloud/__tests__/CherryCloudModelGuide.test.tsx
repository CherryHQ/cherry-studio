import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Model } from '@shared/data/types/model'

import { CherryCloudModelGuide } from '../CherryCloudModelGuide'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { model?: string }) => (options?.model ? `${key}:${options.model}` : key)
  })
}))
let activeTab = true
vi.mock('@renderer/hooks/tab', () => ({ useIsActiveTab: () => activeTab }))

const model = (id: string, name: string) =>
  ({ id: `cherryai-subscription::${id}`, providerId: 'cherryai-subscription', name }) as unknown as Model
const fast = model('fast', 'Fast Model')
const coder = model('coder', 'Coder Model')

function Harness({
  ready = true,
  currentModelId,
  onSelectModel
}: {
  ready?: boolean
  currentModelId?: string
  onSelectModel: (model: Model) => void
}) {
  const anchorRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <button ref={anchorRef} type="button">
        model trigger
      </button>
      <CherryCloudModelGuide
        anchorRef={anchorRef}
        ready={ready}
        currentModelId={currentModelId}
        onSelectModel={onSelectModel}
      />
    </>
  )
}

beforeEach(() => {
  MockUseCacheUtils.resetMocks()
  activeTab = true
  mockUseQuery.mockReturnValue({
    data: [fast, coder],
    isLoading: false,
    isRefreshing: false,
    refetch: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined)
  })
})

describe('CherryCloudModelGuide', () => {
  it('switches to the chosen model once even while the header handler changes identity', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.cherry_cloud.model_guide', {
      modelIds: [fast.id, coder.id],
      selectedModelId: coder.id,
      switchedModelId: null
    })
    const onSelectModel = vi.fn()
    // The chat header recreates its handler on every state change while the switch is in flight.
    const { rerender } = render(<Harness currentModelId={fast.id} onSelectModel={(m) => onSelectModel(m)} />)
    rerender(<Harness currentModelId={fast.id} onSelectModel={(m) => onSelectModel(m)} />)
    rerender(<Harness currentModelId={fast.id} onSelectModel={(m) => onSelectModel(m)} />)

    expect(onSelectModel).toHaveBeenCalledExactlyOnceWith(coder)
    expect(screen.queryByText(/guide_switched/)).not.toBeInTheDocument()

    rerender(<Harness currentModelId={coder.id} onSelectModel={(m) => onSelectModel(m)} />)
    expect(MockUseCacheUtils.getPersistCacheValue('ui.cherry_cloud.model_guide')).toEqual({
      modelIds: [fast.id, coder.id],
      selectedModelId: null,
      switchedModelId: coder.id
    })
    rerender(<Harness currentModelId={coder.id} onSelectModel={(m) => onSelectModel(m)} />)
    expect(screen.getByText('settings.subscription.activation.guide_switched:Coder Model')).toBeInTheDocument()
    expect(screen.getByText('Fast Model')).toBeInTheDocument()
    expect(onSelectModel).toHaveBeenCalledOnce()
  })

  it('never shows again after it is dismissed', async () => {
    MockUseCacheUtils.setPersistCacheValue('ui.cherry_cloud.model_guide', {
      modelIds: [fast.id],
      selectedModelId: null,
      switchedModelId: null
    })
    const user = userEvent.setup()
    const { rerender } = render(<Harness onSelectModel={vi.fn()} />)
    expect(screen.getByText('settings.subscription.activation.guide_title')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'settings.subscription.activation.guide_dismiss' }))
    rerender(<Harness onSelectModel={vi.fn()} />)

    expect(MockUseCacheUtils.getPersistCacheValue('ui.cherry_cloud.model_guide')).toBeNull()
    expect(screen.queryByText('settings.subscription.activation.guide_title')).not.toBeInTheDocument()
  })

  it('waits for the active tab and a ready conversation before switching', () => {
    MockUseCacheUtils.setPersistCacheValue('ui.cherry_cloud.model_guide', {
      modelIds: [fast.id],
      selectedModelId: fast.id,
      switchedModelId: null
    })
    const onSelectModel = vi.fn()
    activeTab = false
    const { rerender } = render(<Harness onSelectModel={onSelectModel} />)
    activeTab = true
    rerender(<Harness ready={false} onSelectModel={onSelectModel} />)

    expect(onSelectModel).not.toHaveBeenCalled()
    expect(screen.queryByText('settings.subscription.activation.guide_title')).not.toBeInTheDocument()
  })
})
