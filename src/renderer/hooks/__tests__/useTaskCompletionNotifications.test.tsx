import { dataApiService } from '@data/DataApiService'
import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskCompletionNotifications } from '../useTaskCompletionNotifications'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (payload: any) => void>(),
  ipcRequest: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  toastClose: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      error: mocks.loggerError,
      warn: mocks.loggerWarn
    })
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (event: string, handler: (payload: any) => void) => {
    mocks.ipcHandlers.set(event, handler)
  }
}))

vi.mock('@renderer/services/toast', () => ({
  toast: {
    closeToast: mocks.toastClose,
    success: mocks.toastSuccess
  }
}))

vi.mock('react-i18next', () => {
  const translations: Record<string, string> = {
    'agent.session.new': 'New task',
    'chat.conversation.new': 'New Chat',
    'notification.completion.agent': 'Agent task complete',
    'notification.completion.assistant': 'Assistant response complete'
  }
  return {
    useTranslation: () => ({
      t: (key: string) => translations[key] ?? key
    })
  }
})

function createTabsContext(tabs: TabsContextValue['tabs'], activeTabId = tabs[0]?.id ?? ''): TabsContextValue {
  return {
    tabs,
    activeTabId,
    activeTab: tabs.find((tab) => tab.id === activeTabId),
    isLoading: false,
    addTab: vi.fn(),
    closeTab: vi.fn(),
    closeTabs: vi.fn(),
    setActiveTab: vi.fn(),
    updateTab: vi.fn(),
    openTab: vi.fn(() => 'new-tab'),
    pinTab: vi.fn(),
    unpinTab: vi.fn(),
    reorderTabs: vi.fn(),
    detachTab: vi.fn(),
    attachTab: vi.fn()
  }
}

const tabsState = { current: createTabsContext([]) }

function renderNotifications() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TabsContext value={tabsState.current}>{children}</TabsContext>
  )
  return renderHook(() => useTaskCompletionNotifications(), { wrapper })
}

function emit(event: string, payload: unknown): void {
  const handler = mocks.ipcHandlers.get(event)
  if (!handler) throw new Error(`No IPC handler registered for ${event}`)
  act(() => handler(payload))
}

function completion(overrides: Record<string, unknown> = {}) {
  return {
    topicId: 'topic-2',
    turnId: 'turn-2',
    completedAt: 200,
    delivery: 'in-app',
    ...overrides
  }
}

describe('useTaskCompletionNotifications', () => {
  beforeEach(() => {
    tabsState.current = createTabsContext([])
    mocks.ipcHandlers.clear()
    vi.clearAllMocks()
    mocks.ipcRequest.mockImplementation((event: string) =>
      Promise.resolve(event === 'notification.focus_task_target' ? false : undefined)
    )
    vi.mocked(dataApiService.get).mockReset()
  })

  it('suppresses an in-app card when the completed assistant topic is already active', () => {
    tabsState.current = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      }
    ])
    renderNotifications()

    emit('notification.task_completed', completion({ topicId: 'topic-1' }))

    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows a six-second assistant card and focuses an existing target tab on click', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Research notes' } as never)
    tabsState.current = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      },
      {
        id: 'target',
        type: 'route',
        url: '/app/chat',
        title: 'Research notes',
        metadata: { instanceAppId: 'assistants', instanceKey: 'topic-2' }
      }
    ])
    renderNotifications()

    emit('notification.task_completed', completion())

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          key: 'task-completion:turn-2',
          title: 'Assistant response complete',
          description: 'Research notes',
          timeout: 6000
        })
      )
    })

    const card = mocks.toastSuccess.mock.calls[0][0]
    void act(() => card.onClick())

    expect(mocks.toastClose).toHaveBeenCalledWith('task-completion:turn-2')
    expect(tabsState.current.setActiveTab).toHaveBeenCalledWith('target')
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('notification.focus_task_target', expect.anything())
    expect(tabsState.current.openTab).not.toHaveBeenCalled()
  })

  it('opens a missing Agent session with instance metadata when no other window owns it', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Refactor project' } as never)
    tabsState.current = createTabsContext([
      { id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' }
    ])
    renderNotifications()

    emit('notification.task_completed', completion({ topicId: 'agent-session:session-2', turnId: 'turn-agent' }))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())

    void act(() => mocks.toastSuccess.mock.calls[0][0].onClick())

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('notification.focus_task_target', {
        conversationType: 'agent',
        conversationId: 'session-2'
      })
      expect(tabsState.current.openTab).toHaveBeenCalledWith('/app/agents', {
        forceNew: true,
        title: 'Refactor project',
        metadata: { instanceAppId: 'agents', instanceKey: 'session-2' }
      })
    })
  })

  it('focuses a target owned by another window instead of opening a duplicate tab', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Detached task' } as never)
    mocks.ipcRequest.mockImplementation((event: string) =>
      Promise.resolve(event === 'notification.focus_task_target' ? true : undefined)
    )
    tabsState.current = createTabsContext([
      { id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' }
    ])
    renderNotifications()

    emit(
      'notification.task_completed',
      completion({ topicId: 'agent-session:session-detached', turnId: 'turn-detached' })
    )
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())
    void act(() => mocks.toastSuccess.mock.calls[0][0].onClick())

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('notification.focus_task_target', {
        conversationType: 'agent',
        conversationId: 'session-detached'
      })
    })
    expect(tabsState.current.openTab).not.toHaveBeenCalled()
  })

  it('reads the latest tab state when a card is clicked after a rerender', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Arrived later' } as never)
    const initial = createTabsContext([
      { id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' }
    ])
    tabsState.current = initial
    const rendered = renderNotifications()

    emit('notification.task_completed', completion())
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalled())

    const latest = createTabsContext([
      ...initial.tabs,
      {
        id: 'late-target',
        type: 'route',
        url: '/app/chat',
        title: 'Arrived later',
        metadata: { instanceAppId: 'assistants', instanceKey: 'topic-2' }
      }
    ])
    tabsState.current = latest
    rendered.rerender()

    void act(() => mocks.toastSuccess.mock.calls[0][0].onClick())

    expect(latest.setActiveTab).toHaveBeenCalledWith('late-target')
    expect(initial.setActiveTab).not.toHaveBeenCalled()
    expect(mocks.ipcRequest).not.toHaveBeenCalledWith('notification.focus_task_target', expect.anything())
    expect(latest.openTab).not.toHaveBeenCalled()
  })

  it('logs name lookup failures and continues with a localized generic name', async () => {
    vi.mocked(dataApiService.get).mockRejectedValue(new Error('missing'))
    tabsState.current = createTabsContext([
      { id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' }
    ])
    renderNotifications()

    emit('notification.task_completed', completion())

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Assistant response complete', description: 'New Chat' })
      )
    })
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to resolve completed conversation name',
      expect.objectContaining({ topicId: 'topic-2' })
    )
  })

  it('syncs conversation targets with main and handles a main-owned focus request locally', async () => {
    tabsState.current = createTabsContext([
      {
        id: 'assistant-target',
        type: 'route',
        url: '/app/chat',
        title: 'Topic',
        metadata: { instanceAppId: 'assistants', instanceKey: 'topic-2' }
      },
      {
        id: 'agent-target',
        type: 'route',
        url: '/app/agents?sessionId=session-2',
        title: 'Agent task'
      }
    ])
    renderNotifications()

    await waitFor(() => {
      expect(mocks.ipcRequest).toHaveBeenCalledWith('notification.sync_task_targets', {
        targets: [
          { conversationType: 'assistant', conversationId: 'topic-2' },
          { conversationType: 'agent', conversationId: 'session-2' }
        ]
      })
    })

    emit('notification.open_task_target_requested', {
      target: { conversationType: 'agent', conversationId: 'session-2' }
    })
    expect(tabsState.current.setActiveTab).toHaveBeenCalledWith('agent-target')
    expect(tabsState.current.openTab).not.toHaveBeenCalled()
  })

  it('ignores system delivery because background notifications are main-owned', () => {
    tabsState.current = createTabsContext([
      { id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' }
    ])
    renderNotifications()

    emit('notification.task_completed', completion({ delivery: 'system' }))

    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })
})
