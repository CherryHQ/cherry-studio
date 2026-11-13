import { copyFileSync, existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { prepareRpc } from '../examples/runtime.mjs'
import { SandboxManager } from '../src/host/SandboxManager.js'
import { spec, readAll } from './fixtures.js'

describe.skipIf(!['darwin', 'win32'].includes(process.platform))('MXC stdio RPC', () => {
  const root = fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, '')
  const guests: ReturnType<typeof prepareRpc>[] = []
  afterEach(() => {
    for (const guest of guests.splice(0)) guest.cleanup()
  })
  function request(python = false) {
    const guest = prepareRpc(root, python)
    guests.push(guest)
    guest.spec.ownerId = 'test'
    return guest.spec
  }

  it('decodes multiple JSON-RPC frames received in one stdout chunk', async () => {
    const manager = new SandboxManager()
    const value = request()
    copyFileSync(join(root, 'tests/fixtures/coalescedRpc.mjs'), join(value.command.cwd, 'examples/coalescedRpc.mjs'))
    value.command.args = [...value.command.args.slice(0, -1), join(value.command.cwd, 'examples/coalescedRpc.mjs')]
    const instance = manager.start(value, { rpc: { configure() {}, authorize: async () => false } })
    const errors = readAll(instance.stderr)
    try {
      await instance.ready
      await expect(instance.rpc.request('fixture.coalesced', {})).resolves.toEqual({ value: 41 })
    } finally {
      await manager.dispose()
      await errors
    }
  })

  it('does not execute a target if host RPC registration fails', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'sandbox-rpc-setup-')))
    const marker = join(root, 'executed')
    const manager = new SandboxManager()
    try {
      const requestSpec = spec(process.execPath, [
        '-e',
        'require("node:fs").writeFileSync(process.argv[1], "executed")',
        marker
      ])
      requestSpec.filesystem.write = [root]
      const instance = manager.start(
        { ...requestSpec, channel: 'stdio' },
        {
          rpc: {
            authorize: async () => true,
            configure() {
              throw new Error('Registration failed')
            }
          }
        }
      )
      await expect(instance.ready).rejects.toThrow('Registration failed')
      await manager.dispose()
      expect(existsSync(marker)).toBe(false)
      expect(await manager.dispose()).toEqual([])
    } finally {
      await manager.dispose()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each([false, true])('runs a request with a guest-to-host callback (python=%s)', async (python) => {
    const manager = new SandboxManager()
    const authorized: string[] = []
    try {
      const instance = manager.start(request(python), {
        rpc: {
          authorize: async (context) => {
            authorized.push(context.instanceId)
            return context.ownerId === 'test' && context.method === 'example.double'
          },
          configure(peer) {
            peer.handle('example.double', async ({ value }) => {
              if (typeof value !== 'number') throw new Error('Invalid value')
              return { value: value * 2 }
            })
          }
        }
      })
      const errors = readAll(instance.stderr)
      await expect(instance.rpc.request('example.compute', { value: 20 })).rejects.toThrow('not ready')
      await instance.ready
      expect(instance.stdin).toBeNull()
      expect(instance.stdout).toBeNull()
      await expect(instance.rpc.request('example.compute', { value: 20 })).resolves.toEqual({ value: 41 })
      expect(authorized).toEqual([instance.id])
      expect(await instance.stop()).toMatchObject({ tree: 'unverified', cleanup: 'complete' })
      await errors
      await expect(instance.rpc.request('example.compute', { value: 20 })).rejects.toThrow('disconnected')
    } finally {
      await manager.dispose()
    }
  })

  it('rejects an unauthorized callback without invoking the host handler; timed-out requests do not block later work', async () => {
    const manager = new SandboxManager()
    let secretReads = 0
    const instance = manager.start(request(), {
      rpc: {
        authorize: async ({ method }) => method === 'example.double',
        configure(peer) {
          peer.handle('example.secret', async () => {
            secretReads++
            return 'secret'
          })
          peer.handle('example.double', async ({ value }) => ({ value: Number(value) * 2 }))
        }
      }
    })
    const errors = readAll(instance.stderr)
    try {
      await instance.ready
      await expect(instance.rpc.request('example.forbidden', {})).rejects.toThrow('Access denied')
      expect(secretReads).toBe(0)
      await expect(instance.rpc.request('example.wait', {}, { timeoutMs: 100 })).rejects.toThrow('timed out')
      await expect(instance.rpc.request('example.compute', { value: 20 })).resolves.toEqual({ value: 41 })
    } finally {
      await manager.dispose()
      await errors
    }
  })
})
