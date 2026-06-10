import { cacheService } from '@data/CacheService'
import { cleanup, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression guard for the "助手 page renders blank" bug: when the user has no
 * persisted topics, the home page must lease a fresh temporary topic to show —
 * not only on the first mount, but whenever the topic list is empty (e.g. after
 * navigating away from the one-shot first-mount temp and back). Otherwise
 * `useActiveTopic` has nothing to auto-pick and the page stays blank.
 *
 * The test asserts the gate that drives this: the `enabled` flag HomePage hands
 * to `useTemporaryTopic`.
 */

const mockUseTemporaryTopic = vi.fn()
const mockUseActiveTopic = vi.fn()
const mockUseAllTopics = vi.fn()

vi.mock('@renderer/hooks/useTemporaryTopic', () => ({
  useTemporaryTopic: (opts: unknown) => mockUseTemporaryTopic(opts)
}))

vi.mock('@renderer/hooks/useTopic', () => ({
  useActiveTopic: (...args: unknown[]) => mockUseActiveTopic(...args),
  useAllTopics: (...args: unknown[]) => mockUseAllTopics(...args),
  useTopicMutations: () => ({ refreshTopics: vi.fn() })
}))

vi.mock('@renderer/hooks/useNavbar', () => ({
  useNavbarPosition: () => ({ isLeftNavbar: true })
}))

vi.mock('@renderer/features/command', () => ({
  useCommandHandler: vi.fn()
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ state: undefined }),
  useNavigate: () => vi.fn()
}))

vi.mock('@renderer/services/NavigationService', () => ({
  default: { setNavigate: vi.fn() }
}))

// With no active topic, HomePage renders an empty container and never mounts
// these children — stub them so importing HomePage doesn't drag in their
// (heavy) dependency trees.
vi.mock('../Chat', () => ({ default: () => null }))
vi.mock('../Navbar', () => ({ default: () => null }))
vi.mock('../Tabs', () => ({ default: () => null }))

// The adoption tests render with a truthy activeTopic, reaching the full tree —
// stub the wrappers so they don't pull in the UI kit / animation runtime.
vi.mock('@renderer/components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children?: ReactNode }) => <>{children}</>
}))
vi.mock('motion/react', () => ({
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  motion: { div: ({ children }: { children?: ReactNode }) => <>{children}</> }
}))

import HomePage from '../HomePage'

/** The `enabled` flag from the most recent useTemporaryTopic call. */
function leasedEnabled(): boolean | undefined {
  const lastCall = mockUseTemporaryTopic.mock.calls.at(-1)?.[0] as { enabled?: boolean } | undefined
  return lastCall?.enabled
}

describe('HomePage temporary-topic gating', () => {
  beforeEach(() => {
    mockUseTemporaryTopic.mockReturnValue({ topicId: null, ready: false, reset: vi.fn(), persist: vi.fn() })
    mockUseActiveTopic.mockReturnValue({ activeTopic: undefined, setActiveTopic: vi.fn(), isLoading: false })
    mockUseAllTopics.mockReturnValue({ topics: [], isLoading: false })
    // window.api.window isn't part of the global test stub; HomePage's
    // set/reset-minimum-size effect needs it.
    ;(window.api as unknown as Record<string, unknown>).window = {
      setMinimumSize: vi.fn().mockResolvedValue(undefined),
      resetMinimumSize: vi.fn().mockResolvedValue(undefined)
    }
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('leases a temporary topic when the topic list is empty on a later mount', () => {
    cacheService.set('topic.home.first_launch_temp_used', true) // not the first mount
    mockUseAllTopics.mockReturnValue({ topics: [], isLoading: false })

    render(<HomePage />)

    expect(leasedEnabled()).toBe(true)
  })

  it('does not lease a temporary topic when persisted topics exist', () => {
    cacheService.set('topic.home.first_launch_temp_used', true) // not the first mount
    mockUseAllTopics.mockReturnValue({ topics: [{ id: 't1' }], isLoading: false })

    render(<HomePage />)

    expect(leasedEnabled()).toBe(false)
  })

  it('leases a temporary topic on the first mount even when topics exist', () => {
    cacheService.set('topic.home.first_launch_temp_used', false) // first mount of the session
    mockUseAllTopics.mockReturnValue({ topics: [{ id: 't1' }], isLoading: false })

    render(<HomePage />)

    expect(leasedEnabled()).toBe(true)
  })

  it('waits for the list to finish loading before leasing on a later mount', () => {
    cacheService.set('topic.home.first_launch_temp_used', true) // not the first mount
    mockUseAllTopics.mockReturnValue({ topics: [], isLoading: true })

    render(<HomePage />)

    expect(leasedEnabled()).toBe(false)
  })

  it('adopts the leased temp topic when the list empties mid-session', () => {
    cacheService.set('topic.home.first_launch_temp_used', true) // not the first mount
    mockUseAllTopics.mockReturnValue({ topics: [], isLoading: false })
    mockUseTemporaryTopic.mockReturnValue({ topicId: 'temp-1', ready: true, reset: vi.fn(), persist: vi.fn() })
    // The previously-active topic was just deleted — useActiveTopic resolves
    // nothing (its initial-topic effect only fills a *missing* id).
    const setActiveTopic = vi.fn()
    mockUseActiveTopic.mockReturnValue({ activeTopic: undefined, setActiveTopic, isLoading: false })

    render(<HomePage />)

    expect(setActiveTopic).toHaveBeenCalledWith(expect.objectContaining({ id: 'temp-1' }))
  })

  it('does not re-adopt when the temp topic is already active', () => {
    cacheService.set('topic.home.first_launch_temp_used', true) // not the first mount
    mockUseAllTopics.mockReturnValue({ topics: [], isLoading: false })
    mockUseTemporaryTopic.mockReturnValue({ topicId: 'temp-1', ready: true, reset: vi.fn(), persist: vi.fn() })
    const setActiveTopic = vi.fn()
    mockUseActiveTopic.mockReturnValue({ activeTopic: { id: 'temp-1' }, setActiveTopic, isLoading: false })

    render(<HomePage />)

    expect(setActiveTopic).not.toHaveBeenCalled()
  })

  it('does not steer the active topic while persisted topics exist', () => {
    cacheService.set('topic.home.first_launch_temp_used', false) // first mount, temp leased
    mockUseAllTopics.mockReturnValue({ topics: [{ id: 't1' }], isLoading: false })
    mockUseTemporaryTopic.mockReturnValue({ topicId: 'temp-1', ready: true, reset: vi.fn(), persist: vi.fn() })
    const setActiveTopic = vi.fn()
    mockUseActiveTopic.mockReturnValue({ activeTopic: { id: 't1' }, setActiveTopic, isLoading: false })

    render(<HomePage />)

    expect(setActiveTopic).not.toHaveBeenCalled()
  })
})
