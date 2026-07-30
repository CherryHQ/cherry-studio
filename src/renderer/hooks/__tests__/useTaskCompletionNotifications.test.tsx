import { dataApiService } from '@data/DataApiService'
import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab'
import { TASK_COMPLETION_NOTIFICATION_ACTION_KEY } from '@shared/types/notification'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useTaskCompletionNotifications } from '../useTaskCompletionNotifications'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (payload: any) => void>(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  notificationSend: vi.fn(),
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
  useIpcOn: (event: string, handler: (payload: any) => void) => {
    mocks.ipcHandlers.set(event, handler)
  }
}))

vi.mock('@renderer/services/notification', () => ({
  notificationService: {
    send: mocks.notificationSend
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

function renderNotifications(tabs: TabsContextValue) {
  const wrapper = ({ children }: { children: ReactNode }) => <TabsContext value={tabs}>{children}</TabsContext>
  return renderHook(() => useTaskCompletionNotifications(), { wrapper })
}

function emit(event: string, payload: unknown): void {
  const handler = mocks.ipcHandlers.get(event)
  if (!handler) throw new Error(`No IPC handler registered for ${event}`)
  act(() => handler(payload))
}

describe('useTaskCompletionNotifications', () => {
  beforeEach(() => {
    mocks.ipcHandlers.clear()
    vi.clearAllMocks()
    vi.mocked(dataApiService.get).mockReset()
  })

  it('suppresses an in-app card when the completed assistant topic is already active', () => {
    const tabs = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      }
    ])
    renderNotifications(tabs)

    emit('notification.task_completed', {
      topicId: 'topic-1',
      turnId: 'turn-1',
      completedAt: 100,
      delivery: 'in-app'
    })

    expect(dataApiService.get).not.toHaveBeenCalled()
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
    expect(mocks.notificationSend).not.toHaveBeenCalled()
  })

  it('shows a six-second assistant card and focuses an existing target tab on click', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Research notes' } as never)
    const tabs = createTabsContext([
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
    renderNotifications(tabs)

    emit('notification.task_completed', {
      topicId: 'topic-2',
      turnId: 'turn-2',
      completedAt: 200,
      delivery: 'in-app'
    })

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
    act(() => {
      void card.onClick()
    })

    expect(mocks.toastClose).toHaveBeenCalledWith('task-completion:turn-2')
    expect(tabs.setActiveTab).toHaveBeenCalledWith('target')
    expect(tabs.openTab).not.toHaveBeenCalled()
  })

  it('opens a missing Agent session with instance metadata when its card is clicked', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Refactor project' } as never)
    const tabs = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      }
    ])
    renderNotifications(tabs)

    emit('notification.task_completed', {
      topicId: 'agent-session:session-2',
      turnId: 'turn-3',
      completedAt: 300,
      delivery: 'in-app'
    })

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Agent task complete',
          description: 'Refactor project'
        })
      )
    })

    const card = mocks.toastSuccess.mock.calls[0][0]
    act(() => {
      void card.onClick()
    })

    expect(tabs.openTab).toHaveBeenCalledWith('/app/agents', {
      forceNew: true,
      title: 'Refactor project',
      metadata: {
        instanceAppId: 'agents',
        instanceKey: 'session-2'
      }
    })
  })

  it('delegates a background completion to the preference-gated system notification service', async () => {
    vi.mocked(dataApiService.get).mockResolvedValue({ name: 'Background topic' } as never)
    const tabs = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      }
    ])
    renderNotifications(tabs)

    emit('notification.task_completed', {
      topicId: 'topic-1',
      turnId: 'turn-4',
      completedAt: 400,
      delivery: 'system'
    })

    await waitFor(() => {
      expect(mocks.notificationSend).toHaveBeenCalledWith({
        id: 'task-completion:turn-4',
        type: 'success',
        title: 'Assistant response complete',
        message: 'Background topic',
        timestamp: 400,
        actionKey: TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
        meta: {
          conversationType: 'assistant',
          conversationId: 'topic-1'
        },
        source: 'assistant'
      })
    })
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('focuses the target conversation when its system notification is clicked', () => {
    const tabs = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      },
      {
        id: 'agent-target',
        type: 'route',
        url: '/app/agents',
        title: 'Agent task',
        metadata: { instanceAppId: 'agents', instanceKey: 'session-2' }
      }
    ])
    renderNotifications(tabs)

    emit('notification.clicked', {
      id: 'task-completion:turn-5',
      type: 'success',
      title: 'Agent task complete',
      message: 'Agent task',
      timestamp: 500,
      actionKey: TASK_COMPLETION_NOTIFICATION_ACTION_KEY,
      meta: {
        conversationType: 'agent',
        conversationId: 'session-2'
      },
      source: 'assistant'
    })

    expect(tabs.setActiveTab).toHaveBeenCalledWith('agent-target')
    expect(tabs.openTab).not.toHaveBeenCalled()
  })

  it('uses a localized fallback name when completion metadata cannot be loaded', async () => {
    vi.mocked(dataApiService.get).mockRejectedValue(new Error('missing'))
    const tabs = createTabsContext([
      {
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-1',
        title: 'Current topic'
      }
    ])
    renderNotifications(tabs)

    emit('notification.task_completed', {
      topicId: 'agent-session:missing-session',
      turnId: 'turn-6',
      completedAt: 600,
      delivery: 'in-app'
    })

    await waitFor(() => {
      expect(mocks.toastSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Agent task complete',
          description: 'New task'
        })
      )
    })
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to resolve completed conversation name',
      expect.objectContaining({ topicId: 'agent-session:missing-session' })
    )
  })
})
