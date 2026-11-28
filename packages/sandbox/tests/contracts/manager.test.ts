import { describe, expect, it } from 'vitest'

import { SandboxManager } from '../../src/host/SandboxManager.js'
import { spec } from '../fixtures.js'

describe('host contract', () => {
  it('settles a pre-cancelled request without attempting backend setup', async () => {
    const manager = new SandboxManager()
    const instance = manager.start(spec(), { signal: AbortSignal.abort() })
    await expect(instance.ready).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(await instance.completion).toMatchObject({
      reason: 'cancelled',
      target: { status: 'not-started' },
      tree: 'gone',
      cleanup: 'complete'
    })
    await manager.dispose()
  })

  it('returns an observable failed instance for malformed input', async () => {
    const manager = new SandboxManager()
    const request = spec()
    request.limits.ioBufferBytes = -1
    const instance = manager.start(request)
    await expect(instance.ready).rejects.toMatchObject({ code: 'INVALID_SPEC' })
    expect(await instance.completion).toMatchObject({
      target: { status: 'not-started' },
      tree: 'gone',
      cleanup: 'complete'
    })
    await manager.dispose()
  })

  it('does not start new work after disposal', async () => {
    const manager = new SandboxManager()
    await manager.dispose()
    const instance = manager.start(spec())
    await expect(instance.ready).rejects.toMatchObject({ code: 'CANCELLED' })
    expect((await instance.completion).target.status).toBe('not-started')
  })

  it.skipIf(!['darwin', 'win32'].includes(process.platform))(
    'rejects unsupported restrictions instead of weakening them',
    async () => {
      const manager = new SandboxManager()
      for (const modify of [
        (value: ReturnType<typeof spec>) => {
          value.limits.processCount = 2
        },
        (value: ReturnType<typeof spec>) => {
          value.limits.memoryBytes = 1000000
        },
        (value: ReturnType<typeof spec>) => {
          value.network = { mode: 'unrestricted' }
        },
        (value: ReturnType<typeof spec>) => {
          value.environmentId = 'wsl2'
        },
        (value: ReturnType<typeof spec>) => {
          value.channel = 'dedicated' as 'none'
        }
      ]) {
        const request = spec()
        modify(request)
        expect((await manager.probe(request)).status).toBe('unavailable')
        const instance = manager.start(request)
        await expect(instance.ready).rejects.toMatchObject({ code: 'POLICY_UNSUPPORTED' })
        expect((await instance.completion).target.status).toBe('not-started')
      }
      await manager.dispose()
    }
  )

  it.skipIf(['darwin', 'win32'].includes(process.platform))(
    'does not fall back to unrestricted processes on another platform',
    async () => {
      const manager = new SandboxManager()
      expect((await manager.probe(spec())).status).toBe('unavailable')
      const instance = manager.start(spec())
      await expect(instance.ready).rejects.toMatchObject({ code: 'BACKEND_UNAVAILABLE' })
      expect((await instance.completion).target.status).toBe('not-started')
    }
  )
})
