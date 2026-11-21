import { beforeEach, describe, expect, it, vi } from 'vitest'

import { BaseService } from '@main/core/lifecycle'
import { MockApplicationUtils } from '@test-mocks/main/application'

const fetchRemoteTextMock = vi.fn()

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

vi.mock('@logger', () => ({
  loggerService: {
    withContext: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}))

vi.mock('@main/utils/remoteFetch', () => ({
  fetchRemoteText: (...args: unknown[]) => fetchRemoteTextMock(...args)
}))

import type { WebSearchBlacklistSubscription } from '@shared/data/preference/preferenceTypes'

import { BlacklistSubscriptionService } from '../BlacklistSubscriptionService'

const PREFERENCE_KEY = 'chat.web_search.blacklist_subscriptions'

function createPreferenceStore() {
  let subscriptions: WebSearchBlacklistSubscription[] = []
  return {
    get: vi.fn((key: string) => {
      if (key !== PREFERENCE_KEY) throw new Error(`Unexpected preference key: ${key}`)
      return subscriptions
    }),
    set: vi.fn(async (key: string, value: WebSearchBlacklistSubscription[]) => {
      if (key !== PREFERENCE_KEY) throw new Error(`Unexpected preference key: ${key}`)
      subscriptions = value
    }),
    read: () => subscriptions
  }
}

describe('BlacklistSubscriptionService', () => {
  let preferences: ReturnType<typeof createPreferenceStore>
  let service: BlacklistSubscriptionService

  beforeEach(() => {
    BaseService.resetInstances()
    preferences = createPreferenceStore()
    MockApplicationUtils.setService('PreferenceService', preferences)
    fetchRemoteTextMock.mockReset()
    service = new BlacklistSubscriptionService()
  })

  it('adds a valid subscription, fetching and storing the parsed rules', async () => {
    fetchRemoteTextMock.mockResolvedValue('# list\n*://*.spam.example/*\n/bad\\.example/\n::: invalid\n')

    const added = await service.add('https://lists.example/ublacklist.txt', 'My list')

    expect(added.url).toBe('https://lists.example/ublacklist.txt')
    expect(added.name).toBe('My list')
    expect(added.rules).toEqual(['*://*.spam.example/*', '/bad\\.example/'])
    expect(added.updatedAt).toBeDefined()
    expect(preferences.read()).toEqual([added])
  })

  it('rejects invalid or non-HTTP(S) URLs and never stores them', async () => {
    await expect(service.add('file:///etc/passwd')).rejects.toThrow('Invalid subscription URL')
    await expect(service.add('not a url')).rejects.toThrow('Invalid subscription URL')
    expect(fetchRemoteTextMock).not.toHaveBeenCalled()
    expect(preferences.read()).toEqual([])
  })

  it('rejects duplicate subscription URLs', async () => {
    fetchRemoteTextMock.mockResolvedValue('*://*.a.example/*\n')
    await service.add('https://lists.example/a.txt')

    await expect(service.add('https://lists.example/a.txt')).rejects.toThrow('already exists')
  })

  it('refresh updates cached rules and clears lastError on success', async () => {
    fetchRemoteTextMock.mockResolvedValue('*://*.a.example/*\n')
    const added = await service.add('https://lists.example/a.txt')

    fetchRemoteTextMock.mockResolvedValue('*://*.b.example/*\n')
    const refreshed = await service.refresh(added.id)

    expect(refreshed.rules).toEqual(['*://*.b.example/*'])
    expect(refreshed.lastError).toBeUndefined()
    expect(preferences.read()[0].rules).toEqual(['*://*.b.example/*'])
  })

  it('refresh keeps the previous rules and sets lastError on failure', async () => {
    fetchRemoteTextMock.mockResolvedValue('*://*.a.example/*\n')
    const added = await service.add('https://lists.example/a.txt')

    fetchRemoteTextMock.mockRejectedValue(new Error('network down'))
    const refreshed = await service.refresh(added.id)

    expect(refreshed.rules).toEqual(['*://*.a.example/*'])
    expect(refreshed.lastError).toBe('network down')
  })

  it('refresh of an unknown subscription throws', async () => {
    await expect(service.refresh('missing')).rejects.toThrow('Unknown blacklist subscription')
  })

  it('remove drops the subscription without touching other entries', async () => {
    fetchRemoteTextMock.mockResolvedValue('*://*.a.example/*\n')
    const first = await service.add('https://lists.example/a.txt')
    const second = await service.add('https://lists.example/b.txt')

    await service.remove(first.id)

    expect(preferences.read().map((subscription) => subscription.id)).toEqual([second.id])
  })
})
