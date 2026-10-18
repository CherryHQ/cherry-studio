import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { BaseService } from '@main/core/lifecycle'
import type { UtilityProcessRequestOptions } from '@main/core/utilityProcess/types'

import { AutomationReplService } from '../AutomationReplService'

const owner = { kind: 'topic' as const, sessionId: 'topic', ownerId: 'assistant', label: 'Conversation' }
let service: AutomationReplService
let effects: number
let leases: number
let failingOperation: string | undefined
let crashAfterDispatch: boolean
let lastCall: UtilityProcessRequestOptions<never>['onHostCall']

beforeEach(async () => {
  BaseService.resetInstances()
  effects = 0
  leases = 0
  failingOperation = undefined
  crashAfterDispatch = false
  lastCall = undefined
  const get = application.getContainer().get.bind(application.getContainer())
  const manager = {
    register: () => {},
    createInstance: () => ({
      request: async (_method: string, input: { code: string }, options: UtilityProcessRequestOptions<never>) => {
        lastCall = options.onHostCall
        const calls = JSON.parse(input.code)
        let value: { ok: boolean } = { ok: true }
        for (const call of Array.isArray(calls) ? calls : [calls]) {
          value = (await lastCall!('browser', call, options.signal!)) as { ok: boolean }
          if (!value.ok) break
        }
        if (crashAfterDispatch) throw new Error('Kernel exited unexpectedly')
        return { text: JSON.stringify(value), isError: !value.ok }
      },
      stop: async () => {},
      dispose: async () => {}
    })
  }
  const browser = {
    createControl: () => {
      leases++
      let closed = false
      return {
        execute: async (name: string) => {
          if (closed) throw new Error('Lease closed')
          if (name === failingOperation)
            throw Object.assign(new Error('Observation unavailable'), { code: 'CAPTURE_FAILED', effect: 'none' })
          return { value: { effects: ++effects }, observation: true }
        },
        close: async () => {
          if (!closed) {
            closed = true
            leases--
          }
        }
      }
    }
  }
  vi.spyOn(application, 'get').mockImplementation(((name: string) => {
    if (name === 'UtilityProcessManager') return manager
    if (name === 'BrowserSessionService') return browser
    return get(name as Parameters<typeof get>[0])
  }) as typeof application.get)
  service = new AutomationReplService()
  await service._doInit()
})

afterEach(async () => {
  await service._doStop()
  vi.restoreAllMocks()
})

const code = JSON.stringify({ name: 'getAXState', args: {} })

describe('automation run authority', () => {
  it('delivers the bundled API on first binding and restores it on an explicit documentation request', async () => {
    const run = service.beginRun(owner, 'run', () => ({ browser: true, computer: false }))
    const first = await run.execute(JSON.stringify({ name: 'getTab' }))
    expect(first.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('# Automation REPL') }),
        expect.objectContaining({ type: 'text', text: expect.stringContaining('interface Tab') })
      ])
    )
    const second = await run.execute(JSON.stringify({ name: 'getTab' }))
    expect(second.content.some((part) => part.type === 'text' && part.text.includes('interface Tab'))).toBe(false)
    const restored = await run.execute(JSON.stringify({ name: 'documentation' }))
    expect(restored.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'text', text: expect.stringContaining('interface Tab') })
      ])
    )
  })

  it('preserves completed input separately from a later failed observation without replay', async () => {
    failingOperation = 'getAXState'
    const run = service.beginRun(owner, 'run', () => ({ browser: true, computer: false }))
    const result = await run.execute(
      JSON.stringify([
        { name: 'click', args: { ref: 'button' }, target: 'tab-1' },
        { name: 'getAXState', target: 'tab-1' }
      ])
    )
    expect(result.structuredContent).toMatchObject({
      execution: {
        events: [
          { domain: 'browser', operation: 'click', target: 'tab-1', status: 'completed' },
          {
            domain: 'browser',
            operation: 'getAXState',
            target: 'tab-1',
            status: 'failed',
            error: { code: 'CAPTURE_FAILED', effect: 'none' }
          }
        ],
        omitted: 0
      }
    })
    expect(effects).toBe(1)
    expect(result.isError).toBe(true)
  })

  it('releases live control when the kernel fails and reports cleared bindings', async () => {
    crashAfterDispatch = true
    const run = service.beginRun(owner, 'run', () => ({ browser: true, computer: false }))
    const result = await run.execute(code)
    expect(result.structuredContent).toMatchObject({ replContext: { state: 'cleared', bindings: [] } })
    expect(leases).toBe(0)
    expect(effects).toBe(1)
  })

  it('does not widen a run grant when a capability is enabled later', async () => {
    let enabled = false
    const run = service.beginRun(owner, 'run', () => ({ browser: enabled, computer: false }))
    enabled = true
    expect((await run.execute(code)).isError).toBe(true)
    expect(effects).toBe(0)
    expect(leases).toBe(0)
  })

  it('rechecks revocation and rejects calls retained after a run ends', async () => {
    let enabled = true
    const run = service.beginRun(owner, 'run', () => ({ browser: enabled, computer: false }))
    expect((await run.execute(code)).isError).not.toBe(true)
    const staleCall = lastCall!
    expect(effects).toBe(1)
    enabled = false
    expect((await run.execute(code)).isError).toBe(true)
    expect(effects).toBe(1)
    await run.finish()
    expect(leases).toBe(0)
    await expect(staleCall('browser', { name: 'getAXState', args: {} }, new AbortController().signal)).rejects.toThrow()
    expect(effects).toBe(1)
  })

  it('queues sibling chat runs until the previous response releases exclusive control', async () => {
    const access = () => ({ browser: true, computer: false })
    const first = await service.acquireRun(owner, 'model-1', access)
    await first.execute(code)
    let admitted = false
    const pending = service.acquireRun(owner, 'model-2', access).then((run) => {
      admitted = true
      expect(leases).toBe(0)
      return run
    })
    await Promise.resolve()
    expect(admitted).toBe(false)
    expect(leases).toBe(1)
    expect((await first.execute(code)).isError).not.toBe(true)
    await first.finish()
    const second = await pending
    expect((await second.execute(code)).isError).not.toBe(true)
    expect(effects).toBe(3)
    expect(leases).toBe(1)
    await second.finish()
    expect(leases).toBe(0)
  })

  it('cancels queued admission without interrupting the active sibling or blocking a later one', async () => {
    const access = () => ({ browser: true, computer: false })
    const first = await service.acquireRun(owner, 'model-1', access)
    await first.execute(code)
    const abort = new AbortController()
    const pending = service.acquireRun(owner, 'cancelled-model', access, abort.signal)
    abort.abort(new Error('Response cancelled'))
    await expect(pending).rejects.toThrow('Response cancelled')
    expect((await first.execute(code)).isError).not.toBe(true)
    expect(leases).toBe(1)
    const next = service.acquireRun(owner, 'model-3', access)
    await first.finish()
    const third = await next
    await third.execute(code)
    expect(effects).toBe(3)
    await third.finish()
    expect(leases).toBe(0)
  })

  it('does not widen capabilities while a sibling waits for admission', async () => {
    const first = service.beginRun(owner, 'model-1', () => ({ browser: true, computer: false }))
    let enabled = false
    const pending = service.acquireRun(owner, 'model-2', () => ({ browser: enabled, computer: false }))
    enabled = true
    await first.finish()
    const second = await pending
    expect((await second.execute(code)).isError).toBe(true)
    expect(effects).toBe(0)
    expect(leases).toBe(0)
  })

  it('rejects waiting siblings when their conversation closes', async () => {
    const access = () => ({ browser: true, computer: false })
    const first = service.beginRun(owner, 'model-1', access)
    await first.execute(code)
    const pending = service.acquireRun(owner, 'model-2', access)
    const rejected = expect(pending).rejects.toThrow('Automation session is closing')
    await service.close(owner)
    await rejected
    expect(leases).toBe(0)
    expect(effects).toBe(1)
  })

  it('prevents overlapping runs and releases the previous lease before a later turn', async () => {
    const access = () => ({ browser: true, computer: false })
    const first = service.beginRun(owner, 'first', access)
    expect(() => service.beginRun(owner, 'overlap', access)).toThrow('active automation run')
    await first.execute(code)
    expect(leases).toBe(1)
    await first.finish()
    expect(leases).toBe(0)
    const second = service.beginRun(owner, 'second', access)
    expect((await second.execute(code)).isError).not.toBe(true)
    expect(effects).toBe(2)
    await second.finish()
    expect(leases).toBe(0)
  })
})
