import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

import type { TaskSelection } from './cases'
import type { RunPaths } from './paths'
import { findListeningPid, isAlive, processCommand, terminateExactProcess, waitForExit } from './process'
import { readRun, updateRunMetadata, writeRun } from './state'
import type { Platform } from './types'

const require = createRequire(import.meta.url)
export const AIMOCK_VERSION: string = JSON.parse(
  readFileSync(join(dirname(require.resolve('@copilotkit/aimock')), '..', 'package.json'), 'utf8')
).version
const worker = fileURLToPath(new URL('./mockWorker.ts', import.meta.url))
const supportedTasks: TaskSelection[] = [
  'startup-smoke',
  'mini-app-smoke',
  'notes-smoke',
  'custom-provider-chat',
  'provider-model-scroll',
  'custom-assistant',
  'chat-stream-failure',
  'translation-smoke',
  'translation-settings',
  'quick-assistant'
]

export interface MockRecord {
  pid: number
  token: string
  port: number
  version: string
  platform: Platform
}

export function assertMockTask(task: TaskSelection): void {
  if (!supportedTasks.includes(task)) throw new Error(`Task ${task} requires provider_mode=real`)
}

export function readMockRecord(paths: RunPaths): MockRecord {
  return JSON.parse(readFileSync(join(paths.root, 'mock.json'), 'utf8'))
}

function assertWorker(record: MockRecord): void {
  const command = processCommand(record.pid, record.platform)
  if (!command.includes(worker) || !command.includes(record.token)) {
    throw new Error(`Refusing to control unowned mock PID ${record.pid}`)
  }
}

export async function verifyMockProvider(paths: RunPaths): Promise<MockRecord> {
  const record = readMockRecord(paths)
  assertWorker(record)
  if (record.version !== AIMOCK_VERSION || findListeningPid(record.platform, record.port) !== record.pid) {
    throw new Error('Mock provider version or listener does not match its ownership record')
  }
  const response = await fetch(`http://127.0.0.1:${record.port}/__cherry_mock`, {
    headers: { Authorization: `Bearer ${record.token}` },
    signal: AbortSignal.timeout(2_000)
  })
  if (!response.ok) throw new Error('Mock provider health check failed')
  const identity = await response.json()
  if (identity.pid !== record.pid || identity.token !== record.token) throw new Error('Mock provider identity mismatch')
  return record
}

export async function startMockProvider(paths: RunPaths): Promise<MockRecord> {
  const run = readRun(paths.runState)
  if (run.metadata.providerMode !== 'mock') throw new Error('mock-start requires an initialized mock run')
  assertMockTask(run.metadata.task)
  if (existsSync(join(paths.root, 'mock.json'))) {
    const previous = readMockRecord(paths)
    if (isAlive(previous.pid)) {
      const record = await verifyMockProvider(paths)
      writeRun(paths.runState, updateRunMetadata(run, { mockVersion: record.version }))
      return record
    }
    rmSync(join(paths.root, 'mock.json'))
  }
  const token = randomUUID()
  const log = openSync(join(paths.logs, 'aimock.log'), 'a', 0o600)
  const child = spawn(
    process.execPath,
    ['--import', pathToFileURL(require.resolve('tsx')).href, worker, paths.root, token],
    {
      detached: true,
      stdio: ['ignore', log, log]
    }
  )
  closeSync(log)
  let spawnError: Error | undefined
  child.on('error', (error) => {
    spawnError = error
  })
  child.unref()
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode) throw new Error(`Mock worker exited; see aimock.log`)
      if (existsSync(join(paths.root, 'mock.json'))) {
        const record = await verifyMockProvider(paths)
        writeRun(paths.runState, updateRunMetadata(readRun(paths.runState), { mockVersion: record.version }))
        return record
      }
      await setTimeout(100)
    }
    throw new Error('Mock provider startup timed out; see aimock.log')
  } catch (error) {
    if (child.pid && isAlive(child.pid)) {
      assertWorker({ pid: child.pid, token, platform: run.metadata.platform, port: 0, version: AIMOCK_VERSION })
      terminateExactProcess(child.pid, run.metadata.platform)
    }
    throw error
  }
}

export async function stopMockProvider(paths: RunPaths): Promise<void> {
  const file = join(paths.root, 'mock.json')
  if (!existsSync(file)) return
  const record = readMockRecord(paths)
  if (isAlive(record.pid)) {
    assertWorker(record)
    if (findListeningPid(record.platform, record.port) === record.pid) {
      await fetch(`http://127.0.0.1:${record.port}/__cherry_mock`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${record.token}` },
        signal: AbortSignal.timeout(2_000)
      }).catch(() => undefined)
    } else {
      terminateExactProcess(record.pid, record.platform)
    }
    if (!(await waitForExit(record.pid, 5_000))) {
      assertWorker(record)
      if (record.platform === 'windows') terminateExactProcess(record.pid, record.platform)
      else process.kill(record.pid, 'SIGKILL')
      if (!(await waitForExit(record.pid))) throw new Error(`Mock PID ${record.pid} did not stop`)
    }
  }
  rmSync(file, { force: true })
}
