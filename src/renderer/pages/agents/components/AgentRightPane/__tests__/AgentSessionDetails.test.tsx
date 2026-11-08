import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@cherrystudio/ui'

import {
  AgentSessionDetailsLayout,
  AgentSessionDetailsProvider,
  AgentSessionDetailsToggle
} from '../AgentSessionDetails'
import { resolveAgentDetailsMode } from '../agentSessionDetailsLayout'
import { useAgentSessionDetails } from '../useAgentSessionDetails'

vi.mock('@cherrystudio/ui', async (original) => original())
vi.mock('@renderer/data/hooks/useCache', async (original) => original())
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function SizeControls() {
  const { measure, openDetails } = useAgentSessionDetails()
  return (
    <>
      <button type="button" onClick={() => measure(1200, 800)}>
        Wide
      </button>
      <button type="button" onClick={() => measure(800, 800)}>
        Narrow
      </button>
      <button type="button" onClick={openDetails}>
        Back to details
      </button>
    </>
  )
}

function Fixture({ session = 'a', available = true }: { session?: string; available?: boolean }) {
  const details = <button type="button">Content {session}</button>
  return (
    <TooltipProvider>
      <AgentSessionDetailsProvider sessionId={session} available={available}>
        <SizeControls />
        <AgentSessionDetailsToggle>{details}</AgentSessionDetailsToggle>
        <AgentSessionDetailsLayout details={details}>
          <input aria-label="Composer" />
        </AgentSessionDetailsLayout>
      </AgentSessionDetailsProvider>
    </TooltipProvider>
  )
}

const toggle = () => screen.getByRole('button', { name: 'agent.right_pane.tabs.details' })

beforeEach(() => MockCacheUtils.resetMocks())

describe('session details presentation', () => {
  // Catches breakpoint flapping and an inline card taking space from an undersized conversation.
  it('keeps a four-pixel restore band and requires enough vertical space', () => {
    expect(resolveAgentDetailsMode(975, 800, 'inline')).toBe('popover')
    expect(resolveAgentDetailsMode(976, 800, 'inline')).toBe('inline')
    expect(resolveAgentDetailsMode(979, 800, 'popover')).toBe('popover')
    expect(resolveAgentDetailsMode(980, 800, 'popover')).toBe('inline')
    expect(resolveAgentDetailsMode(1200, 159, 'inline')).toBe('popover')
  })

  // Catches losing an explicit hide choice on resize, or leaking that choice into another session.
  it('remembers inline visibility per session independently of the transient popup', () => {
    const view = render(<Fixture />)
    fireEvent.click(screen.getByText('Wide'))
    expect(screen.getByRole('complementary')).toBeInTheDocument()
    fireEvent.click(toggle())
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByText('Narrow'))
    fireEvent.click(toggle())
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Wide'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
    view.rerender(<Fixture session="b" />)
    expect(screen.getByRole('complementary')).toHaveTextContent('Content b')
    view.rerender(<Fixture />)
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByText('Back to details'))
    expect(screen.getByRole('complementary')).toHaveTextContent('Content a')
  })

  // Catches remounting the composer during layout changes and stale session popup content.
  it('keeps composer state while resizing and clears the popup on session or availability changes', () => {
    const view = render(<Fixture />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Unsent message' } })
    fireEvent.click(screen.getByText('Wide'))
    fireEvent.click(screen.getByText('Narrow'))
    expect(screen.getByRole('textbox')).toBe(input)
    expect(input).toHaveValue('Unsent message')
    fireEvent.click(toggle())
    view.rerender(<Fixture session="b" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(toggle())
    expect(screen.getByRole('dialog')).toHaveTextContent('Content b')
    view.rerender(<Fixture session="b" available={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // Real Radix verifies Escape and focus restoration, which the global UI stand-in cannot prove.
  it('opens by keyboard and returns focus on Escape', async () => {
    const user = userEvent.setup()
    render(<Fixture />)
    act(() => toggle().focus())
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(toggle()).toHaveFocus()
  })
})

// Catches mode changes replacing the focused toggle or stranding popup focus on document.body.
it('preserves toggle focus through both mode changes and returns popup focus when widening', async () => {
  render(<Fixture />)
  fireEvent.click(screen.getByText('Wide'))
  const trigger = toggle()
  act(() => trigger.focus())
  fireEvent.click(screen.getByText('Narrow'))
  expect(toggle()).toBe(trigger)
  expect(trigger).toHaveFocus()
  fireEvent.click(screen.getByText('Wide'))
  expect(trigger).toHaveFocus()
  fireEvent.click(screen.getByText('Narrow'))
  fireEvent.click(trigger)
  act(() => screen.getByRole('button', { name: 'Content a' }).focus())
  fireEvent.click(screen.getByText('Wide'))
  await vi.waitFor(() => expect(trigger).toHaveFocus())
  expect(screen.queryByRole('dialog')).toBeNull()
})
