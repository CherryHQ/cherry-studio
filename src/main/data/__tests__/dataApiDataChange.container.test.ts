/**
 * Real-ServiceContainer smoke test for notifyDataApiDataChange.
 *
 * The unified application mock mirrors container semantics, but a mock cannot
 * PROVE them — this contract's v1 draft used getOptional('WindowManager'),
 * which the real container rejects for non-conditional services, and a mock
 * that quietly returned the instance would have hidden that. Here the mocked
 * '@application' delegates get()/getOptional() to a REAL ServiceContainer
 * holding a registered (non-conditional) WindowManager stub, so:
 * - the notifier's get('WindowManager') path is exercised against real
 *   resolution, and
 * - a future refactor to getOptional() fails loudly.
 */
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'
import { afterAll, describe, expect, it, vi } from 'vitest'

import { notifyDataApiDataChange } from '../dataApiDataChange'

const broadcastSpy = vi.fn()

vi.mock('@application', async () => {
  const { ServiceContainer } = await import('../../core/lifecycle/ServiceContainer')
  ServiceContainer.reset()
  const container = ServiceContainer.getInstance()

  // Registered under its class name (getServiceName falls back to target.name),
  // with no @Conditional metadata — i.e. a regular, non-conditional service.
  class WindowManager {
    broadcast = broadcastSpy
  }
  container.register(WindowManager as never)

  return {
    application: {
      isReady: vi.fn(() => true),
      get: (name: string) => container.get(name),
      getOptional: (name: string) => container.getOptional(name)
    },
    serviceList: []
  }
})

afterAll(async () => {
  const { ServiceContainer } = await import('../../core/lifecycle/ServiceContainer')
  ServiceContainer.reset()
})

describe('notifyDataApiDataChange (real ServiceContainer semantics)', () => {
  const effects: DataApiDataChangeEffect[] = [{ endpoint: '/topics', kind: 'projection', entityIds: ['topic_1'] }]

  it('delivers through real container resolution of WindowManager', () => {
    notifyDataApiDataChange(effects)

    expect(broadcastSpy).toHaveBeenCalledExactlyOnceWith(IpcChannel.DataApi_DataChanged, effects)
  })

  it('real container rejects getOptional() for the non-conditional WindowManager', async () => {
    const { application } = await import('@application')

    expect(() => application.getOptional('WindowManager')).toThrow(/not conditional/)
  })
})
