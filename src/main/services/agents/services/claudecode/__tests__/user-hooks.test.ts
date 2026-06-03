// src/main/services/agents/services/claudecode/__tests__/user-hooks.test.ts
import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

import { loadUserHooks, mergeHooks } from '../user-hooks'

// ─── Mocks ───

// Mock fs.readFile to control settings file loading
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn()
  }
}))

// Mock child_process.spawn for command hook tests
vi.mock('node:child_process', () => ({
  spawn: vi.fn()
}))

// Mock electron app.getPath
vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return '/mock/userData'
      return '/mock/unknown'
    })
  }
}))

// Mock os.homedir
vi.mock('node:os', () => ({
  default: {
    homedir: vi.fn(() => '/mock/home')
  }
}))

// ─── Imports after mocks ───

import fs from 'node:fs/promises'
import { spawn } from 'node:child_process'

const mockReadFile = vi.mocked(fs.readFile)
const mockSpawn = vi.mocked(spawn)

// ─── Helpers ───

function createMockChildProcess() {
  const child = new EventEmitter() as any
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { write: vi.fn(), end: vi.fn() }
  child.kill = vi.fn()
  return child
}

function createHookInput(overrides?: Partial<{ hook_event_name: string; cwd: string; session_id: string; tool_name: string }>) {
  return {
    hook_event_name: 'PreToolUse' as const,
    cwd: '/mock/project',
    session_id: 'test-session',
    tool_name: 'Read',
    ...overrides
  }
}

// ─── Tests: mergeHooks ───

describe('mergeHooks', () => {
  it('returns systemHooks when userHooks is undefined', () => {
    const system = { PreToolUse: [{ matcher: undefined, hooks: [vi.fn()] }] }
    expect(mergeHooks(system, undefined)).toBe(system)
  })

  it('returns systemHooks when userHooks is empty', () => {
    const system = { PreToolUse: [{ matcher: undefined, hooks: [vi.fn()] }] }
    expect(mergeHooks(system, {})).toBe(system)
  })

  it('merges user hooks after system hooks for the same event', () => {
    const systemHook = vi.fn()
    const userHook = vi.fn()
    const system = { PreToolUse: [{ matcher: undefined, hooks: [systemHook] }] }
    const user = { PreToolUse: [{ matcher: undefined, hooks: [userHook] }] }

    const result = mergeHooks(system, user)
    expect(result.PreToolUse).toHaveLength(2)
    expect(result.PreToolUse![0].hooks[0]).toBe(systemHook)
    expect(result.PreToolUse![1].hooks[0]).toBe(userHook)
  })

  it('handles disjoint events', () => {
    const systemHook = vi.fn()
    const userHook = vi.fn()
    const system = { PreToolUse: [{ matcher: undefined, hooks: [systemHook] }] }
    const user = { Stop: [{ matcher: undefined, hooks: [userHook] }] }

    const result = mergeHooks(system, user)
    expect(result.PreToolUse).toHaveLength(1)
    expect(result.Stop).toHaveLength(1)
  })
})

// ─── Tests: loadUserHooks ───

describe('loadUserHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns undefined when all settings files are missing', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await loadUserHooks('/mock/project')
    expect(result).toBeUndefined()
  })

  it('loads hooks from project-level settings.json', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'prompt', prompt: 'check file' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await loadUserHooks('/mock/project')
    expect(result).toBeDefined()
    expect(result!.PreToolUse).toHaveLength(1)
  })

  it('loads hooks from user-level settings.json', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/home/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PostToolUse: [{ matcher: undefined, hooks: [{ type: 'prompt', prompt: 'post check' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await loadUserHooks('/mock/project')
    expect(result).toBeDefined()
    expect(result!.PostToolUse).toHaveLength(1)
  })

  it('handles malformed JSON gracefully', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return '{ invalid json }}}'
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await loadUserHooks('/mock/project')
    expect(result).toBeUndefined()
  })

  it('handles both matcher-wrapper and native prompt-based entry formats', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [
              // PR-style matcher wrapper
              { matcher: 'Read', hooks: [{ type: 'command', command: 'echo check' }] },
              // Native prompt-based
              { type: 'prompt', tool: 'Write', prompt: 'validate write' }
            ]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await loadUserHooks('/mock/project')
    expect(result).toBeDefined()
    // Both entries should be converted to HookCallbackMatcher format
    expect(result!.PreToolUse).toHaveLength(2)
  })
})

// ─── Tests: command hook callback ───

describe('command hook callback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects commands with dangerous shell characters', async () => {
    // Load a command hook with an unsafe command
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: undefined, hooks: [{ type: 'command', command: 'echo hello; rm -rf /' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const result = await loadUserHooks('/mock/project')
    expect(result).toBeDefined()

    // Invoke the hook callback
    const hookFn = result!.PreToolUse![0].hooks[0]
    const hookResult = await hookFn(createHookInput(), undefined, { signal: AbortSignal.timeout(5000) } as any)

    // Should return empty object (command was rejected)
    expect(hookResult).toEqual({})
    // spawn should NOT have been called
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('resolves with additionalContext from stdout', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: undefined, hooks: [{ type: 'command', command: 'echo hello' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const child = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const result = await loadUserHooks('/mock/project')
    const hookFn = result!.PreToolUse![0].hooks[0]

    const hookPromise = hookFn(createHookInput(), undefined, { signal: AbortSignal.timeout(5000) } as any)

    // Simulate stdout output
    child.stdout.emit('data', Buffer.from('hello from hook'))
    child.emit('close', 0)

    const hookResult = await hookPromise
    expect(hookResult).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext: 'hello from hook'
      }
    })
  })

  it('resolves with empty object on spawn error', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: undefined, hooks: [{ type: 'command', command: 'nonexistent' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const child = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const result = await loadUserHooks('/mock/project')
    const hookFn = result!.PreToolUse![0].hooks[0]

    const hookPromise = hookFn(createHookInput(), undefined, { signal: AbortSignal.timeout(5000) } as any)

    // Simulate spawn error
    child.emit('error', new Error('ENOENT'))

    const hookResult = await hookPromise
    expect(hookResult).toEqual({})
  })

  it('resolves with empty object when stdout is empty', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: undefined, hooks: [{ type: 'command', command: 'true' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const child = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const result = await loadUserHooks('/mock/project')
    const hookFn = result!.PreToolUse![0].hooks[0]

    const hookPromise = hookFn(createHookInput(), undefined, { signal: AbortSignal.timeout(5000) } as any)

    // No stdout, just close
    child.emit('close', 0)

    const hookResult = await hookPromise
    expect(hookResult).toEqual({})
  })

  it('AbortSignal abort resolves with empty object', async () => {
    mockReadFile.mockImplementation(async (p: string) => {
      if (p.includes('/mock/project/.claude/settings.json')) {
        return JSON.stringify({
          hooks: {
            PreToolUse: [{ matcher: undefined, hooks: [{ type: 'command', command: 'sleep 10' }] }]
          }
        })
      }
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    })

    const child = createMockChildProcess()
    mockSpawn.mockReturnValue(child)

    const result = await loadUserHooks('/mock/project')
    const hookFn = result!.PreToolUse![0].hooks[0]

    const ac = new AbortController()
    const hookPromise = hookFn(createHookInput(), undefined, { signal: ac.signal } as any)

    // Abort the signal
    ac.abort()

    const hookResult = await hookPromise
    expect(hookResult).toEqual({})
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})
