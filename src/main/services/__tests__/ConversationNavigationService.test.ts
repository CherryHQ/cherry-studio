import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import { DataApiErrorFactory } from '@shared/data/api/errors'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  getWindow: vi.fn(),
  getWindowInfosByType: vi.fn(),
  getSession: vi.fn(),
  openRouteInMainWindow: vi.fn(),
  send: vi.fn(),
  showMainWindow: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.applicationGet } }))
vi.mock('@data/services/AgentSessionService', () => ({ agentSessionService: { getById: mocks.getSession } }))
vi.mock('../mainWindowNavigation', () => ({ openRouteInMainWindow: mocks.openRouteInMainWindow }))

const { ConversationNavigationService } = await import('../ConversationNavigationService')

const windowInfo = (id: string, type: WindowType, overrides: Partial<WindowInfo> = {}): WindowInfo => ({
  id,
  type,
  title: id,
  isVisible: true,
  isFocused: false,
  createdAt: type === WindowType.Main ? 1 : 2,
  ...overrides
})

const target = { conversationType: 'agent' as const, conversationId: 'session-1' }

function ownershipRequestId(windowId = 'main-1'): string {
  const call = mocks.send.mock.calls.findLast(
    ([id, event]) => id === windowId && event === 'navigation.conversation_ownership_requested'
  )
  if (!call) throw new Error(`Missing ownership request for ${windowId}`)
  return call[2].requestId as string
}

describe('ConversationNavigationService', () => {
  let service: InstanceType<typeof ConversationNavigationService>
  const subWindow = {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.getSession.mockReturnValue({ id: 'session-1', deletedAt: null })
    mocks.getWindow.mockReturnValue(subWindow)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'WindowManager') {
        return { getWindow: mocks.getWindow, getWindowInfosByType: mocks.getWindowInfosByType }
      }
      if (name === 'IpcApiService') return { send: mocks.send }
      if (name === 'MainWindowService') return { showMainWindow: mocks.showMainWindow }
      throw new Error(`Unexpected application.get(${name})`)
    })
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main
        ? [windowInfo('main-1', WindowType.Main)]
        : [windowInfo('sub-1', WindowType.SubWindow, { isFocused: true })]
    )
    service = new ConversationNavigationService()
  })

  it('focuses the one window that currently owns the conversation', async () => {
    const navigation = service.focusOrOpen(target, 'Refactor project', 'main-1')
    const requestId = ownershipRequestId()

    service.reportOwnership(requestId, 'main-1', false)
    service.reportOwnership(requestId, 'sub-1', true)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('sub-1', 'navigation.conversation_focus_or_open_requested', {
        requestId,
        target,
        title: 'Refactor project'
      })
    )
    service.reportOwnership(requestId, 'sub-1', true)
    await navigation

    expect(mocks.send).toHaveBeenCalledWith('sub-1', 'navigation.conversation_focus_or_open_requested', {
      requestId,
      target,
      title: 'Refactor project'
    })
    expect(subWindow.show).toHaveBeenCalledOnce()
    expect(subWindow.focus).toHaveBeenCalledOnce()
    expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()
  })

  it.each(['message-1', null])(
    'delivers the requested message location %s to the existing owner',
    async (messageId) => {
      const navigation = service.focusOrOpen(target, 'Refactor project', 'main-1', messageId)
      const requestId = ownershipRequestId()
      service.reportOwnership(requestId, 'main-1', false)
      service.reportOwnership(requestId, 'sub-1', true)
      await vi.waitFor(() =>
        expect(mocks.send).toHaveBeenCalledWith('sub-1', 'navigation.conversation_focus_or_open_requested', {
          requestId,
          target,
          title: 'Refactor project',
          messageId
        })
      )
      service.reportOwnership(requestId, 'sub-1', true)
      await navigation
      expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()
    }
  )

  it('rejects an unavailable Agent session before any window opens', async () => {
    mocks.getSession.mockImplementationOnce(() => {
      throw DataApiErrorFactory.notFound('Session', 'session-1')
    })

    await expect(service.focusOrOpen(target, 'Deleted task', null, null)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()
  })

  it('preserves A, B, A navigation order and coalesces only the current tail', async () => {
    const anchors = ['result-A', 'result-B', 'result-A']
    const navigations = anchors.map((messageId) => service.focusOrOpen(target, 'Task', 'main-1', messageId))
    expect(service.focusOrOpen(target, 'Task', 'main-1', 'result-A')).toBe(navigations[2])
    let previousRequestId: string | undefined
    for (const messageId of anchors) {
      await vi.waitFor(() => expect(ownershipRequestId()).not.toBe(previousRequestId))
      const requestId = ownershipRequestId()
      service.reportOwnership(requestId, 'main-1', false)
      service.reportOwnership(requestId, 'sub-1', true)
      await vi.waitFor(() =>
        expect(mocks.send).toHaveBeenCalledWith(
          'sub-1',
          'navigation.conversation_focus_or_open_requested',
          expect.objectContaining({ requestId, messageId })
        )
      )
      service.reportOwnership(requestId, 'sub-1', true)
      previousRequestId = requestId
    }
    await Promise.all(navigations)
    const commands = mocks.send.mock.calls.filter(
      ([, event]) => event === 'navigation.conversation_focus_or_open_requested'
    )
    expect(commands.map(([, , payload]) => payload.messageId)).toEqual(anchors)
    expect(commands.at(-1)?.[2]).toMatchObject({ target, messageId: 'result-A' })
    expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()
  })

  it('executes the queued navigation even when its previous tail fails', async () => {
    const failure = new Error('Session lookup failed')
    mocks.getSession.mockImplementationOnce(() => {
      throw failure
    })
    const failed = service.focusOrOpen(target, 'Task', 'main-1', 'failed-result')
    const failedAssertion = expect(failed).rejects.toBe(failure)
    const recovered = service.focusOrOpen(target, 'Task', 'main-1', 'recovered-result')
    await failedAssertion
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalled())
    const requestId = ownershipRequestId()
    service.reportOwnership(requestId, 'main-1', false)
    service.reportOwnership(requestId, 'sub-1', true)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith(
        'sub-1',
        'navigation.conversation_focus_or_open_requested',
        expect.objectContaining({ requestId, messageId: 'recovered-result' })
      )
    )
    service.reportOwnership(requestId, 'sub-1', true)
    await recovered
  })

  it('opens in the requesting full-chrome window when no window owns the conversation', async () => {
    const navigation = service.focusOrOpen(target, 'Refactor project', 'sub-1')
    const requestId = ownershipRequestId()

    service.reportOwnership(requestId, 'main-1', false)
    service.reportOwnership(requestId, 'sub-1', false)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('sub-1', 'navigation.conversation_focus_or_open_requested', {
        requestId,
        target,
        title: 'Refactor project'
      })
    )
    service.reportOwnership(requestId, 'sub-1', true)
    await navigation

    expect(mocks.send).toHaveBeenCalledWith('sub-1', 'navigation.conversation_focus_or_open_requested', {
      requestId,
      target,
      title: 'Refactor project'
    })
  })

  it('coalesces simultaneous focus-or-open requests for the same conversation', async () => {
    const first = service.focusOrOpen(target, 'Refactor project', 'main-1')
    const second = service.focusOrOpen(target, 'Refactor project', 'main-1')
    const requestId = ownershipRequestId()

    expect(second).toBe(first)
    expect(
      mocks.send.mock.calls.filter(([, event]) => event === 'navigation.conversation_ownership_requested')
    ).toHaveLength(2)

    service.reportOwnership(requestId, 'main-1', false)
    service.reportOwnership(requestId, 'sub-1', false)
    await vi.waitFor(() =>
      expect(
        mocks.send.mock.calls.filter(([, event]) => event === 'navigation.conversation_focus_or_open_requested')
      ).toHaveLength(1)
    )

    const afterCommand = service.focusOrOpen(target, 'Refactor project', 'main-1')
    expect(afterCommand).toBe(first)

    service.reportOwnership(requestId, 'main-1', true)
    await first

    expect(
      mocks.send.mock.calls.filter(([, event]) => event === 'navigation.conversation_focus_or_open_requested')
    ).toHaveLength(1)
  })

  it('shows the main window when a system-notification click has no existing owner', async () => {
    const navigation = service.focusOrOpen(target, 'Refactor project')
    const requestId = ownershipRequestId()

    service.reportOwnership(requestId, 'main-1', false)
    service.reportOwnership(requestId, 'sub-1', false)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('main-1', 'navigation.conversation_focus_or_open_requested', {
        requestId,
        target,
        title: 'Refactor project'
      })
    )
    service.reportOwnership(requestId, 'main-1', true)
    await navigation

    expect(mocks.send).toHaveBeenCalledWith('main-1', 'navigation.conversation_focus_or_open_requested', {
      requestId,
      target,
      title: 'Refactor project'
    })
    expect(mocks.showMainWindow).toHaveBeenCalledOnce()
  })

  it('cold-opens the main route when no full-chrome window exists', async () => {
    let mainWindowCreated = false
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      mainWindowCreated && type === WindowType.Main ? [windowInfo('main-1', WindowType.Main)] : []
    )
    mocks.openRouteInMainWindow.mockImplementation(() => {
      mainWindowCreated = true
    })

    const navigation = service.focusOrOpen(target, 'Refactor project')

    expect(mocks.openRouteInMainWindow).toHaveBeenCalledWith('/app/agents?sessionId=session-1')
    await vi.waitFor(() =>
      expect(
        mocks.send.mock.calls.filter(([, event]) => event === 'navigation.conversation_ownership_requested')
      ).not.toHaveLength(0)
    )
    const requestId = ownershipRequestId()
    service.reportOwnership(requestId, 'main-1', true)
    await navigation

    expect(
      mocks.send.mock.calls.filter(([, event]) => event === 'navigation.conversation_focus_or_open_requested')
    ).toHaveLength(0)
  })

  it('delivers the anchor after a cold-opened main tab reports ownership', async () => {
    let created = false
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      created && type === WindowType.Main ? [windowInfo('main-1', WindowType.Main)] : []
    )
    mocks.openRouteInMainWindow.mockImplementation(() => {
      created = true
    })
    const navigation = service.focusOrOpen(target, 'Task', null, 'result-message')
    await vi.waitFor(() => expect(mocks.send).toHaveBeenCalled())
    const requestId = ownershipRequestId()
    service.reportOwnership(requestId, 'main-1', true)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('main-1', 'navigation.conversation_focus_or_open_requested', {
        requestId,
        target,
        title: 'Task',
        messageId: 'result-message'
      })
    )
    service.reportOwnership(requestId, 'main-1', true)
    await navigation
    expect(mocks.openRouteInMainWindow).toHaveBeenCalledTimes(1)
  })

  it('does not query hidden pooled subwindows for tab ownership', async () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main
        ? [windowInfo('main-1', WindowType.Main)]
        : [windowInfo('sub-idle', WindowType.SubWindow, { isVisible: false })]
    )

    const navigation = service.focusOrOpen(target, 'Refactor project', 'main-1')
    const requestId = ownershipRequestId()
    service.reportOwnership(requestId, 'main-1', false)
    await vi.waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith('main-1', 'navigation.conversation_focus_or_open_requested', {
        requestId,
        target,
        title: 'Refactor project'
      })
    )
    service.reportOwnership(requestId, 'main-1', true)
    await navigation

    expect(mocks.send).not.toHaveBeenCalledWith(
      'sub-idle',
      'navigation.conversation_ownership_requested',
      expect.anything()
    )
  })

  it('retries an incomplete ownership snapshot instead of treating a late owner as absent', async () => {
    vi.useFakeTimers()
    try {
      const navigation = service.focusOrOpen(target, 'Refactor project', 'main-1')
      const firstRequestId = ownershipRequestId()
      service.reportOwnership(firstRequestId, 'main-1', false)

      await vi.advanceTimersByTimeAsync(250)

      expect(
        mocks.send.mock.calls.filter(([, event]) => event === 'navigation.conversation_focus_or_open_requested')
      ).toHaveLength(0)
      expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()

      const secondRequestId = ownershipRequestId()
      expect(secondRequestId).not.toBe(firstRequestId)
      service.reportOwnership(secondRequestId, 'main-1', false)
      service.reportOwnership(secondRequestId, 'sub-1', true)
      await vi.advanceTimersByTimeAsync(0)
      service.reportOwnership(secondRequestId, 'sub-1', true)
      await navigation

      expect(mocks.send).toHaveBeenCalledWith('sub-1', 'navigation.conversation_focus_or_open_requested', {
        requestId: secondRequestId,
        target,
        title: 'Refactor project'
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for a live Main renderer to become ready instead of sending an ephemeral cold route', async () => {
    vi.useFakeTimers()
    try {
      mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
        type === WindowType.Main ? [windowInfo('main-1', WindowType.Main)] : []
      )
      const navigation = service.focusOrOpen(target, 'Refactor project')
      const firstRequestId = ownershipRequestId()

      await vi.advanceTimersByTimeAsync(250)

      expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()
      const secondRequestId = ownershipRequestId()
      expect(secondRequestId).not.toBe(firstRequestId)

      service.reportOwnership(secondRequestId, 'main-1', false)
      await vi.advanceTimersByTimeAsync(0)
      service.reportOwnership(secondRequestId, 'main-1', true)
      await navigation

      expect(mocks.send).toHaveBeenCalledWith('main-1', 'navigation.conversation_focus_or_open_requested', {
        requestId: secondRequestId,
        target,
        title: 'Refactor project'
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
