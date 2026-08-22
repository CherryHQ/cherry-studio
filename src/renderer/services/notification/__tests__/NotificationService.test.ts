import type { Notification, NotificationSource } from '@renderer/types/notification'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  request: vi.fn()
}))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: mocks.request } }))
vi.mock('@data/PreferenceService', async () => {
  const { createMockPreferenceService } = await import('../../../../../tests/__mocks__/renderer/PreferenceService')
  return { preferenceService: createMockPreferenceService() }
})

import { preferenceService } from '@data/PreferenceService'

import { notificationService } from '../NotificationService'

// Compile-time exhaustiveness: adding a NotificationSource member without a
// preference gate breaks this Record before it can be silently dropped in send().
const PREF_BY_SOURCE: Record<NotificationSource, UnifiedPreferenceKeyType> = {
  assistant: 'app.notification.assistant.enabled',
  backup: 'app.notification.backup.enabled',
  knowledge: 'app.notification.knowledge.enabled',
  update: 'app.notification.update.enabled'
}

const buildNotification = (source: NotificationSource): Notification => ({
  id: `id-${source}`,
  type: 'info',
  title: 'title',
  message: 'message',
  timestamp: 1723350000000,
  source
})

describe('NotificationService', () => {
  beforeEach(async () => {
    mocks.request.mockClear()
    for (const key of Object.values(PREF_BY_SOURCE)) {
      await preferenceService.set(key, false)
    }
  })

  it.each(Object.keys(PREF_BY_SOURCE) as NotificationSource[])(
    'delivers %s notifications when their preference is enabled',
    async (source) => {
      await preferenceService.set(PREF_BY_SOURCE[source], true)

      await notificationService.send(buildNotification(source))

      expect(mocks.request).toHaveBeenCalledWith('notification.send', buildNotification(source))
    }
  )

  it('drops notifications whose source preference is disabled', async () => {
    await notificationService.send(buildNotification('update'))

    expect(mocks.request).not.toHaveBeenCalled()
  })
})
