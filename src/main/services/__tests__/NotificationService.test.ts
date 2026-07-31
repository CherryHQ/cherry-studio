import { BaseService } from '@main/core/lifecycle'
import { type WindowInfo, WindowType } from '@main/core/window/types'
import type { TaskCompletionTarget } from '@shared/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applicationGet: vi.fn(),
  agentSessionGetById: vi.fn(),
  broadcastToType: vi.fn(),
  electronNotifications: [] as Array<{
    options: { title: string; body: string }
    click?: () => void
    show: ReturnType<typeof vi.fn>
  }>,
  getWindow: vi.fn(),
  getWindowInfosByType: vi.fn(),
  getWindowType: vi.fn(),
  loggerWarn: vi.fn(),
  openRouteInMainWindow: vi.fn(),
  preferenceGet: vi.fn(),
  send: vi.fn(),
  showMainWindow: vi.fn(),
  topicGetById: vi.fn()
}))

vi.mock('@application', () => ({ application: { get: mocks.applicationGet } }))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: mocks.agentSessionGetById }
}))
vi.mock('@data/services/TopicService', () => ({ topicService: { getById: mocks.topicGetById } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ warn: mocks.loggerWarn }) }
}))
vi.mock('@main/i18n', () => ({
  t: (key: string) =>
    ({
      'agent.session.new': 'New task',
      'chat.conversation.new': 'New Chat',
      'notification.completion.agent': 'Agent task complete',
      'notification.completion.assistant': 'Assistant response complete'
    })[key] ?? key
}))
vi.mock('../mainWindowNavigation', () => ({ openRouteInMainWindow: mocks.openRouteInMainWindow }))
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

describe('NotificationService', () => {
  let service: InstanceType<typeof NotificationService>

  beforeEach(() => {
    BaseService.resetInstances()
    vi.clearAllMocks()
    mocks.electronNotifications.length = 0
    service = new NotificationService()
    mocks.getWindowInfosByType.mockReturnValue([])
    mocks.preferenceGet.mockReturnValue(true)
    mocks.applicationGet.mockImplementation((name: string) => {
      if (name === 'WindowManager') {
        return {
          getWindowInfosByType: mocks.getWindowInfosByType,
          getWindow: mocks.getWindow,
          getWindowType: mocks.getWindowType
        }
      }
      if (name === 'IpcApiService') {
        return { send: mocks.send, broadcastToType: mocks.broadcastToType }
      }
      if (name === 'MainWindowService') return { showMainWindow: mocks.showMainWindow }
      if (name === 'PreferenceService') return { get: mocks.preferenceGet }
      throw new Error(`Unexpected application.get(${name})`)
    })
  })

  it('sends one in-app event to the focused full-chrome window', () => {
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

    service.notifyTaskCompletion({
      topicId: 'topic-1',
      turnId: 'turn-1',
      completedAt: 100,
      target: { conversationType: 'assistant', conversationId: 'topic-1' }
    })

    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.send).toHaveBeenCalledWith('sub-1', 'notification.task_completed', {
      topicId: 'topic-1',
      turnId: 'turn-1',
      completedAt: 100,
      delivery: 'in-app'
    })
    expect(mocks.preferenceGet).not.toHaveBeenCalled()
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('shows a main-owned assistant system notification in the background and cold-opens its route on click', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    mocks.topicGetById.mockReturnValue({ name: 'Research notes' })

    service.notifyTaskCompletion({
      topicId: 'topic-1',
      turnId: 'turn-2',
      completedAt: 200,
      target: { conversationType: 'assistant', conversationId: 'topic-1' }
    })

    expect(mocks.electronNotifications).toHaveLength(1)
    expect(mocks.electronNotifications[0].options).toEqual({
      title: 'Assistant response complete',
      body: 'Research notes'
    })

    mocks.electronNotifications[0].click?.()
    expect(mocks.openRouteInMainWindow).toHaveBeenCalledWith('/app/chat?topicId=topic-1')
    expect(mocks.broadcastToType).not.toHaveBeenCalled()
  })

  it('resolves Agent names in main and uses the localized fallback when lookup fails', () => {
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )
    mocks.agentSessionGetById.mockImplementation(() => {
      throw new Error('missing')
    })

    service.notifyTaskCompletion({
      topicId: 'agent-session:session-1',
      turnId: 'turn-3',
      completedAt: 300,
      target: { conversationType: 'agent', conversationId: 'session-1' }
    })

    expect(mocks.electronNotifications[0].options).toEqual({ title: 'Agent task complete', body: 'New task' })
    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'Failed to resolve completed conversation name',
      expect.objectContaining({ target: { conversationType: 'agent', conversationId: 'session-1' } })
    )

    mocks.electronNotifications[0].click?.()
    expect(mocks.openRouteInMainWindow).toHaveBeenCalledWith('/app/agents?sessionId=session-1')
  })

  it('does not show a background notification when the preference is disabled or no full-chrome window exists', () => {
    mocks.preferenceGet.mockReturnValue(false)
    mocks.getWindowInfosByType.mockImplementation((type: WindowType) =>
      type === WindowType.Main ? [mainWindowInfo()] : []
    )

    service.notifyTaskCompletion({
      topicId: 'topic-1',
      turnId: 'turn-disabled',
      completedAt: 400,
      target: { conversationType: 'assistant', conversationId: 'topic-1' }
    })
    expect(mocks.electronNotifications).toHaveLength(0)

    mocks.preferenceGet.mockReturnValue(true)
    mocks.getWindowInfosByType.mockReturnValue([])
    service.notifyTaskCompletion({
      topicId: 'topic-1',
      turnId: 'turn-windowless',
      completedAt: 500,
      target: { conversationType: 'assistant', conversationId: 'topic-1' }
    })
    expect(mocks.electronNotifications).toHaveLength(0)
  })

  it('focuses a registered target in another window instead of opening a duplicate', () => {
    const target: TaskCompletionTarget = { conversationType: 'agent', conversationId: 'session-1' }
    const window = {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }
    mocks.getWindow.mockReturnValue(window)
    mocks.getWindowType.mockReturnValue(WindowType.SubWindow)
    service.syncTaskTargets('sub-1', [target])

    expect(service.focusTaskTarget(target, 'main-1')).toBe(true)
    expect(mocks.send).toHaveBeenCalledWith('sub-1', 'notification.open_task_target_requested', { target })
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
    expect(mocks.openRouteInMainWindow).not.toHaveBeenCalled()
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
