import { vi } from 'vitest'

import type { ExternalAppRequest, ExternalSnapshot } from '../externalAppDriver'

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }))
vi.mock('node:child_process', () => ({ execFileSync: execute }))

import { externalAppRequest } from '../externalAppDriver'

const process = { pid: 123, startedAt: 'original', application: 'Safari', shared: false }
const target = { kind: 'browser' as const, title: 'run-owned unique title' }
const root = '/test/run'
const privateTab = '123:original:https://private.invalid/?token=synthetic-private-value'
let desktop: ExternalSnapshot

beforeEach(() => {
  desktop = {
    processes: [process],
    windows: [
      { id: privateTab, pid: process.pid, matches: false },
      { id: '123:original:owned-tab', pid: process.pid, matches: true }
    ]
  }
  execute.mockReset().mockImplementation((_command, args) => {
    const request = JSON.parse(args.at(-1)) as ExternalAppRequest
    if (request.action === 'close') desktop.windows = desktop.windows.filter(({ id }) => id !== request.window?.id)
    return JSON.stringify(desktop)
  })
})

it('keeps browser URLs and their credentials out of persisted resource identifiers', () => {
  const snapshot = externalAppRequest('macos', { action: 'inspect', target, root })
  expect(JSON.stringify(snapshot)).not.toContain('synthetic-private-value')
  expect(JSON.stringify(snapshot)).not.toContain('https://')
  expect(snapshot.windows.map(({ matches }) => matches)).toEqual([false, true])
})

it('resolves an opaque owned identifier back to exactly one native tab without closing other tabs', () => {
  const snapshot = externalAppRequest('macos', { action: 'inspect', target, root })
  const window = snapshot.windows.find(({ matches }) => matches)!
  const result = externalAppRequest('macos', { action: 'close', target, root, process, window })
  expect(desktop.windows).toEqual([{ id: privateTab, pid: process.pid, matches: false }])
  expect(result.windows.map(({ id }) => id)).toEqual([snapshot.windows[0].id])
})

it('treats a vanished native handle as closed instead of acting on a replacement tab', () => {
  const snapshot = externalAppRequest('macos', { action: 'inspect', target, root })
  const window = snapshot.windows.find(({ matches }) => matches)!
  desktop.windows = [{ id: '123:replacement:owned-tab', pid: process.pid, matches: false }]
  externalAppRequest('macos', { action: 'close', target, root, process, window })
  expect(desktop.windows).toEqual([{ id: '123:replacement:owned-tab', pid: process.pid, matches: false }])
})

it.each(['close', 'quit', 'force'] as const)(
  'refuses %s when a recorded window now contains unrelated content',
  (action) => {
    desktop.windows = desktop.windows.filter(({ matches }) => matches)
    const snapshot = externalAppRequest('macos', { action: 'inspect', target, root })
    const window = snapshot.windows[0]
    desktop.windows[0].matches = false
    const unrelatedContent = structuredClone(desktop)

    expect(() => externalAppRequest('macos', { action, target, root, process, window, owned: [window.id] })).toThrow(
      'unrelated'
    )
    expect(desktop).toEqual(unrelatedContent)
  }
)

it('reports native failure details without echoing the subprocess command or its arguments', () => {
  execute.mockImplementation(() => {
    throw Object.assign(new Error('Command failed: synthetic-private-command'), { stderr: 'Automation denied' })
  })
  expect(() => externalAppRequest('macos', { action: 'inspect', target, root })).toThrow('Automation denied')
  try {
    externalAppRequest('macos', { action: 'inspect', target, root })
  } catch (error) {
    expect(String(error)).not.toContain('synthetic-private-command')
  }
})

it.each(['Cannot get object. (-1728)', 'External window identity is ambiguous'])(
  're-reads transient macOS inspection errors: %s',
  (message) => {
    execute.mockImplementationOnce(() => {
      desktop.windows = [{ id: 'replacement', pid: process.pid, matches: false }]
      throw Object.assign(new Error('Object disappeared'), { stderr: message })
    })
    const snapshot = externalAppRequest('macos', { action: 'inspect', target, root })
    expect(snapshot.windows).toEqual([{ id: expect.any(String), pid: process.pid, matches: false }])
  }
)

it('does not retry permission failures as if the desktop were empty', () => {
  execute.mockImplementationOnce(() => {
    throw Object.assign(new Error('Denied'), { stderr: 'Not authorized. (-1743)' })
  })
  expect(() => externalAppRequest('macos', { action: 'inspect', target, root })).toThrow('Not authorized')
})

it.each(['Cannot get object. (-1728)', 'External window identity is ambiguous'])(
  'surfaces persistent macOS inspection errors: %s',
  (message) => {
    execute.mockImplementation(() => {
      throw Object.assign(new Error('Object disappeared'), { stderr: message })
    })
    expect(() => externalAppRequest('macos', { action: 'inspect', target, root })).toThrow(message)
  }
)
