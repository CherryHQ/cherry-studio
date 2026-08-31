import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ConversationNotificationRuntime } from '../ConversationNotificationRuntime'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (payload: any) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve()),
  loggerError: vi.fn(),
  toastClose: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (event: string, handler: (payload: any) => void) => mocks.ipcHandlers.set(event, handler)
}))
vi.mock('@renderer/services/toast', () => ({
  toast: { closeToast: mocks.toastClose, success: mocks.toastSuccess, warning: mocks.toastWarning }
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
  render(<ConversationNotificationRuntime />, { wrapper })
}

function conversationNotification(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-completion:turn-2',
    kind: 'task-completion',
    type: 'success',
    title: 'Assistant response complete',
    message: 'Research notes',
    timestamp: 100,
    actionKey: 'conversation.open',
    meta: { conversationType: 'assistant', conversationId: 'topic-2' },
    source: 'assistant',
    ...overrides
  }
}

function emitNotification(payload = conversationNotification()): void {
  const handler = mocks.ipcHandlers.get('notification.conversation')
  if (!handler) throw new Error('Missing conversation-notification handler')
  act(() => handler(payload))
}

describe('ConversationNotificationRuntime', () => {
  beforeEach(() => {
    mocks.ipcHandlers.clear()
    vi.clearAllMocks()
  })

  it('does not interrupt the user when the target conversation is already active', () => {
    renderRuntime(
      tabsContext({
        id: 'active',
        type: 'route',
        url: '/app/chat?topicId=topic-2',
        title: 'Research notes'
      })
    )

    emitNotification(
      conversationNotification({
        id: 'approval-request:approval-1',
        kind: 'approval-request',
        type: 'warning'
      })
    )

    expect(mocks.toastWarning).not.toHaveBeenCalled()
  })

  it('shows completion as success and approval requests as warning', () => {
    renderRuntime(
      tabsContext({ id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' })
    )

    emitNotification()
    emitNotification(
      conversationNotification({
        id: 'approval-request:approval-1',
        kind: 'approval-request',
        type: 'warning',
        title: 'Assistant needs your input'
      })
    )

    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'task-completion:turn-2',
        title: 'Assistant response complete',
        timeout: 6000
      })
    )
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'approval-request:approval-1',
        title: 'Assistant needs your input',
        timeout: 6000
      })
    )
  })

  it('opens the target conversation when the user clicks the card', () => {
    renderRuntime(
      tabsContext({ id: 'active', type: 'route', url: '/app/chat?topicId=topic-1', title: 'Current topic' })
    )

    emitNotification(
      conversationNotification({
        id: 'approval-request:approval-1',
        kind: 'approval-request',
        type: 'warning'
      })
    )

    void act(() => mocks.toastWarning.mock.calls[0][0].onClick())
    expect(mocks.toastClose).toHaveBeenCalledWith('approval-request:approval-1')
    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.focus_or_open_conversation', {
      target: { conversationType: 'assistant', conversationId: 'topic-2' },
      title: 'Research notes'
    })
  })
})
