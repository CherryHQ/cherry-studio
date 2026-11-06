import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { vi } from 'vitest'

import type { ExternalAppRequest, ExternalProcess, ExternalSnapshot } from '../externalAppDriver'

const { native } = vi.hoisted(() => ({ native: vi.fn() }))
vi.mock('../externalAppDriver', () => ({ externalAppRequest: native }))

import { cleanupExternalResources, observeExternalResource, registerExternalResource } from '../externalResources'
import { getRunPaths, type RunPaths } from '../paths'

let paths: RunPaths
let desktop: ExternalSnapshot
let stalled: boolean
const application: ExternalProcess = { pid: 100, startedAt: 'first', application: 'Preview', shared: false }
const childProcesses: ChildProcess[] = []
const target = () => ({
  kind: 'document' as const,
  application: 'Preview' as const,
  path: join(paths.evidence, 'test.pdf')
})
const ledger = () => JSON.parse(readFileSync(join(paths.private, 'external-resources.json'), 'utf8')) as unknown[]

beforeEach(() => {
  paths = getRunPaths(mkdtempSync(join(tmpdir(), 'cherry-external-cleanup-')))
  desktop = { processes: [], windows: [] }
  stalled = false
  native.mockReset().mockImplementation((_platform, request: ExternalAppRequest) => {
    if (request.action === 'close' && !stalled)
      desktop.windows = desktop.windows.filter(({ id }) => id !== request.window?.id)
    if (request.action === 'force' || (request.action === 'quit' && !stalled)) {
      desktop.processes = desktop.processes.filter(
        ({ pid, startedAt }) => pid !== request.process?.pid || startedAt !== request.process?.startedAt
      )
      desktop.windows = desktop.windows.filter(({ pid }) => pid !== request.process?.pid)
    }
    return structuredClone(desktop)
  })
})

afterEach(async () => {
  for (const child of childProcesses.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
    }
  }
  rmSync(paths.root, { recursive: true, force: true })
})

function opened() {
  desktop = { processes: [application], windows: [{ id: 'owned', pid: application.pid, matches: true }] }
}

it('closes a registered test document, exits its new application and removes its private record', () => {
  const id = registerExternalResource(paths, 'macos', target())
  opened()
  observeExternalResource(paths, id)
  cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
  if (process.platform !== 'win32')
    expect(statSync(join(paths.private, 'external-resources.json')).mode & 0o777).toBe(0o600)
})

it('preserves an already running application and all its unrelated documents', () => {
  desktop = { processes: [application], windows: [{ id: 'user', pid: application.pid, matches: false }] }
  const id = registerExternalResource(paths, 'macos', target())
  desktop.windows.push({ id: 'owned', pid: application.pid, matches: true })
  observeExternalResource(paths, id)
  cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [application], windows: [{ id: 'user', pid: application.pid, matches: false }] })
  expect(ledger()).toEqual([])
})

it('does not close an existing document even when it matches the target', () => {
  opened()
  registerExternalResource(paths, 'macos', target())
  cleanupExternalResources(paths)
  expect(desktop.windows).toEqual([{ id: 'owned', pid: application.pid, matches: true }])
  expect(desktop.processes).toEqual([application])
})

it('cleans the browser chosen at launch even if the system default changes afterward', () => {
  const driver = native.getMockImplementation()!
  let defaultBrowser = 'Safari'
  native.mockImplementation((platform, request: ExternalAppRequest) => {
    const selected = request.target.kind === 'browser' ? request.target.application || defaultBrowser : ''
    if (selected !== 'Safari') return { processes: [], windows: [], browserApplication: selected }
    return { ...driver(platform, request), browserApplication: selected }
  })
  const id = registerExternalResource(paths, 'macos', { kind: 'browser', title: 'owned title' })
  opened()
  observeExternalResource(paths, id)
  defaultBrowser = 'Chrome'
  cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
})

it('closes owned content but refuses to quit a new application that gained unrelated content', () => {
  const id = registerExternalResource(paths, 'macos', target())
  opened()
  observeExternalResource(paths, id)
  desktop.windows.push({ id: 'user', pid: application.pid, matches: false })
  expect(() => cleanupExternalResources(paths)).toThrow('External application cleanup failed')
  expect(desktop).toEqual({ processes: [application], windows: [{ id: 'user', pid: application.pid, matches: false }] })
  expect(ledger()).toHaveLength(1)
  desktop.windows = []
  cleanupExternalResources(paths)
  expect(desktop.processes).toEqual([])
})

it('preserves a recorded terminal window that gained an unrelated tab and retries only after ownership returns', () => {
  const id = registerExternalResource(paths, 'macos', { kind: 'terminal', directory: paths.workspace })
  opened()
  observeExternalResource(paths, id)
  desktop.windows[0].matches = false
  const unrelatedContent = structuredClone(desktop)

  expect(() => cleanupExternalResources(paths)).toThrow('unrelated content; refusing to close')
  expect(desktop).toEqual(unrelatedContent)
  expect(ledger()).toHaveLength(1)

  desktop.windows[0].matches = true
  cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
})

it('recovers a registered launch even when the executor never observed its result', () => {
  registerExternalResource(paths, 'macos', target())
  opened()
  cleanupExternalResources(paths)
  cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
})

it('preserves a replacement process with a reused PID', () => {
  const id = registerExternalResource(paths, 'macos', target())
  opened()
  observeExternalResource(paths, id)
  const replacement = { ...application, startedAt: 'replacement' }
  desktop = { processes: [replacement], windows: [] }
  cleanupExternalResources(paths)
  expect(desktop.processes).toEqual([replacement])
})

it('does not acquire a new windowless process without target evidence', () => {
  const id = registerExternalResource(paths, 'macos', target())
  desktop = { processes: [application], windows: [] }
  observeExternalResource(paths, id)

  cleanupExternalResources(paths)

  expect(desktop).toEqual({ processes: [application], windows: [] })
  expect(ledger()).toEqual([])
})

it('still cleans an acquired process after its verified window has closed', () => {
  const id = registerExternalResource(paths, 'macos', target())
  opened()
  observeExternalResource(paths, id)
  desktop.windows = []

  cleanupExternalResources(paths)

  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
})

it('never quits the shared file manager', () => {
  const id = registerExternalResource(paths, 'windows', { kind: 'folder', path: join(paths.evidence, 'test.pdf') })
  opened()
  desktop.processes = [{ ...application, application: 'explorer.exe', shared: true }]
  observeExternalResource(paths, id)
  cleanupExternalResources(paths)
  expect(desktop.windows).toEqual([])
  expect(desktop.processes).toEqual([{ ...application, application: 'explorer.exe', shared: true }])
})

it('continues independent cleanup and persists failures for a later executor', async () => {
  const driver = native.getMockImplementation()!
  const scoped = (platform: unknown, request: ExternalAppRequest) => {
    const snapshot = driver(platform, request) as ExternalSnapshot
    return {
      ...snapshot,
      windows: snapshot.windows.map((window) => ({
        ...window,
        matches:
          window.id ===
          (request.target.kind === 'document' && request.target.path.endsWith('second.pdf') ? 'second' : 'owned')
      }))
    }
  }
  native.mockImplementation(scoped)
  const first = registerExternalResource(paths, 'macos', target())
  opened()
  observeExternalResource(paths, first)
  const second = registerExternalResource(paths, 'macos', { ...target(), path: join(paths.evidence, 'second.pdf') })
  desktop.windows.push({ id: 'second', pid: application.pid, matches: true })
  observeExternalResource(paths, second)
  native.mockImplementation((platform, request: ExternalAppRequest) => {
    if (request.action === 'close' && request.window?.id === 'second') throw new Error('Automation denied')
    return scoped(platform, request)
  })
  expect(() => cleanupExternalResources(paths)).toThrow('External application cleanup failed')
  expect(desktop.windows).toEqual([{ id: 'second', pid: application.pid, matches: true }])
  expect(ledger()).toHaveLength(2)
  native.mockImplementation(scoped)
  vi.resetModules()
  const retry = await import('../externalResources')
  retry.cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
})

it('force-terminates a real owned process when a graceful request leaves it running', async () => {
  const child = spawn(
    process.execPath,
    ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready')"],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )
  childProcesses.push(child)
  await once(child.stdout, 'data')
  const id = registerExternalResource(paths, 'macos', target())
  const owned = { ...application, pid: child.pid! }
  desktop = { processes: [owned], windows: [{ id: 'owned', pid: owned.pid, matches: true }] }
  observeExternalResource(paths, id)
  desktop.windows = []
  native.mockImplementation((_platform, request: ExternalAppRequest) => {
    if (request.action === 'quit') child.kill('SIGTERM')
    if (request.action === 'force') {
      process.kill(child.pid!, 'SIGKILL')
      desktop.processes = []
    }
    return structuredClone(desktop)
  })
  const exited = once(child, 'exit')
  cleanupExternalResources(paths)
  await exited
  expect(child.signalCode).toBe('SIGKILL')
  expect(ledger()).toEqual([])
})

it('forces a stalled owned application only after preserving its process identity', () => {
  const id = registerExternalResource(paths, 'macos', target())
  opened()
  observeExternalResource(paths, id)
  stalled = true
  cleanupExternalResources(paths)
  expect(desktop).toEqual({ processes: [], windows: [] })
  expect(ledger()).toEqual([])
})
