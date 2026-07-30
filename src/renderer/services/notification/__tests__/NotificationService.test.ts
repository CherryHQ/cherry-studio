import type { Notification } from '@shared/types/notification'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationService } from '../NotificationService'

const mocks = vi.hoisted(() => ({
  getMultiple: vi.fn(),
  request: vi.fn()
}))

vi.mock('@data/PreferenceService', () => ({
  preferenceService: {
    getMultiple: mocks.getMultiple
  }
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: {
    request: mocks.request
  }
}))

const completionNotification: Notification = {
  id: 'task-completion:turn-1',
  type: 'success',
  title: 'Agent task complete',
  message: 'Agent session',
  timestamp: 100,
  source: 'assistant'
}

describe('NotificationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.request.mockResolvedValue(undefined)
  })

  it('suppresses an assistant-source system notification when the preference is disabled', async () => {
    mocks.getMultiple.mockResolvedValue({
      assistant: false,
      backup: false,
      knowledge: false
    })

    await new NotificationService().send(completionNotification)

    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('sends an assistant-source system notification when the preference is enabled', async () => {
    mocks.getMultiple.mockResolvedValue({
      assistant: true,
      backup: false,
      knowledge: false
    })

    await new NotificationService().send(completionNotification)

    expect(mocks.request).toHaveBeenCalledWith('notification.send', completionNotification)
  })
})
