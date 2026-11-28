import { describe, expect, it, vi } from 'vitest'

import type { ClaudeCodeRuntime, ClaudeThreadHandle } from '@cherrystudio/agent-runtime-claude-code'
import type { AgentSessionWorkspaceEventRow } from '@data/db/schemas/agentSessionWorkspaceEvent'

import { openRebindSuccessor, type RebindResumeInput } from '../rebindResume'

function fakeHandle(name: string) {
  return { name, release: vi.fn(async () => undefined) } as unknown as ClaudeThreadHandle & {
    release: ReturnType<typeof vi.fn>
  }
}

function confirmed<T>(value: T) {
  return { status: 'confirmed' as const, value }
}

function storageMissing() {
  return {
    status: 'rejected' as const,
    error: { operation: 'open', code: 'native-storage-missing', message: 'no transcript under this project tree' }
  }
}

function createRejected() {
  return {
    status: 'rejected' as const,
    error: { operation: 'create', code: 'invalid-configuration', message: 'create failed' }
  }
}

function fakeEvent(overrides: Partial<AgentSessionWorkspaceEventRow> = {}): AgentSessionWorkspaceEventRow {
  return {
    id: 'event-1',
    sessionId: 'session-1',
    previousWorkspaceId: 'ws-a',
    previousWorkspacePath: '/projects/a',
    newWorkspaceId: 'ws-b',
    newWorkspacePath: '/projects/b',
    createdAt: 1000,
    surfacedAt: null,
    ...overrides
  }
}

interface HarnessOptions {
  event?: AgentSessionWorkspaceEventRow | null
  probeOpenResult?: unknown
  primaryCreateResult?: unknown
}

function harness(options: HarnessOptions = {}) {
  const probeHandle = fakeHandle('probe')
  const successorHandle = fakeHandle('successor')
  const probe = {
    open: vi.fn(async () => options.probeOpenResult ?? confirmed(probeHandle)),
    shutdown: vi.fn(async () => undefined)
  }
  const createRuntime = vi.fn(() => probe)
  const primaryRuntime = {
    create: vi.fn(async () => options.primaryCreateResult ?? confirmed(successorHandle))
  }
  const input: RebindResumeInput = {
    sessionId: 'session-1',
    resumeToken: 'native-session-1',
    backendId: 'backend-1',
    currentCwd: '/projects/b',
    primaryRuntime: primaryRuntime as unknown as ClaudeCodeRuntime,
    createConfig: { cwd: '/projects/b' },
    createRuntime: createRuntime as never,
    probeRuntimeOptions: (previousCwd: string) => ({ load: async () => ({ cwd: previousCwd }) }) as never,
    getLatestWorkspaceEvent: () => (options.event === undefined ? fakeEvent() : options.event)
  }
  return { input, probe, probeHandle, successorHandle, createRuntime, primaryRuntime }
}

describe('openRebindSuccessor', () => {
  it('stays fail-closed when no rebind is recorded', async () => {
    const { input, createRuntime, primaryRuntime } = harness({ event: null })

    await expect(openRebindSuccessor(input)).resolves.toBeUndefined()

    expect(createRuntime).not.toHaveBeenCalled()
    expect(primaryRuntime.create).not.toHaveBeenCalled()
  })

  it('stays fail-closed when the recorded event does not match the current cwd', async () => {
    const { input, createRuntime, primaryRuntime } = harness({
      event: fakeEvent({ newWorkspacePath: '/projects/unrelated' })
    })

    await expect(openRebindSuccessor(input)).resolves.toBeUndefined()

    expect(createRuntime).not.toHaveBeenCalled()
    expect(primaryRuntime.create).not.toHaveBeenCalled()
  })

  it('stays fail-closed when the original transcript is no longer accessible', async () => {
    const { input, probe, primaryRuntime } = harness({ probeOpenResult: storageMissing() })

    await expect(openRebindSuccessor(input)).resolves.toBeUndefined()

    expect(probe.open).toHaveBeenCalledTimes(1)
    expect(probe.shutdown).toHaveBeenCalledTimes(1)
    expect(primaryRuntime.create).not.toHaveBeenCalled()
  })

  it('creates a successor under the new cwd when the rebind is recorded and the transcript survives', async () => {
    const { input, probe, probeHandle, successorHandle, primaryRuntime } = harness()

    await expect(openRebindSuccessor(input)).resolves.toBe(successorHandle)

    expect(probeHandle.release).toHaveBeenCalledTimes(1)
    expect(probe.shutdown).toHaveBeenCalledTimes(1)
    expect(primaryRuntime.create).toHaveBeenCalledWith({ cwd: '/projects/b' })
  })

  it('propagates a successor-create failure instead of falling back silently', async () => {
    const { input } = harness({ primaryCreateResult: createRejected() })

    await expect(openRebindSuccessor(input)).rejects.toThrow('create failed')
  })
})
