import type { ConversationIslandActivityItem, ConversationIslandSnapshot } from '@shared/types/conversationIsland'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { HTMLAttributes, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConversationIsland from '../ConversationIsland'

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  layout?: unknown
  transition?: unknown
}

vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({ children, ...motionProps }: MotionDivProps) => {
      const { animate, initial, transition } = motionProps
      const domProps = { ...motionProps }
      delete domProps.animate
      delete domProps.exit
      delete domProps.initial
      delete domProps.layout
      delete domProps.transition

      return (
        <div
          {...domProps}
          data-animate={JSON.stringify(animate)}
          data-initial={JSON.stringify(initial)}
          data-transition={JSON.stringify(transition)}>
          {children}
        </div>
      )
    }
  }
}))

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
  identityAvatar: '🌸',
  identityName: 'Cherry Assistant',
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

const expectTextOrder = (element: HTMLElement, texts: string[]) => {
  const content = element.textContent ?? ''
  const positions = texts.map((text) => content.indexOf(text))

  expect(positions.every((position) => position >= 0)).toBe(true)
  expect(positions).toEqual([...positions].sort((left, right) => left - right))
}

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

  it('prioritizes the compact capsule title and shows the localized total badge only for multiple activities', () => {
    mocks.initData = snapshot()
    const view = render(<ConversationIsland />)

    expect(screen.getByText('Responding')).toBeVisible()
    expect(screen.getByText('New Chat')).toBeVisible()
    expect(screen.queryByLabelText('Total: 1')).toBeNull()

    mocks.initData = snapshot({ title: 'Research notes', activityCountText: 'Total: 3', secondaryCount: 2 })
    view.rerender(<ConversationIsland />)

    expect(screen.getByText('Research notes')).toBeVisible()
    expect(screen.getByText('Responding')).toBeVisible()
    expect(screen.getByLabelText('Total: 3')).toHaveTextContent('3')
    expect(screen.queryByText('+2')).toBeNull()
  })

  it('keeps notch content in two wings around the measured occlusion', () => {
    mocks.initData = snapshot({
      identityAvatar: '🧠',
      identityName: 'Research Assistant',
      presentation: 'notch',
      notchWidth: 120,
      title: 'Research notes',
      activityCountText: 'Total: 3',
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
    expect(within(leading).getByText('Research notes')).toBeVisible()
    expect(within(trailing).getByText('Responding')).toBeVisible()
    expect(within(trailing).getByLabelText('Total: 3')).toHaveTextContent('3')
    expect(within(trailing).queryByText('+2')).toBeNull()
    expect(screen.queryByText('Research Assistant')).toBeNull()
    expect(screen.queryByText('🧠')).toBeNull()

    mocks.initData = snapshot({
      presentation: 'notch',
      notchWidth: 120,
      activityCountText: 'Total: 3',
      secondaryCount: 2
    })
    view.rerender(<ConversationIsland />)

    expect(screen.queryByText('Research notes')).toBeNull()
    expect(within(screen.getByTestId('notch-leading')).getByText('New Chat')).toBeVisible()
    expect(within(screen.getByTestId('notch-trailing')).getByLabelText('Total: 3')).toHaveTextContent('3')
  })

  it('keeps capsule styling for capsule snapshots', () => {
    mocks.initData = snapshot()
    render(<ConversationIsland />)

    expect(screen.queryByTestId('notch-occlusion')).toBeNull()
    expect(screen.queryByTestId('notch-expanded-header')).toBeNull()
    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')
  })

  it.each(['notch', 'capsule'] as const)(
    'shows the same multi-activity summary and identity/status/title rows in the %s shell',
    (presentation) => {
      const activities = [
        activity('topic-1', 'Research notes'),
        activity('topic-2', 'Review plan', {
          identityAvatar: '🤖',
          identityName: 'Planning Agent',
          state: 'awaiting-confirmation',
          statusText: 'Waiting'
        })
      ]
      mocks.initData = expandedSnapshot({
        activities,
        activityCountText: 'Total: 2',
        notchWidth: presentation === 'notch' ? 180 : undefined,
        presentation,
        title: 'Research notes'
      })
      render(<ConversationIsland />)

      const summary = screen.getByTestId(presentation === 'notch' ? 'notch-expanded-header' : 'capsule-expanded-header')
      expect(within(summary).getByText('Responding')).toBeVisible()
      expect(within(summary).getByText('Total: 2')).toBeVisible()
      expect(summary.querySelector('.lucide-message-circle, .lucide-bot')).toBeNull()

      if (presentation === 'notch') {
        expect(screen.getByTestId('notch-expanded-occlusion')).toHaveStyle({ width: '180px' })
      }

      const primary = screen.getByRole('button', { name: 'Responding: Research notes' })
      const secondary = screen.getByRole('button', { name: 'Waiting: Review plan' })
      expectTextOrder(primary, ['Cherry Assistant', 'Responding', 'Research notes'])
      expectTextOrder(secondary, ['Planning Agent', 'Waiting', 'Review plan'])
      expect(primary).toHaveClass('gap-2')
      expect(within(primary).getByText('Cherry Assistant').parentElement).toHaveClass('gap-1')
      expect(within(secondary).getByText('Planning Agent').parentElement).toHaveClass('gap-1')

      // Permanent fill or weight would make Primary look selected instead of merely ordered first.
      expect(primary).not.toHaveClass('bg-accent', 'bg-white/10', 'font-medium')
    }
  )

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

  it('cancels a compact dwell and blocks interaction when the exit snapshot arrives', async () => {
    vi.useFakeTimers()
    mocks.initData = snapshot({ secondaryCount: 1 })
    const view = render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    mocks.initData = snapshot({ secondaryCount: 1, exiting: true })
    view.rerender(<ConversationIsland />)

    const surface = screen.getByTestId('conversation-island-surface')
    const motionRoot = screen.getByTestId('conversation-island-motion')
    expect(surface).toHaveAttribute('aria-hidden', 'true')
    expect(surface).toBeDisabled()
    expect(motionRoot).toHaveAttribute('data-animate', JSON.stringify({ opacity: 0, scaleX: 0.96, scaleY: 0.82 }))
    expect(motionRoot).toHaveStyle({ transformOrigin: '50% 0%' })

    await advance(500)
    expect(expansionRequests()).toEqual([])
  })

  it('disables expanded activity navigation and hover requests while exiting', async () => {
    vi.useFakeTimers()
    mocks.initData = expandedSnapshot()
    const view = render(<ConversationIsland />)

    fireEvent.pointerLeave(screen.getByTestId('conversation-island-surface'))
    mocks.initData = expandedSnapshot({ exiting: true })
    view.rerender(<ConversationIsland />)

    const surface = screen.getByTestId('conversation-island-surface')
    const buttons = screen.getAllByRole('button', { hidden: true })
    expect(surface).toHaveAttribute('aria-hidden', 'true')
    for (const button of buttons) expect(button).toBeDisabled()

    fireEvent.click(buttons[1])
    fireEvent.pointerEnter(surface)
    fireEvent.pointerLeave(surface)
    await advance(500)

    expect(mocks.ipcRequest).not.toHaveBeenCalled()
  })

  it('makes the exit transition immediate when the snapshot reduces motion', () => {
    mocks.initData = snapshot({ exiting: true, reducedMotion: true })
    render(<ConversationIsland />)

    expect(screen.getByTestId('conversation-island-motion')).toHaveAttribute(
      'data-transition',
      JSON.stringify({ duration: 0 })
    )
  })

  it('requests single-activity expansion after a 500ms dwell and cancels a new pending dwell on leave', async () => {
    vi.useFakeTimers()
    mocks.initData = snapshot()
    const view = render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(499)
    expect(expansionRequests()).toEqual([])
    await advance(1)
    expect(expansionRequests()).toEqual([['conversation_island.set_expanded', { expanded: true }]])

    mocks.initData = snapshot({ secondaryCount: 1 })
    view.rerender(<ConversationIsland />)
    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(499)
    fireEvent.pointerLeave(screen.getByRole('button'))
    await advance(1)

    expect(expansionRequests()).toEqual([['conversation_island.set_expanded', { expanded: true }]])
  })

  it('cancels a pending dwell when the authoritative snapshot reports expansion', async () => {
    vi.useFakeTimers()
    mocks.initData = snapshot({ secondaryCount: 1 })
    const view = render(<ConversationIsland />)

    fireEvent.pointerEnter(screen.getByRole('button'))
    await advance(250)
    mocks.initData = expandedSnapshot()
    view.rerender(<ConversationIsland />)
    await advance(250)

    expect(expansionRequests()).toEqual([])
  })

  it.each(['notch', 'capsule'] as const)(
    'shows identity and status above one title button without list semantics in the %s shell',
    (presentation) => {
      mocks.initData = snapshot({
        expanded: true,
        identityAvatar: '🧠',
        identityName: 'Research Assistant',
        notchWidth: presentation === 'notch' ? 120 : undefined,
        presentation,
        title: 'Investigate rendering behavior'
      })
      render(<ConversationIsland />)

      const summary = screen.getByTestId(presentation === 'notch' ? 'notch-expanded-header' : 'capsule-expanded-header')
      expect(within(summary).getByText('Research Assistant')).toBeVisible()
      const avatar = within(summary).getByTestId('emoji-icon')
      expect(avatar).toHaveTextContent('🧠')
      expect(avatar.closest('[aria-hidden="true"]')?.parentElement).toHaveClass('gap-1')
      expect(within(summary).getByTestId('state-indicator')).toBeInTheDocument()
      expect(within(summary).getByText('Responding')).toBeVisible()

      const detail = screen.getByRole('button', { name: 'Responding: Investigate rendering behavior' })
      // The body height is the approved single-detail geometry contract below the fixed 38px summary.
      expect(detail).toHaveClass('h-[44px]')
      expect(within(detail).getByText('Investigate rendering behavior')).toBeVisible()
      expect(within(detail).queryByText('Responding')).toBeNull()
      expect(screen.queryByRole('list')).toBeNull()
      expect(screen.getAllByRole('button')).toHaveLength(1)
    }
  )

  it('collapses and opens the single activity when its expanded title is clicked', async () => {
    const user = userEvent.setup()
    mocks.initData = snapshot({
      expanded: true,
      notchWidth: 120,
      presentation: 'notch',
      title: 'Research notes'
    })
    render(<ConversationIsland />)

    await user.click(screen.getByRole('button', { name: 'Responding: Research notes' }))

    expect(mocks.ipcRequest.mock.calls).toEqual([
      ['conversation_island.set_expanded', { expanded: false }],
      [
        'navigation.focus_or_open_conversation',
        {
          target: { conversationType: 'assistant', conversationId: 'topic-1' },
          title: 'Research notes'
        }
      ]
    ])
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

  it('keeps all activities in equal-height accessible rows inside the four-row scroller', () => {
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
    for (const row of rows) expect(row).toHaveClass('h-[52px]', 'gap-2')
    expect(within(rows[0]).getByText('Cherry Assistant').parentElement).toHaveClass('gap-1')

    // The row and scroller classes are the approved fixed-height four-row window layout contract.
    expect(screen.getByRole('list')).toHaveClass('max-h-[208px]', 'overflow-y-auto')
  })

  it('uses notch and capsule expanded surfaces without recalculating window bounds', () => {
    mocks.initData = expandedSnapshot({ presentation: 'notch', notchWidth: 120 })
    const view = render(<ConversationIsland />)

    const notchSurface = screen.getByTestId('conversation-island-surface')
    const notchHeader = screen.getByTestId('notch-expanded-header')
    expect(notchSurface).toHaveClass('bg-black', 'rounded-t-none', 'rounded-b-[12px]')
    expect(notchSurface).not.toHaveClass('p-2', 'pt-[38px]', 'bg-popover')
    expect(notchHeader).toHaveClass('h-[38px]')

    mocks.initData = expandedSnapshot({ presentation: 'capsule' })
    view.rerender(<ConversationIsland />)

    const capsuleSurface = screen.getByTestId('conversation-island-surface')
    expect(capsuleSurface).toHaveClass('bg-popover', 'text-popover-foreground')
    expect(capsuleSurface).not.toHaveClass('p-2', 'pt-[38px]', 'bg-black')
    expect(screen.queryByTestId('notch-expanded-header')).toBeNull()
    expect(screen.getByTestId('capsule-expanded-header')).toHaveClass('h-[38px]')
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
