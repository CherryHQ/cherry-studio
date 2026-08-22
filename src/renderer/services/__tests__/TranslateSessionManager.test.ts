import type { AbsoluteFilePath } from '@shared/types/file'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const cacheMocks = vi.hoisted(() => ({ delete: vi.fn<(key: string) => boolean>(() => true) }))

vi.mock('@data/CacheService', () => ({ cacheService: cacheMocks }))

import { TranslateSessionManager } from '../TranslateSessionManager'

describe('TranslateSessionManager', () => {
  let manager: TranslateSessionManager

  beforeEach(() => {
    vi.useFakeTimers()
    cacheMocks.delete.mockReset()
    cacheMocks.delete.mockReturnValue(true)
    manager = new TranslateSessionManager()
  })

  afterEach(() => {
    manager.clear()
    vi.useRealTimers()
  })

  it('releases terminal session state after its last tab reference disappears', async () => {
    manager.setReferencedSessionIds(new Set(['translate-1']))
    manager.setStatus('translate-1', 'completed')

    manager.setReferencedSessionIds(new Set())
    await vi.runAllTimersAsync()

    expect(cacheMocks.delete.mock.calls.map(([key]) => key)).toEqual([
      'translate.session.input.translate-1',
      'translate.session.output.translate-1',
      'translate.session.detecting.translate-1'
    ])
    expect(manager.getSessionIds()).not.toContain('translate-1')
  })

  it('retains an unreferenced running task until it reaches a terminal state', async () => {
    manager.setReferencedSessionIds(new Set(['translate-1']))
    manager.setStatus('translate-1', 'running')

    manager.setReferencedSessionIds(new Set())
    await vi.runAllTimersAsync()

    expect(cacheMocks.delete).not.toHaveBeenCalled()
    expect(manager.getSessionIds()).toContain('translate-1')

    manager.setStatus('translate-1', 'completed')
    await vi.runAllTimersAsync()

    expect(cacheMocks.delete).toHaveBeenCalledTimes(3)
    expect(manager.getSessionIds()).not.toContain('translate-1')
  })

  it('keeps enough PDF runtime state to reconnect and cancel the same job', () => {
    const cancel = vi.fn()
    const file = { name: 'paper.pdf', path: '/tmp/paper.pdf' as AbsoluteFilePath }

    manager.preparePdf('translate-1', file)
    manager.beginPdf('translate-1', 'pdf-job-1', file, 'zh-cn', cancel)

    expect(manager.getPdfSnapshot('translate-1')).toMatchObject({
      activeJobId: 'pdf-job-1',
      file,
      phase: 'preparing',
      targetLanguage: 'zh-cn'
    })

    expect(manager.cancel('translate-1')).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
    expect(manager.getPdfSnapshot('translate-1')).toMatchObject({ activeJobId: null, file, phase: 'idle' })
  })
})
