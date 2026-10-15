import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TabsContext, type TabsContextValue } from '@renderer/hooks/tab'

import { ConversationNotificationRuntime } from '../ConversationNotificationRuntime'

const mocks = vi.hoisted(() => ({
  ipcHandlers: new Map<string, (payload: any) => void>(),
  ipcRequest: vi.fn(() => Promise.resolve()),
  loggerError: vi.fn(),
  toastClose: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
  toastInfo: vi.fn(),
  toastError: vi.fn()
}))

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError }) }
}))
vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.ipcRequest },
  useIpcOn: (event: string, handler: (payload: any) => void) => mocks.ipcHandlers.set(event, handler)
}))
vi.mock('@renderer/services/toast', () => ({
  toast: {
    closeToast: mocks.toastClose,
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    info: mocks.toastInfo,
    error: mocks.toastError
  }
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
    title: 'Research notes',
    message: 'Here is the final answer.',
    conversationName: 'Research notes',
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
    vi.unstubAllGlobals()
  })

  it('continues presenting notifications when Web Audio is unavailable', () => {
    vi.stubGlobal(
      'AudioContext',
      class {
        constructor() {
          throw new Error('Audio unavailable')
        }
      }
    )
    renderRuntime(tabsContext())
    act(() => mocks.ipcHandlers.get('notification.completion_sound')?.({ id: 'record-1' }))
    act(() =>
      mocks.ipcHandlers.get('notification.present')?.({
        id: 'record-1',
        category: 'system',
        kind: 'task-completion',
        title: 'Done',
        message: 'Finished',
        target: null
      })
    )
    expect(mocks.loggerError).toHaveBeenCalledWith('Failed to create completion audio', expect.any(Error))
    expect(mocks.toastSuccess).toHaveBeenCalledWith(expect.objectContaining({ key: 'record-1' }))
  })

  it('activates persisted notifications through the main process when their toast is clicked', async () => {
    renderRuntime(tabsContext())
    act(() =>
      mocks.ipcHandlers.get('notification.present')?.({
        id: 'record-1',
        category: 'system',
        kind: 'task-completion',
        title: 'Done',
        message: 'Seven tasks finished',
        target: { kind: 'conversation', conversationType: 'agent', conversationId: 'agent-1' }
      })
    )
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'record-1', description: 'Seven tasks finished' })
    )
    await act(() => mocks.toastSuccess.mock.calls[0][0].onClick())
    expect(mocks.ipcRequest).toHaveBeenCalledWith('notification.activate', { id: 'record-1' })
  })

  it('does not show a completion toast for the conversation already being viewed', () => {
    renderRuntime(tabsContext({ id: 'active', type: 'route', url: '/app/chat?topicId=topic-2', title: 'Current' }))
    act(() =>
      mocks.ipcHandlers.get('notification.present')?.({
        id: 'record-1',
        category: 'system',
        kind: 'task-completion',
        title: 'Done',
        message: 'Finished',
        target: { kind: 'conversation', conversationType: 'assistant', conversationId: 'topic-2' }
      })
    )
    expect(mocks.toastSuccess).not.toHaveBeenCalled()
  })

  it('shows context warnings for the conversation already being viewed', () => {
    renderRuntime(tabsContext({ id: 'active', type: 'route', url: '/app/chat?topicId=topic-2', title: 'Current' }))
    act(() =>
      mocks.ipcHandlers.get('notification.present')?.({
        id: 'context-1',
        category: 'usage',
        kind: 'context-usage',
        title: 'Context nearly full',
        message: '90% used',
        target: { kind: 'conversation', conversationType: 'assistant', conversationId: 'topic-2' }
      })
    )
    expect(mocks.toastWarning).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'context-1', description: '90% used' })
    )
  })

  it('presents usage warnings without trying to open a conversation directly', async () => {
    renderRuntime(tabsContext())
    act(() =>
      mocks.ipcHandlers.get('notification.present')?.({
        id: 'budget-1',
        category: 'usage',
        kind: 'daily-budget',
        title: 'Budget',
        message: '80% used',
        target: { kind: 'settings', tab: 'usage' }
      })
    )
    expect(mocks.toastWarning).toHaveBeenCalledWith(expect.objectContaining({ description: '80% used' }))
    await act(() => mocks.toastWarning.mock.calls[0][0].onClick())
    expect(mocks.ipcRequest).toHaveBeenCalledWith('notification.activate', { id: 'budget-1' })
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
        title: 'Research notes',
        description: 'Here is the final answer.',
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

    emitNotification()

    void act(() => mocks.toastSuccess.mock.calls[0][0].onClick())
    expect(mocks.toastClose).toHaveBeenCalledWith('task-completion:turn-2')
    expect(mocks.ipcRequest).toHaveBeenCalledWith('navigation.focus_or_open_conversation', {
      target: { conversationType: 'assistant', conversationId: 'topic-2' },
      title: 'Research notes'
    })
  })
})
