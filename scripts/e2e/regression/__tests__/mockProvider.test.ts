import { execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createConnection } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, vi } from 'vitest'

import {
  AIMOCK_VERSION,
  assertMockTask,
  readMockRecord,
  startMockProvider,
  stopMockProvider,
  verifyMockProvider
} from '../mockProvider'
import { ensureRunDirectories, getRunPaths } from '../paths'
import { findListeningPid, isAlive } from '../process'
import { createRun, readRun, writeRun } from '../state'

let paths: ReturnType<typeof getRunPaths>
beforeEach(() => {
  paths = getRunPaths(mkdtempSync(join(tmpdir(), 'cherry-aimock-')))
  ensureRunDirectories(paths)
  writeRun(
    paths.runState,
    createRun({
      appVersion: 'test',
      commitSha: 'test',
      mode: 'branch',
      platform: process.platform === 'win32' ? 'windows' : 'macos',
      ref: 'test',
      runner: 'local',
      task: 'translation-settings',
      providerMode: 'mock'
    })
  )
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await stopMockProvider(paths)
  rmSync(paths.root, { recursive: true, force: true })
})

it('reuses its healthy worker, rejects unmatched prompts, and releases the owned process and port', async () => {
  const record = await startMockProvider(paths)
  expect((await startMockProvider(paths)).pid).toBe(record.pid)
  expect((await verifyMockProvider(paths)).version).toBe(AIMOCK_VERSION)
  expect(readRun(paths.runState).metadata.mockVersion).toBe(AIMOCK_VERSION)
  const response = await fetch(`http://127.0.0.1:${record.port}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'mock-chat', messages: [{ role: 'user', content: 'UNMATCHED_MARKER_987' }] })
  })
  expect(response.status).toBe(503)
  await response.text()
  await stopMockProvider(paths)
  expect(isAlive(record.pid)).toBe(false)
  expect(findListeningPid(record.platform, record.port)).toBeUndefined()
  expect(JSON.parse(readFileSync(join(paths.logs, 'aimock-summary.json'), 'utf8'))).toMatchObject({
    requests: 1,
    unmatched: 1
  })
  await stopMockProvider(paths)
})

it('refuses a stale PID identity and never terminates the process named by a forged record', async () => {
  const record = await startMockProvider(paths)
  writeFileSync(join(paths.root, 'mock.json'), JSON.stringify({ ...record, pid: process.pid }))
  try {
    await expect(stopMockProvider(paths)).rejects.toThrow('unowned mock PID')
    expect(isAlive(process.pid)).toBe(true)
    expect(isAlive(record.pid)).toBe(true)
  } finally {
    writeFileSync(join(paths.root, 'mock.json'), JSON.stringify(record))
  }
})

it('restarts an exited owned worker and keeps its evidence', async () => {
  const original = await startMockProvider(paths)
  await stopMockProvider(paths)
  writeFileSync(join(paths.root, 'mock.json'), JSON.stringify(original))
  const replacement = await startMockProvider(paths)
  expect(replacement.pid).not.toBe(original.pid)
  expect(readMockRecord(paths)).toEqual(replacement)
  await expect(verifyMockProvider(paths)).resolves.toEqual(replacement)
})

it('reports an early worker exit instead of polling until readiness timeout', async () => {
  vi.stubEnv('NODE_OPTIONS', '--cherry-invalid-node-option')
  await expect(startMockProvider(paths)).rejects.toThrow('Mock worker exited')
  expect(readFileSync(join(paths.logs, 'aimock.log'), 'utf8')).toContain('--cherry-invalid-node-option')
})

it('releases the owned worker even when an unfinished HTTP request blocks graceful shutdown', async () => {
  const record = await startMockProvider(paths)
  const socket = createConnection(record.port, '127.0.0.1')
  socket.on('error', () => undefined)
  try {
    await once(socket, 'connect')
    socket.write('POST /v1/chat/completions HTTP/1.1\r\nHost: localhost\r\nContent-Length: 100\r\n\r\n{')
    await stopMockProvider(paths)
    expect(isAlive(record.pid)).toBe(false)
    expect(findListeningPid(record.platform, record.port)).toBeUndefined()
  } finally {
    socket.destroy()
  }
})

it('still stops the mock when application cleanup fails, while retaining the cleanup failure', async () => {
  const record = await startMockProvider(paths)
  writeFileSync(paths.appRecord, 'invalid application ownership record')
  const error = await new Promise<Error | null>((resolve) => {
    execFile(
      process.execPath,
      [
        createRequire(import.meta.url).resolve('tsx/cli'),
        'scripts/e2e/regression/cli.ts',
        'cleanup',
        '--run-dir',
        paths.root
      ],
      { timeout: 20_000 },
      (error) => resolve(error)
    )
  })
  expect(error?.message).toContain('SyntaxError')
  expect(isAlive(record.pid)).toBe(false)
  expect(findListeningPid(record.platform, record.port)).toBeUndefined()
})

it('refuses unsupported knowledge and whole-suite mock acceptance before launching', () => {
  for (const task of ['knowledge', 'knowledge-smoke', 'notes', 'translation', 'mini-app', 'all'] as const)
    expect(() => assertMockTask(task)).toThrow('provider_mode=real')
})
