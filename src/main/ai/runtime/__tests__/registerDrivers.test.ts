import { afterEach, describe, expect, it, vi } from 'vitest'

import { AGENT_RUNTIME_CAPABILITIES } from '@shared/ai/agentRuntimeCapabilities'
import type { AgentType } from '@shared/data/types/agent'

import * as claudeCode from '../claudeCode'
import { AgentSessionForkError, type RuntimeForkInput, type RuntimeForkResult } from '../forkCheckpoint'
import { registerRuntimeDrivers } from '../registerDrivers'
import { runtimeDriverRegistry } from '../registry'

describe('registerRuntimeDrivers', () => {
  afterEach(() => {
    runtimeDriverRegistry.clearForTest()
    vi.restoreAllMocks()
  })

  it('forwards native forks through the registered lazy Claude driver without opening a connection', async () => {
    const result: RuntimeForkResult = { resumeToken: 'child-native', checkpoints: [], publish: [] }
    const implementation = {
      type: 'claude-code',
      capabilities: ['agent-session'] as const,
      validateSession: vi.fn(),
      listAvailableTools: vi.fn(),
      connect: vi.fn(),
      fork: vi.fn().mockResolvedValue(result)
    }
    const load = vi.spyOn(claudeCode, 'createClaudeCodeRuntimeDriver').mockResolvedValue(implementation)
    registerRuntimeDrivers()
    expect(load).not.toHaveBeenCalled()
    const driver = runtimeDriverRegistry.getAgentSessionDriver('claude-code')!
    const checkpoint = {
      runtime: 'claude-code' as const,
      runtimeSessionId: 'source-native',
      messageUuid: '3804e4f9-80b1-4c2b-bd94-83e97d6c4269',
      configDir: '/config',
      sourceCwd: '/source',
      prefixBytes: 100,
      prefixHash: 'a'.repeat(64)
    }
    const input: RuntimeForkInput = {
      sourceSessionId: 'source',
      targetSessionId: 'child',
      targetCwd: '/child',
      artifactDirectory: '/owned',
      checkpoint,
      checkpoints: [checkpoint],
      signal: new AbortController().signal
    }
    expect(driver.fork).toBeTypeOf('function')
    await expect(driver.fork!(input)).resolves.toEqual(result)
    expect(implementation.fork).toHaveBeenCalledWith(input)
    expect(implementation.connect).not.toHaveBeenCalled()
    await expect(driver.fork!(input)).resolves.toEqual(result)
    expect(load).toHaveBeenCalledTimes(1)
    implementation.fork.mockRejectedValueOnce(new AgentSessionForkError('history_corrupt'))
    await expect(driver.fork!(input)).rejects.toMatchObject({ reason: 'history_corrupt' })
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(driver.fork!({ ...input, signal: controller.signal })).rejects.toThrow('cancelled')
    expect(implementation.fork).toHaveBeenCalledTimes(3)
  })

  // Guards the descriptor↔registry pairing: a merge that drops a driver
  // registration (as happened to pi in the barrel refactor) fails here
  // instead of at session-open time.
  it('registers an agent-session driver for every AgentType in AGENT_RUNTIME_CAPABILITIES', () => {
    registerRuntimeDrivers()
    const types = Object.keys(AGENT_RUNTIME_CAPABILITIES) as AgentType[]
    for (const type of types) {
      expect(runtimeDriverRegistry.getAgentSessionDriver(type), `missing driver for agent type "${type}"`).toBeDefined()
    }
  })
})
