/**
 * notifyDataApiDataChange unit tests (unified application mock).
 *
 * Covers the notifier's own guarantees: empty-input short-circuit, the
 * `isReady()` delivery boundary, broadcast payload shape, and the hard fence
 * that a notification failure never propagates into the (already committed)
 * write path. Real ServiceContainer semantics (get vs getOptional) are covered
 * separately in dataApiDataChange.container.test.ts — the unified mock also
 * mirrors them, but a mock cannot prove them.
 */
import { application } from '@application'
import type { DataApiDataChangeEffect } from '@shared/data/api/types'
import { IpcChannel } from '@shared/IpcChannel'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { notifyDataApiDataChange } from '../dataApiDataChange'

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory()
})

const windowManager = application.get('WindowManager') as unknown as { broadcast: ReturnType<typeof vi.fn> }
const originalNodeEnv = process.env.NODE_ENV

const effects: DataApiDataChangeEffect[] = [
  { endpoint: '/topics', kind: 'membership', entityIds: ['topic_1'] },
  { endpoint: '/topics/latest' }
]

describe('notifyDataApiDataChange', () => {
  beforeEach(() => {
    vi.mocked(application.isReady).mockClear().mockReturnValue(true)
    vi.mocked(application.get).mockClear()
    mockMainLoggerService.warn.mockClear()
    windowManager.broadcast.mockReset()
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('broadcasts the effects on the fixed data-changed channel', () => {
    notifyDataApiDataChange(effects)

    expect(windowManager.broadcast).toHaveBeenCalledExactlyOnceWith(IpcChannel.DataApi_DataChanged, effects)
  })

  it('rejects route parameters that are not declared by the endpoint outside production', () => {
    const invalid: DataApiDataChangeEffect[] = [
      { endpoint: '/topics/:id', routeParams: { topicId: 'topic_1' }, entityIds: ['topic_1'] }
    ]

    expect(() => notifyDataApiDataChange(invalid)).toThrow(/routeParams \[topicId\].*\/topics\/:id/)
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })

  it('warns and continues delivery for invalid route parameters in production', () => {
    process.env.NODE_ENV = 'production'
    const invalid: DataApiDataChangeEffect[] = [
      { endpoint: '/topics/:id', routeParams: { topicId: 'topic_1' }, entityIds: ['topic_1'] }
    ]

    notifyDataApiDataChange(invalid)

    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      expect.stringMatching(/routeParams \[topicId\].*\/topics\/:id/)
    )
    expect(windowManager.broadcast).toHaveBeenCalledExactlyOnceWith(IpcChannel.DataApi_DataChanged, invalid)
  })

  it('returns silently on an empty effects array', () => {
    notifyDataApiDataChange([])

    expect(application.isReady).not.toHaveBeenCalled()
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })

  it('drops notifications until bootstrap completes (delivery boundary)', () => {
    vi.mocked(application.isReady).mockReturnValue(false)

    notifyDataApiDataChange(effects)

    // Guard must short-circuit BEFORE any service lookup — a bare get() here
    // would lazily construct WhenReady services prematurely.
    expect(application.get).not.toHaveBeenCalled()
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })

  it('never lets a notification failure escape into the write path', () => {
    windowManager.broadcast.mockImplementationOnce(() => {
      throw new Error('window went away')
    })

    expect(() => notifyDataApiDataChange(effects)).not.toThrow()
  })
})
