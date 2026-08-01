import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ConversationCompletedEvent } from '@main/ai/streamManager'
import type { ApprovalRequestedEvent } from '@main/ai/types'
import { BaseService } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'

const mocks = vi.hoisted(() => ({
  agentSessionGetById: vi.fn(),
  agentApprovalListener: undefined as ((event: ApprovalRequestedEvent) => void) | undefined,
  applicationGet: vi.fn(),
  broadcastToType: vi.fn(),
  completionListener: undefined as ((event: ConversationCompletedEvent) => void) | undefined,
  electronNotifications: [] as Array<{
    options: { title: string; body: string }
    click?: () => void
    show: ReturnType<typeof vi.fn<() => void>>
  }>,
  focusOrOpen: vi.fn(() => Promise.resolve()),
  getWindowInfosByType: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
  preferenceGet: vi.fn(),
  send: vi.fn(),
  showMainWindow: vi.fn(),
  streamApprovalListener: undefined as ((event: ApprovalRequestedEvent) => void) | undefined,
  topicGetById: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.applicationGet } }))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.agentSessionGetById }
}))
vi.mock('@data/services/TopicService', () => ({ topicService: { getById: mocks.topicGetById } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn }) }
}))
vi.mock('@main/i18n', () => ({
  t: (key: string) =>
    ({
      'agent.session.new': 'New task',
      'chat.conversation.new': 'New Chat',
      'notification.action_required.agent': 'Agent needs your input',
      'notification.action_required.assistant': 'Assistant needs your input',
      'notification.completion.agent': 'Agent task complete',
      'notification.completion.assistant': 'Assistant response complete'
    })[key] ?? key
}))
vi.mock('electron', () => ({
  Notification: class {
    private readonly state: (typeof mocks.electronNotifications)[number]

    constructor(options: { title: string; body: string }) {
      this.state = { options, show: vi.fn() }
      mocks.electronNotifications.push(this.state)
    }

    on(event: string, listener: () => void) {
      if (event === 'click') this.state.click = listener
      return this
    }

    show() {
      this.state.show()
    }
  }
}))

const { NotificationService } = await import('../NotificationService')

const mainWindowInfo = (overrides: Partial<WindowInfo> = {}): WindowInfo => ({
  id: 'main-1',
  type: WindowType.Main,
  title: 'Cherry Studio',
  isVisible: false,
  isFocused: false,
  createdAt: 1,
  ...overrides
})

function emitCompletion(overrides: Partial<ConversationCompletedEvent> = {}): void {
  mocks.completionListener?.({
    topicId: 'topic-1',
    turnId: 'turn-1',
    completedAt: 100,
    ...overrides
  })
}

function emitApproval(overrides: Partial<ApprovalRequestedEvent> = {}, source: 'stream' | 'agent' = 'stream'): void {
  const listener = source === 'stream' ? mocks.streamApprovalListener : mocks.agentApprovalListener
  listener?.({
    topicId: 'topic-1',
    approvalId: 'approval-1',
    requestedAt: 200,
    ...overrides
  })
}

describe('NotificationService', () => {
  let service: InstanceType<typeof NotificationService>

  beforeEach(async () => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.electronNotifications.length = 0
    mocks.agentApprovalListener = undefined
    mocks.completionListener = undefined
    mocks.streamApprovalListener = undefined
    mocks.getWindowInfosByType.mockReturnValue([])
    mocks.preferenceGet.mockReturnValue(true)
    mocks.topicGetById.mockReturnValue({ name: 'Research notes' })
    mocks.agentSessionGetById.mockReturnValue({ name: 'Refactor project' })
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'AiStreamManager') {
        return {
          onApprovalRequested: (listener: (event: ApprovalRequestedEvent) => void) => {
            mocks.streamApprovalListener = listener
            return { dispose: vi.fn() }
          },
          onConversationCompleted: (listener: (event: ConversationCompletedEvent) => void) => {
            mocks.completionListener = listener
            return { dispose: vi.fn() }
          }
        }
      }
      if (name === 'AgentSessionRuntimeService') {
        return {
          onApprovalRequested: (listener: (event: ApprovalRequestedEvent) => void) => {
            mocks.agentApprovalListener = listener
            return { dispose: vi.fn() }
          }
        }
      }
      if (name === 'ConversationNavigationService') return { focusOrOpen: mocks.focusOrOpen }
      if (name === 'WindowManager') return { getWindowInfosByType: mocks.getWindowInfosByType }
      if (name === 'IpcApiService') return { send: mocks.send, broadcastToType: mocks.broadcastToType }
      if (name === 'MainWindowService') return { showMainWindow: mocks.showMainWindow }
      if (name === 'PreferenceService') return { get: mocks.preferenceGet }
      throw new Error(`Unexpected application.get(${name})`)
    })

    service = new NotificationService()
    await service._doInit()
  })

  it('sends one presentation-ready event to the focused full-chrome window', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main
        ? [mainWindowInfo()]
        : [
            mainWindowInfo({
              id: 'sub-1',
              type: WindowType.SubWindow,
              title: 'Detached chat',
              isVisible: true,
              isFocused: true
            })
          ]
    )

    emitCompletion()

    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith('sub-1', 'notification.conversation', {
      id: 'task-completion:turn-1',
      kind: 'task-completion',
      type: 'success',
      title: 'Assistant response complete',
      message: 'Research notes',
      timestamp: 100,
      actionKey: 'conversation.open',
      meta: { conversationType: 'assistant', conversationId: 'topic-1' },
      source: 'assistant'
    })
    expect(mocks.preferenceGet).not.toHaveBeenCalled()
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('sends a presentation-ready approval event to the focused full-chrome window', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo({ isFocused: true })] : []
    )

    emitApproval()

    expect(mocks.send).toHaveBeenCalledWith('main-1', 'notification.conversation', {
      id: 'approval-request:approval-1',
      kind: 'approval-request',
      type: 'warning',
      title: 'Assistant needs your input',
      message: 'Research notes',
      timestamp: 200,
      actionKey: 'conversation.open',
      meta: { conversationType: 'assistant', conversationId: 'topic-1' },
      source: 'assistant'
    })
    expect(mocks.preferenceGet).not.toHaveBeenCalled()
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('shows a main-owned Agent approval notification and delegates its click to conversation navigation', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )

    emitApproval(
      {
        topicId: 'agent-session:session-1',
        approvalId: 'approval-agent'
      },
      'agent'
    )

    expect(mocks.electronNotifications).toHaveLength(1)
    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Agent needs your input',
      body: 'Refactor project'
    })

    mocks.electronNotifications[0].click?.()
    expect(mocks.focusOrOpen).toHaveBeenCalledWith(
      { conversationType: 'agent', conversationId: 'session-1' },
      'Refactor project'
    )
    expect(mocks.broadcastToType).not.toHaveBeenCalled()
  })

  it('logs a name lookup failure and keeps notifying with the localized generic name', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    mocks.agentSessionGetById.mockImplementation(() => {
      throw new Error('missing')
    })

    emitCompletion({ topicId: 'agent-session:missing' })

    expect(mocks.electronNotifications[0].options).toEqual({ title: 'Agent task complete', body: 'New task' })
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to resolve conversation name for notification',
      expect.objectContaining({ target: { conversationType: 'agent', conversationId: 'missing' } })
    )
  })

  it('does not notify in the background when the preference is disabled', () => {
    mocks.preferenceGet.mockReturnValue(false)
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    emitApproval({ approvalId: 'approval-disabled' })
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('notifies without a full-chrome window and delegates its click to cold-start navigation', () => {
    mocks.getWindowInfosByType.mockReturnValue([])

    emitCompletion({ turnId: 'turn-windowless' })

    expect(mocks.electronNotifications).toHaveLength(1)
    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Assistant response complete',
      body: 'Research notes'
    })

    mocks.electronNotifications[0].click?.()
    expect(mocks.focusOrOpen).toHaveBeenCalledWith(
      { conversationType: 'assistant', conversationId: 'topic-1' },
      'Research notes'
    )
  })

  it('preserves the existing click behavior for unrelated system notifications', async () => {
    const notification = {
      id: 'other',
      type: 'info' as const,
      title: 'Update',
      message: 'Ready',
      timestamp: 1,
      source: 'update' as const
    }
    await service.sendNotification(notification)

    mocks.electronNotifications[0].click?.()
    expect(mocks.showMainWindow).toHaveBeenCalledOnce()
    expect(mocks.broadcastToType).toHaveBeenCalledWith(WindowType.Main, 'notification.clicked', notification)
  })
})
