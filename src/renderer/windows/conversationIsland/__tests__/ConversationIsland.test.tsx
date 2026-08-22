import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationIsland from '../ConversationIsland'

const mocks = vi.hoisted(() => ({
  initData: null as ConversationIslandSnapshot | null,
  ipcRequest: vi.fn(),
  loggerError: vi.fn()
}))

vi.mock('@renderer/hooks/useWindowInitData', () => ({
  useWindowInitData: () => mocks.initData
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: (...args: unknown[]) => mocks.ipcRequest(...args) }
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))

const activity = (
  activityId: string,
  title: string,
  overrides: Partial<ConversationIslandActivityItem> = {}
): ConversationIslandActivityItem => ({
  activityId,
  target: { conversationType: 'assistant', conversationId: activityId },
  state: 'streaming',
  statusText: 'Responding',
  title,
  ...overrides
})

const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  ...activity('topic-1', 'New Chat'),
  activityCountText: 'Total: 1',
  secondaryCount: 0,
  presentation: 'capsule',
  expanded: false,
  exiting: false,
  reducedMotion: false,
  ...overrides
})

const expandedSnapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => {
  const activities = [
    activity('topic-1', 'New Chat'),
    activity('topic-2', 'Review plan', { state: 'awaiting-confirmation', statusText: 'Waiting' })
  ]

  return snapshot({ secondaryCount: 1, expanded: true, activities, ...overrides })
}

const expansionRequests = () =>
  mocks.ipcRequest.mock.calls.filter(([route]) => route === 'conversation_island.set_expanded')

const advance = (milliseconds: number) => act(() => vi.advanceTimersByTime(milliseconds))

describe('ConversationIsland', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initData = null
    mocks.ipcRequest.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing until WindowManager init data arrives', () => {
    const { container } = render(<ConversationIsland />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders status text and the required title while gating the secondary count', () => {
    mocks.initData = snapshot()
    const view = render(<ConversationIsland />)

    expect(screen.getByText('Responding')).toBeVisible()
    expect(screen.getByText('New Chat')).toBeVisible()
    expect(screen.queryByText('+2')).toBeNull()

    mocks.initData = snapshot({ title: 'Research notes', secondaryCount: 2 })
    view.rerender(<ConversationIsland />)

    expect(screen.getByText('Research notes')).toBeVisible()
    expect(screen.getByText('+2')).toBeVisible()
  })

  it('keeps notch content in two wings around the measured occlusion', () => {
    mocks.initData = snapshot({
      presentation: 'notch',
      notchWidth: 120,
      title: 'Research notes',
      secondaryCount: 2
    })
    const view = render(<ConversationIsland />)

    const button = screen.getByRole('button')
    const leading = screen.getByTestId('notch-leading')
    const occlusion = screen.getByTestId('notch-occlusion')
    const trailing = screen.getByTestId('notch-trailing')

    // These classes and the measured width are the physical-notch layout contract.
    expect(button).toHaveClass('bg-black', 'rounded-t-none', 'rounded-b-[12px]', 'border-0', 'shadow-none')
    expect(button).not.toHaveClass(
      'rounded-none',
      'rounded-b-xl',
      'border-transparent',
      'shadow-md',
      'backdrop-blur-xs'
    )
    expect(occlusion).toHaveStyle({ width: '120px' })
    expect(within(leading).getByText('Responding')).toBeVisible()
    expect(within(trailing).getByText('Research notes')).toBeVisible()
    expect(within(trailing).getByText('+2')).toBeVisible()

    mocks.initData = snapshot({ presentation: 'notch', notchWidth: 120, secondaryCount: 2 })
    view.rerender(<ConversationIsland />)

    expect(screen.queryByText('Research notes')).toBeNull()
    expect(within(screen.getByTestId('notch-trailing')).getByText('New Chat')).toBeVisible()
    expect(within(screen.getByTestId('notch-trailing')).getByText('+2')).toBeVisible()
  })

  it('keeps capsule styling for capsule snapshots', () => {
    mocks.initData = snapshot()
    render(<ConversationIsland />)

    expect(screen.queryByTestId('notch-occlusion')).toBeNull()
    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')
  })

  it.each([
    { notchWidth: undefined },
    { notchWidth: Number.NaN },
    { notchWidth: Number.POSITIVE_INFINITY },
    { notchWidth: 0 },
    { notchWidth: -1 }
  ])('keeps capsule styling for invalid notch width $notchWidth', ({ notchWidth }) => {
    mocks.initData = snapshot({ presentation: 'notch', notchWidth })
    render(<ConversationIsland />)

    expect(screen.queryByTestId('notch-occlusion')).toBeNull()
    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')
  })

  it('opens the primary conversation when the compact pill is clicked', async () => {
    const user = userEvent.setup()
    mocks.initData = snapshot({ title: 'Research notes' })
    render(<ConversationIsland />)

    await user.click(screen.getByRole('button'))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.focus_or_open_conversation', {
      target: mocks.initData.target,
      title: 'Research notes'
    })
  })

  it('logs compact navigation failures without replacing the activity surface', async () => {
    const user = userEvent.setup()
    const error = new Error('navigation failed')
    mocks.ipcRequest.mockRejectedValue(error)
    mocks.initData = snapshot()
    render(<ConversationIsland />)

    await user.click(screen.getByRole('button'))

    await waitFor(() =>
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to open conversation from Conversation Island', error)
    )
    expect(screen.getByText('Responding')).toBeVisible()
  })

  it('requests expansion only after a 500ms dwell with secondary activities', async () => {
    vi.useFakeTimers()
    mocks.initData = snapshot({ secondaryCount: 1 })
    render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(499)
    expect(expansionRequests()).toEqual([])

    await advance(1)
    expect(expansionRequests()).toEqual([['conversation_island.set_expanded', { expanded: true }]])
  })

  it('does not expand a single activity and cancels a pending dwell when the pointer leaves', async () => {
    vi.useFakeTimers()
    mocks.initData = snapshot()
    const view = render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(500)
    expect(expansionRequests()).toEqual([])

    mocks.initData = snapshot({ secondaryCount: 1 })
    view.rerender(<ConversationIsland />)
    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(499)
    fireEvent.pointerLeave(screen.getByRole('button'))
    await advance(1)

    expect(expansionRequests()).toEqual([])
  })

  it.each([
    ['an expanded snapshot', expandedSnapshot()],
    ['no secondary activities', snapshot({ secondaryCount: 0 })]
  ])('cancels a pending dwell when the authoritative snapshot reports %s', async (_label, nextSnapshot) => {
    vi.useFakeTimers()
    mocks.initData = snapshot({ secondaryCount: 1 })
    const view = render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(250)
    mocks.initData = nextSnapshot
    view.rerender(<ConversationIsland />)
    await advance(250)

    expect(expansionRequests()).toEqual([])
  })

  it('collapses after a 250ms expanded leave and cancels collapse on re-entry', async () => {
    vi.useFakeTimers()
    mocks.initData = expandedSnapshot()
    render(<ConversationIsland />)
    const surface = screen.getByTestId('conversation-island-surface')

    fireEvent.pointerLeave(surface)
    await advance(249)
    expect(expansionRequests()).toEqual([])

    fireEvent.pointerEnter(surface)
    await advance(1)
    expect(expansionRequests()).toEqual([])

    fireEvent.pointerLeave(surface)
    await advance(250)
    expect(expansionRequests()).toEqual([['conversation_island.set_expanded', { expanded: false }]])
  })

  it('collapses before navigating to the clicked expanded activity', async () => {
    const user = userEvent.setup()
    let resolveCollapse!: () => void
    const collapse = new Promise<void>((resolve) => {
      resolveCollapse = resolve
    })
    mocks.ipcRequest.mockImplementation((route: string) =>
      route === 'conversation_island.set_expanded' ? collapse : Promise.resolve(undefined)
    )
    mocks.initData = expandedSnapshot()
    render(<ConversationIsland />)

    await user.click(screen.getByRole('button', { name: 'Waiting: Review plan' }))

    expect(mocks.ipcRequest.mock.calls).toEqual([['conversation_island.set_expanded', { expanded: false }]])

    resolveCollapse()
    await waitFor(() =>
      expect(mocks.ipcRequest.mock.calls).toEqual([
        ['conversation_island.set_expanded', { expanded: false }],
        [
          'navigation.focus_or_open_conversation',
          {
            target: { conversationType: 'assistant', conversationId: 'topic-2' },
            title: 'Review plan'
          }
        ]
      ])
    )
  })

  it('navigates after collapse rejection and reports collapse and navigation failures separately', async () => {
    const user = userEvent.setup()
    const collapseError = new Error('collapse failed')
    const navigationError = new Error('navigation failed')
    mocks.ipcRequest.mockRejectedValueOnce(collapseError).mockRejectedValueOnce(navigationError)
    mocks.initData = expandedSnapshot()
    render(<ConversationIsland />)

    await user.click(screen.getByRole('button', { name: 'Waiting: Review plan' }))

    await waitFor(() => expect(mocks.ipcRequest).toHaveBeenCalledTimes(2))
    expect(mocks.ipcRequest.mock.calls[1]).toEqual([
      'navigation.focus_or_open_conversation',
      {
        target: { conversationType: 'assistant', conversationId: 'topic-2' },
        title: 'Review plan'
      }
    ])
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to collapse Conversation Island before navigation',
      collapseError
    )
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'Failed to open conversation from Conversation Island',
      navigationError
    )
  })

  it('requires a fresh compact leave and re-entry after an expanded row click', async () => {
    const user = userEvent.setup()
    mocks.initData = expandedSnapshot()
    const view = render(<ConversationIsland />)

    await user.click(screen.getByRole('button', { name: 'Waiting: Review plan' }))
    vi.useFakeTimers()
    mocks.initData = snapshot({ secondaryCount: 1 })
    view.rerender(<ConversationIsland />)

    const compactSurface = screen.getByRole('button')
    fireEvent.pointerLeave(compactSurface)
    fireEvent.pointerEnter(compactSurface)
    await advance(500)
    expect(expansionRequests()).toEqual([['conversation_island.set_expanded', { expanded: false }]])

    fireEvent.pointerLeave(compactSurface)
    fireEvent.pointerEnter(compactSurface)
    await advance(499)
    expect(expansionRequests()).toHaveLength(1)
    await advance(1)
    expect(expansionRequests()).toEqual([
      ['conversation_island.set_expanded', { expanded: false }],
      ['conversation_island.set_expanded', { expanded: true }]
    ])
  })

  it('honors a real leave before the compact snapshot arrives', async () => {
    const user = userEvent.setup()
    mocks.initData = expandedSnapshot()
    const view = render(<ConversationIsland />)

    await user.click(screen.getByRole('button', { name: 'Waiting: Review plan' }))
    vi.useFakeTimers()
    fireEvent.pointerLeave(screen.getByTestId('conversation-island-surface'))

    mocks.initData = snapshot({ secondaryCount: 1 })
    view.rerender(<ConversationIsland />)
    fireEvent.pointerEnter(screen.getByRole('button'))

    await advance(499)
    expect(expansionRequests()).toEqual([['conversation_island.set_expanded', { expanded: false }]])
    await advance(1)
    expect(expansionRequests()).toEqual([
      ['conversation_island.set_expanded', { expanded: false }],
      ['conversation_island.set_expanded', { expanded: true }]
    ])
  })

  it('keeps all activities in equal-height accessible rows inside a five-row scroller', () => {
    const activities = Array.from({ length: 6 }, (_, index) =>
      activity(`topic-${index + 1}`, `Activity ${index + 1}`, {
        statusText: index === 2 ? 'Waiting' : 'Responding',
        state: index === 2 ? 'awaiting-confirmation' : 'streaming'
      })
    )
    mocks.initData = expandedSnapshot({ activityId: 'topic-3', activities, secondaryCount: 5 })
    render(<ConversationIsland />)

    const rows = screen.getAllByRole('button')
    expect(rows).toHaveLength(6)
    expect(rows.map((row) => row.getAttribute('aria-label'))).toEqual([
      'Responding: Activity 1',
      'Responding: Activity 2',
      'Waiting: Activity 3',
      'Responding: Activity 4',
      'Responding: Activity 5',
      'Responding: Activity 6'
    ])
    for (const row of rows) expect(row).toHaveClass('h-11')
    expect(screen.getByRole('button', { name: 'Waiting: Activity 3' })).toHaveClass('bg-accent', 'font-medium')

    // The max height and overflow classes are the fixed five-row window layout contract.
    expect(screen.getByRole('list')).toHaveClass('max-h-[220px]', 'overflow-y-auto')
  })

  it('uses notch and capsule expanded surfaces without recalculating window bounds', () => {
    mocks.initData = expandedSnapshot({ presentation: 'notch', notchWidth: 120 })
    const view = render(<ConversationIsland />)

    const notchSurface = screen.getByTestId('conversation-island-surface')
    expect(notchSurface).toHaveClass('bg-black', 'rounded-t-none', 'rounded-b-[12px]', 'pt-[38px]')
    expect(notchSurface).not.toHaveClass('p-2', 'bg-popover')

    mocks.initData = expandedSnapshot({ presentation: 'capsule' })
    view.rerender(<ConversationIsland />)

    const capsuleSurface = screen.getByTestId('conversation-island-surface')
    expect(capsuleSurface).toHaveClass('bg-popover', 'text-popover-foreground', 'p-2')
    expect(capsuleSurface).not.toHaveClass('pt-[38px]', 'bg-black')
  })

  it('cleans pending expand and collapse timers on unmount', async () => {
    vi.useFakeTimers()
    mocks.initData = snapshot({ secondaryCount: 1 })
    const compactView = render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    compactView.unmount()
    await advance(500)
    expect(expansionRequests()).toEqual([])

    mocks.initData = expandedSnapshot()
    const expandedView = render(<ConversationIsland />)
    fireEvent.pointerLeave(screen.getByTestId('conversation-island-surface'))
    expandedView.unmount()
    await advance(250)

    expect(expansionRequests()).toEqual([])
  })
})
