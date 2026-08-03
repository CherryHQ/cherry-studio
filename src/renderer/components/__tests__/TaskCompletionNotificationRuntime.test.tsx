import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TaskCompletionNotificationRuntime } from '../TaskCompletionNotificationRuntime'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (payload: any) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve()),
  loggerError: vi.fn(),
  toastClose: vi.fn(),
  toastSuccess: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (event: string, handler: (payload: any) => void) => mocks.ipcHandlers.set(event, handler)
}))
vi.mock('@renderer/services/toast', () => ({
  toast: { closeToast: mocks.toastClose, success: mocks.toastSuccess }
}))

function tabsContext(activeTab?: TabsContextValue['activeTab']): TabsContextValue {
  return {
    tabs: activeTab ? [activeTab] : [],
    activeTabId: activeTab?.id ?? '',
    activeTab,
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

function renderRuntime(context: TabsContextValue): void {
  const wrapper = ({ children }: { children: ReactNode }) => <TabsContext value={context}>{children}</TabsContext>
  render(<TaskCompletionNotificationRuntime />, { wrapper })
}

function completion(overrides: Record<string, unknown> = {}) {
  return {
    turnId: 'turn-2',
    target: { conversationType: 'assistant', conversationId: 'topic-2' },
    title: 'Assistant response complete',
    message: 'Research notes',
    ...overrides
  }
}

function emitCompletion(payload = completion()): void {
  const handler = mocks.ipcHandlers.get('notification.task_completed')
  if (!handler) throw new Error('Missing task-completion handler')
  act(() => handler(payload))
}

describe('TaskCompletionNotificationRuntime', () => {
  beforeEach(() => {
    mocks.ipcHandlers.clear()
    vi.clearAllMocks()
  })

  it('suppresses the card when the completed conversation is already active', () => {
    renderRuntime(
      tabsContext({
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-2',
        title: 'Research notes'
      })
    )

    emitCompletion()

    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows the main-prepared six-second card and delegates its click to navigation', () => {
    renderRuntime(
      tabsContext({ id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' })
    )

    emitCompletion()

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'task-completion:turn-2',
        title: 'Assistant response complete',
        description: 'Research notes',
        timeout: 6000
      })
    )

    void act(() => mocks.toastSuccess.mock.calls[0][0].onClick())
    expect(mocks.toastClose).toHaveBeenCalledWith('task-completion:turn-2')
    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.focus_or_open_conversation', {
      target: { conversationType: 'assistant', conversationId: 'topic-2' },
      title: 'Research notes'
    })
  })
})
