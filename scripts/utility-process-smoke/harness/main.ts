/**
 * Drives ProcessHost + the real Electron adapter inside a real Electron main process.
 *
 * Only what a real process can prove lives here — bundle layout, asar path resolution,
 * cross-process cloning, kill and crash semantics, pipes, proxy inheritance. Request
 * correlation, cancellation policy, the breaker and the stop barriers are unit-tested
 * against the in-memory adapter and are deliberately not repeated.
 *
 * It does not boot the lifecycle container: that would drag winston, BootConfig and quit
 * handlers into a throwaway app for no added coverage.
 */

import http from 'node:http'
import path from 'node:path'

import { app } from 'electron'

import { electronProcessAdapter } from '../../../src/main/core/utilityProcess/host/electronProcessAdapter'
import { ProcessHost } from '../../../src/main/core/utilityProcess/host/ProcessHost'
import { isUtilityProcessError } from '../../../src/main/core/utilityProcess/UtilityProcessError'
import { createEvidenceLogger, record } from './evidence'
import {
  checksum,
  type SmokeContract,
  smokeEchoProcess,
  type SmokeInitData,
  smokeTerminateProcess
} from './smokeContract'

const FOUR_MIB = 4 * 1024 * 1024
const WATCHDOG_MS = 90_000

const logger = createEvidenceLogger()
let failures = 0

const hostFor = (definition: typeof smokeEchoProcess) =>
  new ProcessHost<SmokeContract, SmokeInitData>(definition, {
    adapter: electronProcessAdapter,
    logger,
    resolveEntry: (entry) => path.join(app.getAppPath(), 'out', 'utility-process', `${entry}.js`),
    getTempDir: () => app.getPath('temp')
  })

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

/** stdout/stderr cross a pipe, not the message port, so they can land after the result. */
async function waitFor(predicate: () => boolean, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`)
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  let value: unknown
  try {
    value = await promise
  } catch (error) {
    return error
  }
  throw new Error(`expected a rejection, got ${JSON.stringify(value)}`)
}

const errorLogCount = (): number => logger.entries.filter((entry) => entry.level === 'error').length

function assertIntentionalExit(error: unknown, label: string): void {
  assert(isUtilityProcessError(error, 'PROCESS_EXITED') && error.intentional, `${label} gave ${String(error)}`)
}

async function check(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
    record({ event: 'check', name, status: 'pass' })
  } catch (error) {
    failures += 1
    record({ event: 'check', name, status: 'fail', message: error instanceof Error ? error.message : String(error) })
  }
}

/** Runs `body` against a fresh host and always disposes it, so one failure cannot poison the next check. */
async function withHost(
  definition: typeof smokeEchoProcess,
  body: (host: ProcessHost<SmokeContract, SmokeInitData>) => Promise<void>
): Promise<void> {
  const host = hostFor(definition)
  try {
    await body(host)
  } finally {
    await host.dispose().catch(() => {})
  }
}

async function runChecks(): Promise<void> {
  // Each definition resolves its own bundle and gets through the connect handshake, whose
  // processId check would reject a process serving the other entry's id. Covers the emitted
  // layout and, in the asar variant, path resolution inside the archive.
  await check('entry-isolation', async () => {
    for (const definition of [smokeEchoProcess, smokeTerminateProcess]) {
      await withHost(definition, async (host) => {
        assert((await host.request('ping', undefined)) === 'pong', `${definition.id} did not answer ping`)
      })
    }
  })

  await check('typed-array-4mib', () =>
    withHost(smokeEchoProcess, async (host) => {
      const bytes = new Uint8Array(FOUR_MIB)
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251
      const expected = checksum(bytes)
      const echoed = await host.request('echoBytes', bytes)
      assert(echoed.bytes instanceof Uint8Array, 'round trip did not preserve Uint8Array')
      assert(echoed.byteLength === FOUR_MIB, `child saw ${echoed.byteLength} bytes`)
      assert(echoed.checksum === expected, `child checksum ${echoed.checksum} !== ${expected}`)
      assert(checksum(echoed.bytes) === expected, 'returned checksum mismatch')
    })
  )

  await check('stop-stuck-kill', () =>
    withHost(smokeEchoProcess, async (host) => {
      assert((await host.request('ping', undefined)) === 'pong', 'ping before stall')
      const stalled = rejectionOf(host.request('stall', undefined))
      const errorsBefore = errorLogCount()
      await host.stop()
      assertIntentionalExit(await stalled, 'stall')
      assert(errorLogCount() === errorsBefore, 'stop logged an error')
      assert((await host.request('ping', undefined)) === 'pong', 'no respawn after a killed stop')
    })
  )

  // Electron's kill() is a no-op before `spawn`: the host must re-kill at spawn instead of connecting.
  await check('stop-before-spawn', () =>
    withHost(smokeEchoProcess, async (host) => {
      const waiting = rejectionOf(host.request('ping', undefined))
      const errorsBefore = errorLogCount()
      await host.stop()
      assertIntentionalExit(await waiting, 'cold-start stop')
      assert(errorLogCount() === errorsBefore, 'cold-start stop logged an error')
      assert((await host.request('ping', undefined)) === 'pong', 'no respawn after a cold-start stop')
    })
  )

  await check('crash-recovery', () =>
    withHost(smokeEchoProcess, async (host) => {
      const crashed = await rejectionOf(host.request('crash', undefined))
      assert(isUtilityProcessError(crashed, 'PROCESS_EXITED'), `crash gave ${String(crashed)}`)
      assert(crashed.exitCode !== 0, 'process.abort() reported a clean exit')
      assert((await host.request('ping', undefined)) === 'pong', 'no replacement after a crash')
    })
  )

  await check('stdio-log-relay', () =>
    withHost(smokeEchoProcess, async (host) => {
      const before = logger.entries.length
      assert((await host.request('logLines', 'relay')) === 'logged', 'logLines did not answer')
      const expected = ['smoke-stdout relay', 'smoke-stderr relay', 'smoke-log relay']
      await waitFor(
        () => expected.every((line) => logger.entries.slice(before).some((entry) => entry.message.includes(line))),
        `relayed lines ${expected.join(', ')}`
      )
    })
  )

  await check('net-proxy', async () => {
    const seen: string[] = []
    const proxy = http.createServer((request, response) => {
      seen.push(request.url ?? '')
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('utility-proxy-ok')
    })
    const port = await new Promise<number>((resolve, reject) => {
      proxy.once('error', reject)
      proxy.listen(0, '127.0.0.1', () => {
        const address = proxy.address()
        if (address === null || typeof address === 'string') reject(new Error('proxy has no TCP address'))
        else resolve(address.port)
      })
    })
    try {
      await app.setProxy({ mode: 'fixed_servers', proxyRules: `http=127.0.0.1:${port}` })
      const target = 'http://utility-process-smoke.invalid/proxied'
      await withHost(smokeEchoProcess, async (host) => {
        const result = await host.request('fetchThrough', target)
        assert(
          result.status === 200 && result.body === 'utility-proxy-ok',
          `unexpected response ${JSON.stringify(result)}`
        )
      })
      assert(seen.includes(target), `proxy saw ${JSON.stringify(seen)}`)
    } finally {
      await app.setProxy({ mode: 'direct' })
      await new Promise<void>((resolve) => proxy.close(() => resolve()))
    }
  })
}

app.setPath('userData', path.join(app.getPath('temp'), `cherry-utility-smoke-${process.pid}`))

void app.whenReady().then(async () => {
  app.dock?.hide()
  const watchdog = setTimeout(() => {
    record({ event: 'complete', result: 'fail', message: `watchdog fired after ${WATCHDOG_MS} ms` })
    app.exit(1)
  }, WATCHDOG_MS)
  watchdog.unref()
  record({ event: 'start', electron: process.versions.electron, appPath: app.getAppPath(), pid: process.pid })
  try {
    await runChecks()
  } catch (error) {
    failures += 1
    record({ event: 'error', message: error instanceof Error ? error.message : String(error) })
  }
  clearTimeout(watchdog)
  record({ event: 'complete', result: failures === 0 ? 'pass' : 'fail', failures })
  app.exit(failures === 0 ? 0 : 1)
})
