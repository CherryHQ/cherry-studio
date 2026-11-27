import { MockCacheUtils } from '@test-mocks/renderer/CacheService'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TooltipProvider } from '@cherrystudio/ui'
import { cacheService } from '@renderer/data/CacheService'

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
  it('waits 800ms before showing the details tooltip below the toolbar button', async () => {
    const measure = (element: Element) => {
      if (element === document.documentElement || element === document.body) return new DOMRect(0, 0, 1280, 800)
      if (element.matches('button')) return new DOMRect(1100, 60, 28, 28)
      if (element.matches('[data-radix-popper-content-wrapper], [data-slot="tooltip-content"]'))
        return new DOMRect(0, 0, 160, 32)
      return new DOMRect(0, 0, 0, 0)
    }
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return measure(this)
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return measure(this).width
    })
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return measure(this).height
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) {
      return measure(this).width
    })
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return measure(this).height
    })

    try {
      render(<Fixture />)
      fireEvent.pointerMove(toggle(), { pointerType: 'mouse' })
      await act(() => vi.advanceTimersByTimeAsync(799))
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

      await act(() => vi.advanceTimersByTimeAsync(1))
      const tooltip = screen.getByRole('tooltip', { name: 'agent.right_pane.tabs.details' })
      expect(tooltip.closest('[data-slot="tooltip-content"]')).toHaveAttribute('data-side', 'bottom')
    } finally {
      vi.useRealTimers()
      vi.restoreAllMocks()
    }
  })

  // Catches breakpoint flapping and an inline card taking space from an undersized conversation.
  it('keeps a four-pixel restore band and requires enough vertical space', () => {
    expect(resolveAgentDetailsMode(975, 800, 'inline')).toBe('popover')
    expect(resolveAgentDetailsMode(976, 800, 'inline')).toBe('inline')
    expect(resolveAgentDetailsMode(979, 800, 'popover')).toBe('popover')
    expect(resolveAgentDetailsMode(980, 800, 'popover')).toBe('inline')
    expect(resolveAgentDetailsMode(1200, 159, 'inline')).toBe('popover')
  })

  // Catches losing the shared inline choice on resize or session navigation.
  it('shares inline visibility across sessions independently of the transient popup', () => {
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
    expect(screen.queryByRole('complementary')).toBeNull()
    fireEvent.click(screen.getByText('Back to details'))
    expect(screen.getByRole('complementary')).toHaveTextContent('Content b')
    view.rerender(<Fixture />)
    expect(screen.getByRole('complementary')).toHaveTextContent('Content a')
  })

  // Catches reading or writing only memory, which loses the last choice after a restart.
  it.each([true, false])('restores the persisted inline choice %s and saves its next value', (open) => {
    MockCacheUtils.setInitialState({ persist: [['ui.agent.details.open', open]] })
    const view = render(<Fixture />)
    fireEvent.click(screen.getByText('Wide'))
    expect(toggle()).toHaveAttribute('aria-expanded', String(open))
    expect(screen.queryByRole('complementary') !== null).toBe(open)

    fireEvent.click(toggle())
    const saved = cacheService.getPersist('ui.agent.details.open')
    expect(saved).toBe(!open)
    view.unmount()

    MockCacheUtils.setInitialState({ persist: [['ui.agent.details.open', saved]] })
    render(<Fixture session="b" />)
    fireEvent.click(screen.getByText('Wide'))
    expect(toggle()).toHaveAttribute('aria-expanded', String(!open))
    expect(screen.queryByRole('complementary') !== null).toBe(!open)
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
