/**
 * Drives ProcessHost + the real Electron adapter inside a real Electron main process.
 * It deliberately does not boot the lifecycle container: everything that needs a real
 * utility process lives in host/ and runtime/, and the container would drag winston,
 * BootConfig and quit handlers into a throwaway app.
 */

import http from 'node:http'
import path from 'node:path'

import { app } from 'electron'

import { electronProcessAdapter } from '../../../src/main/core/utilityProcess/host/electronProcessAdapter'
import { ProcessHost } from '../../../src/main/core/utilityProcess/host/ProcessHost'
import {
  isUtilityProcessError,
  type UtilityProcessErrorCode
} from '../../../src/main/core/utilityProcess/UtilityProcessError'
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

function assertCode(error: unknown, code: UtilityProcessErrorCode): void {
  assert(
    isUtilityProcessError(error, code),
    `expected ${code}, got ${error instanceof Error ? error.message : String(error)}`
  )
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
  try {
    await promise
    throw new Error('expected a rejection')
  } catch (error) {
    return error
  }
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
  await check('request-event', () =>
    withHost(smokeEchoProcess, async (host) => {
      const events: number[] = []
      assert((await host.request('ping', undefined)) === 'pong', 'ping did not answer pong')
      const result = await host.request('stream', 3, { onEvent: (event) => events.push(event) })
      assert(result === 'done', `stream returned ${result}`)
      assert(events.join(',') === '1,2,3', `events were ${events.join(',')}`)
    })
  )

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

  await check('cooperative-cancel', () =>
    withHost(smokeEchoProcess, async (host) => {
      await host.request('ping', undefined)
      const controller = new AbortController()
      const reason = new Error('cancelled by smoke')
      const pending = rejectionOf(host.request('stall', undefined, { signal: controller.signal }))
      controller.abort(reason)
      assert((await pending) === reason, 'cooperative cancel did not rethrow the caller reason')
      assert((await host.request('ping', undefined)) === 'pong', 'generation did not survive a cooperative cancel')
    })
  )

  await check('terminate-cancel', () =>
    withHost(smokeTerminateProcess, async (host) => {
      await host.request('ping', undefined)
      const controller = new AbortController()
      const reason = new Error('terminated by smoke')
      const cancelled = rejectionOf(host.request('stall', undefined, { signal: controller.signal }))
      const bystander = rejectionOf(host.request('stall', undefined))
      controller.abort(reason)
      assert((await cancelled) === reason, 'terminate cancel did not rethrow the caller reason')
      assertCode(await bystander, 'PROCESS_EXITED')
      assert((await host.request('ping', undefined)) === 'pong', 'no replacement generation after terminate')
    })
  )

  await check('stop-dispose', () =>
    withHost(smokeEchoProcess, async (host) => {
      await host.request('ping', undefined)
      await host.stop()
      await waitFor(() => logger.messages.some((message) => message.includes('disposed')), 'child dispose log')
      assert((await host.request('ping', undefined)) === 'pong', 'no respawn after stop')
    })
  )

  await check('stop-stuck-kill', () =>
    withHost(smokeEchoProcess, async (host) => {
      const stalled = rejectionOf(host.request('stall', undefined))
      await host.stop()
      await stalled
      assert((await host.request('ping', undefined)) === 'pong', 'no respawn after a killed stop')
    })
  )

  await check('crash-recovery', () =>
    withHost(smokeEchoProcess, async (host) => {
      const crashed = await rejectionOf(host.request('crash', undefined))
      assertCode(crashed, 'PROCESS_EXITED')
      assert(isUtilityProcessError(crashed) && crashed.exitCode !== 0, 'process.abort() reported a clean exit')
      assert((await host.request('ping', undefined)) === 'pong', 'no replacement after a crash')
    })
  )

  await check('breaker-reset', () =>
    withHost(smokeEchoProcess, async (host) => {
      for (let round = 0; round < 3; round += 1) {
        assertCode(await rejectionOf(host.request('exitNow', 4)), 'PROCESS_EXITED')
      }
      assertCode(await rejectionOf(host.request('ping', undefined)), 'PROCESS_CIRCUIT_OPEN')
      await host.stop({ resetFailures: true })
      assert((await host.request('ping', undefined)) === 'pong', 'circuit did not reopen after a resetting stop')
    })
  )

  await check('stdio-log-relay', () =>
    withHost(smokeEchoProcess, async (host) => {
      const before = logger.messages.length
      assert((await host.request('logLines', 'relay')) === 'logged', 'logLines did not answer')
      const expected = ['smoke-stdout relay', 'smoke-stderr relay', 'smoke-log relay']
      await waitFor(
        () => expected.every((line) => logger.messages.slice(before).some((message) => message.includes(line))),
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
