import type { ConversationIslandSnapshot } from '@shared/types/conversationIsland'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const snapshot = (overrides: Partial<ConversationIslandSnapshot> = {}): ConversationIslandSnapshot => ({
  activityId: 'topic-1',
  target: { conversationType: 'assistant', conversationId: 'topic-1' },
  state: 'streaming',
  statusText: 'Responding',
  navigationTitle: 'New Chat',
  secondaryCount: 0,
  presentation: 'capsule',
  ...overrides
})

describe('ConversationIsland', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.initData = null
    mocks.ipcRequest.mockResolvedValue(undefined)
  })

  it('renders nothing until WindowManager init data arrives', () => {
    const { container } = render(<ConversationIsland />)

    expect(container).toBeEmptyDOMElement()
  })

  it('renders status text and gates the title and secondary count from the snapshot', () => {
    mocks.initData = snapshot()
    const view = render(<ConversationIsland />)

    expect(screen.getByText('Responding')).toBeVisible()
    expect(screen.queryByText('Research notes')).toBeNull()
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
    expect(button).toHaveClass('bg-black', 'border-transparent')
    expect(button).not.toHaveClass('backdrop-blur-xs')
    expect(occlusion).toHaveStyle({ width: '120px' })
    expect(within(leading).getByText('Responding')).toBeVisible()
    expect(within(trailing).getByText('Research notes')).toBeVisible()
    expect(within(trailing).getByText('+2')).toBeVisible()

    mocks.initData = snapshot({ presentation: 'notch', notchWidth: 120, secondaryCount: 2 })
    view.rerender(<ConversationIsland />)

    expect(screen.queryByText('Research notes')).toBeNull()
    expect(within(screen.getByTestId('notch-trailing')).getByText('+2')).toBeVisible()
  })

  it('keeps capsule styling for capsule snapshots and invalid notch widths', () => {
    mocks.initData = snapshot()
    const view = render(<ConversationIsland />)

    expect(screen.queryByTestId('notch-occlusion')).toBeNull()
    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')

    mocks.initData = snapshot({ presentation: 'notch', notchWidth: undefined })
    view.rerender(<ConversationIsland />)

    expect(screen.queryByTestId('notch-occlusion')).toBeNull()
    expect(screen.getByRole('button')).toHaveClass('rounded-full', 'bg-popover/95')
  })

  it('opens the primary conversation when the pill is clicked', async () => {
    const user = userEvent.setup()
    mocks.initData = snapshot({ navigationTitle: 'Research notes' })
    render(<ConversationIsland />)

    await user.click(screen.getByRole('button'))

    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.focus_or_open_conversation', {
      target: mocks.initData.target,
      title: 'Research notes'
    })
  })

  it('logs navigation failures without replacing the activity surface', async () => {
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
})
