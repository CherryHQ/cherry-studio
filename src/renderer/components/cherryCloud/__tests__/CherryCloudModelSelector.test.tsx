import { mockUseQuery } from '@test-mocks/renderer/useDataApi'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { startCherryCloudSubscription } from '@renderer/services/cherryCloudSubscription'

import { CherryCloudModelSelector } from '../CherryCloudModelSelector'

vi.unmock('@cherrystudio/ui')
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
vi.mock('@renderer/hooks/useCherryCloudModelAvailability', () => ({
  useCherryCloudModelAvailability: () => ({
    isModelHidden: () => true,
    isModelFree: () => false,
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
