import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { expect, it } from 'vitest'

import { runDiagnostics } from '../../src/diagnostics/run.js'
import { SandboxManager } from '../../src/host/SandboxManager.js'
import { spec } from '../fixtures.js'

// Protect the actual diagnostic evidence, including bundled guest execution and cleanup.
it.each(['files', 'rpc', 'instances', 'network'] as const)(
  'runs %s diagnostics through the public native backend',
  async (group) => {
    const manager = new SandboxManager()
    const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'sandbox-diagnostics-')))
    let removable = false
    try {
      const base = spec(await realpath(process.execPath))
      base.command.cwd = cwd
      base.filesystem.read = [path.dirname(base.command.executable)]
      base.limits.lifetimeMs = 30000
      const result = await runDiagnostics(manager, group, base, AbortSignal.timeout(25000))
      removable = result.removable
      if (group === 'network' && process.platform !== 'darwin') {
        expect(result.results).toMatchObject([{ id: 'backend', status: 'unsupported' }])
      } else {
        expect(result.results.length).toBeGreaterThan(2)
        expect(
          result.results.filter((item) => item.status !== 'passed'),
          result.report
        ).toEqual([])
      }
      expect(removable).toBe(true)
    } finally {
      await manager.dispose()
      if (removable) await rm(cwd, { recursive: true, force: true })
    }
  }
)

it('uses edited RPC input and actually rejects a disabled host callback', async () => {
  for (const allowCallback of [true, false]) {
    const manager = new SandboxManager()
    const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'sandbox-interactive-rpc-')))
    try {
      const base = spec(await realpath(process.execPath))
      base.command.cwd = cwd
      base.filesystem.read = [path.dirname(base.command.executable)]
      const result = await runDiagnostics(manager, 'rpc', base, AbortSignal.timeout(20000), {
        kind: 'rpc',
        value: 7,
        allowCallback
      })
      if (allowCallback) {
        expect(
          result.trace.filter((entry) => entry.step === 'callback-result').map((entry) => JSON.parse(entry.detail))
        ).toEqual([14])
        expect(
          result.trace.filter((entry) => entry.step === 'response').map((entry) => JSON.parse(entry.detail))
        ).toEqual([15])
      } else {
        expect(result.trace.some((entry) => entry.step === 'error' && entry.detail.includes('Access denied'))).toBe(
          true
        )
        expect(result.trace.some((entry) => entry.step === 'callback')).toBe(false)
      }
      expect(result.removable).toBe(true)
    } finally {
      await manager.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  }
})

it.skipIf(process.platform !== 'darwin')(
  'enforces edited network grants against a reachable destination and bounds the response',
  async () => {
    let hits = 0
    const server = createServer((request, response) => {
      hits++
      response.end(request.url + 'x'.repeat(5000))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing test listener')
    const origin = `http://127.0.0.1:${address.port}`
    try {
      for (const allowed of [true, false]) {
        const manager = new SandboxManager()
        const cwd = await realpath(await mkdtemp(path.join(tmpdir(), 'sandbox-interactive-network-')))
        try {
          const base = spec(await realpath(process.execPath))
          base.command.cwd = cwd
          base.filesystem.read = [path.dirname(base.command.executable)]
          const result = await runDiagnostics(manager, 'network', base, AbortSignal.timeout(20000), {
            kind: 'network',
            url: origin + '/query?q=hello',
            allowedOrigins: allowed ? [origin] : []
          })
          const response = result.trace.find((entry) => entry.step === 'response')
          expect(response, JSON.stringify(result.trace)).toBeDefined()
          expect(JSON.parse(response!.detail)).toMatchObject(
            allowed
              ? { status: 200, truncated: true, body: '/query?q=hello' + 'x'.repeat(4096 - '/query?q=hello'.length) }
              : { status: 403 }
          )
          expect(hits).toBe(1)
          expect(result.removable).toBe(true)
        } finally {
          await manager.dispose()
          await rm(cwd, { recursive: true, force: true })
        }
      }
    } finally {
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
)
