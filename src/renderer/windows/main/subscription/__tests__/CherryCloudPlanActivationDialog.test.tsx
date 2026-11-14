import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { openRoute } from '@renderer/services/mainWindowNavigation'
import type { Model } from '@shared/data/types/model'

import { CherryCloudPlanActivationDialog } from '../CherryCloudPlanActivationDialog'

vi.unmock('@cherrystudio/ui')
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => (options?.count ? `${key}:${options.count}` : key),
    i18n: { language: 'en-US' }
  })
}))
let activeTabUrl = '/app/launchpad'
vi.mock('@renderer/hooks/tab', () => ({ useTabs: () => ({ activeTab: { url: activeTabUrl } }) }))
vi.mock('@renderer/services/mainWindowNavigation', () => ({ openRoute: vi.fn() }))

const model = (id: string) =>
  ({ id: `cherryai-subscription::${id}`, providerId: 'cherryai-subscription', name: `Model ${id}` }) as unknown as Model
const models = ['a', 'b', 'c', 'd', 'e'].map(model)
const ids = models.map((item) => item.id)

beforeEach(() => {
  vi.clearAllMocks()
  MockUseCacheUtils.resetMocks()
  MockUsePreferenceUtils.resetMocks()
  activeTabUrl = '/app/launchpad'
  mockUseQuery.mockReturnValue({
    data: models,
    isLoading: false,
    isRefreshing: false,
    refetch: vi.fn(async () => undefined),
    mutate: vi.fn(async () => undefined)
  })
})

describe('CherryCloudPlanActivationDialog', () => {
  it('lists three models, summarizes the rest, and starts the chat with the picked one', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CherryCloudPlanActivationDialog activation={{ modelIds: ids, expiresAt: null }} onClose={onClose} />)

    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByText('settings.subscription.activation.more_models:2')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Model a/ })).toHaveAttribute('aria-checked', 'true')

    await user.click(screen.getByRole('radio', { name: /Model b/ }))
    await user.click(screen.getByRole('button', { name: /settings.subscription.activation.start_chat/ }))

    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(MockUseCacheUtils.getPersistCacheValue('ui.cherry_cloud.model_guide')).toEqual({
      modelIds: ids,
      selectedModelId: models[1].id,
      switchedModelId: null
    })
    expect(openRoute).toHaveBeenCalledWith('/app/chat')
    expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_model_id')).toBeNull()
  })

  it('also sets the default model when asked and stays on an open chat tab', async () => {
    activeTabUrl = '/app/chat?topicId=t1'
    const user = userEvent.setup()
    render(
      <CherryCloudPlanActivationDialog activation={{ modelIds: ids.slice(0, 2), expiresAt: null }} onClose={vi.fn()} />
    )

    await user.click(screen.getByRole('checkbox'))
    await user.click(screen.getByRole('button', { name: /settings.subscription.activation.start_chat/ }))

    await waitFor(() => expect(MockUsePreferenceUtils.getPreferenceValue('chat.default_model_id')).toBe(models[0].id))
    expect(openRoute).not.toHaveBeenCalled()
  })

  it('records the new models without a choice when dismissed', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    render(<CherryCloudPlanActivationDialog activation={{ modelIds: ids, expiresAt: null }} onClose={onClose} />)

    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
    expect(MockUseCacheUtils.getPersistCacheValue('ui.cherry_cloud.model_guide')).toEqual({
      modelIds: ids,
      selectedModelId: null,
      switchedModelId: null
    })
    expect(openRoute).not.toHaveBeenCalled()
  })
})
