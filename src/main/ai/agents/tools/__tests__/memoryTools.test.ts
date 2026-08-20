import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemoryToolContext } from '../memoryTools'

const mockGetAgent = vi.fn()
const mockAssertAgentDataDirectory = vi.fn()

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mockGetAgent } }))
vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  assertAgentDataDirectory: (...args: unknown[]) => mockAssertAgentDataDirectory(...args)
}))

const { memoryTool } = await import('../memoryTools')
const { ToolError, ToolErrorCode } = await import('../types')

let agentDataPath: string

function ctx(agentId = 'agent_1'): MemoryToolContext {
  return { agentId, agentDataPath }
}

const call = async (args: Record<string, unknown>, context = ctx()) => memoryTool.handler(args, context)

describe('memoryTool', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    agentDataPath = await mkdtemp(path.join(os.tmpdir(), 'memory-tool-'))
    await mkdir(path.join(agentDataPath, 'memory'))
    mockGetAgent.mockReturnValue({ id: 'agent_1' })
    mockAssertAgentDataDirectory.mockImplementation(async () => agentDataPath)
  })

  afterEach(async () => {
    await rm(agentDataPath, { recursive: true, force: true })
  })

  it('is named memory with an object schema', () => {
    expect(memoryTool.name).toBe('memory')
    expect((memoryTool.inputSchema as { type: string }).type).toBe('object')
  })

  it('updates FACT.md atomically', async () => {
    const result = await call({ action: 'update', content: '# Facts' })
    expect(await readFile(path.join(agentDataPath, 'memory', 'FACT.md'), 'utf-8')).toBe('# Facts')
    expect(result.content[0]).toMatchObject({ text: 'Memory updated.' })
  })

  it('throws when update content is missing', async () => {
    await expect(call({ action: 'update' })).rejects.toMatchObject({ code: ToolErrorCode.InvalidParams })
  })

  it('appends and searches journal entries', async () => {
    await call({ action: 'append', text: 'v1', tags: ['deploy'] })
    await call({ action: 'append', text: 'fix', tags: ['bug'] })
    await call({ action: 'append', text: 'v2', tags: ['deploy'] })

    const result = await call({ action: 'search', tag: 'deploy' })
    const parsed = JSON.parse((result.content[0] as { text: string }).text)
    expect(parsed.map((entry: { text: string }) => entry.text)).toEqual(['v2', 'v1'])
  })

  it('reports an absent journal', async () => {
    const result = await call({ action: 'search' })
    expect(result.content[0]).toMatchObject({ text: 'No journal entries found.' })
  })

  it('throws InternalError when the agent is gone', async () => {
    mockGetAgent.mockReturnValueOnce(null)
    await expect(call({ action: 'update', content: 'x' })).rejects.toMatchObject({
      code: ToolErrorCode.InternalError
    })
  })

  it('rejects an agent data path mismatch', async () => {
    mockAssertAgentDataDirectory.mockResolvedValueOnce(path.join(agentDataPath, 'other'))
    await expect(call({ action: 'update', content: 'x' })).rejects.toMatchObject({
      code: ToolErrorCode.InternalError
    })
  })

  it('throws on unknown action', async () => {
    await expect(call({ action: 'nope' })).rejects.toBeInstanceOf(ToolError)
  })
})
