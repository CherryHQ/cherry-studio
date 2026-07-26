import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import ProviderModelPullReconcile from '../ProviderModelPullReconcile'

const pullReconcileState = vi.hoisted(() => ({
  value: {
    addModels: vi.fn(),
    allModels: [],
    cleanStaleModels: vi.fn(),
    closePullReconcile: vi.fn(),
    isApplyingPullReconcile: false,
    isBusy: false,
    isLoadingModels: false,
    loadErrorMessage: null,
    localModels: [],
    openPullReconcile: vi.fn(),
    provider: { id: 'openai', name: 'OpenAI' },
    pullReconcileDrawerOpen: false,
    reloadModels: vi.fn(),
    removeModels: vi.fn(),
    staleModelCount: 0,
    staleModelIds: []
  }
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    Button: ({ children, loading, ...props }: any) => (
      <button type="button" data-loading={loading ? 'true' : 'false'} {...props}>
        {children}
      </button>
    )
  }
})

vi.mock('../ModelListSyncDrawer', () => ({
  default: () => null
}))

vi.mock('../useProviderModelPullReconcile', () => ({
  useProviderModelPullReconcile: () => pullReconcileState.value
}))

describe('ProviderModelPullReconcile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    pullReconcileState.value.isBusy = false
  })

  it('shows the refresh icon when the pull action is idle', () => {
    const { container } = render(<ProviderModelPullReconcile providerId="openai" disabled={false} />)

    expect(screen.getByRole('button', { name: 'settings.models.toolbar.pull_short' })).toHaveAttribute(
      'data-loading',
      'false'
    )
    expect(container.querySelector('.lucide-refresh-cw')).toBeInTheDocument()
  })

  it('hides the refresh icon while the button renders its loading indicator', () => {
    pullReconcileState.value.isBusy = true

    const { container } = render(<ProviderModelPullReconcile providerId="openai" disabled={false} />)

    expect(screen.getByRole('button', { name: 'settings.models.toolbar.pull_short' })).toHaveAttribute(
      'data-loading',
      'true'
    )
    expect(container.querySelector('.lucide-refresh-cw')).not.toBeInTheDocument()
  })

  it('shows a temporary guide arrow instead of opening the drawer when requested', () => {
    vi.useFakeTimers()
    const { rerender } = render(<ProviderModelPullReconcile providerId="openai" disabled={false} guideVersion={0} />)

    act(() => {
      rerender(<ProviderModelPullReconcile providerId="openai" disabled={false} guideVersion={1} />)
    })

    expect(pullReconcileState.value.openPullReconcile).not.toHaveBeenCalled()
    expect(screen.getByTestId('model-pull-guide-arrow')).toHaveClass('text-muted-foreground')

    act(() => {
      vi.advanceTimersByTime(1200)
    })

    expect(screen.queryByTestId('model-pull-guide-arrow')).not.toBeInTheDocument()
  })
})
