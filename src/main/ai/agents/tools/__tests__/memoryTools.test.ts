import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { MemoryToolContext } from '../memoryTools'

const mockGetAgent = vi.fn()
const mockMkdir = vi.fn()
const mockWriteFile = vi.fn()
const mockRename = vi.fn()
const mockAppendFile = vi.fn()
const mockReadFile = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...a: unknown[]) => mockMkdir(...a),
  writeFile: (...a: unknown[]) => mockWriteFile(...a),
  rename: (...a: unknown[]) => mockRename(...a),
  appendFile: (...a: unknown[]) => mockAppendFile(...a),
  readFile: (...a: unknown[]) => mockReadFile(...a),
  readdir: (...a: unknown[]) => mockReaddir(...a),
  stat: (...a: unknown[]) => mockStat(...a)
}))

vi.mock('@data/services/AgentService', () => ({ agentService: { getAgent: mockGetAgent } }))

const { memoryTool } = await import('../memoryTools')
const { ToolError, ToolErrorCode } = await import('../types')

function ctx(agentId = 'agent_1', workspacePath = '/workspace/test'): MemoryToolContext {
  return { agentId, workspacePath }
}

const call = async (args: Record<string, unknown>, c = ctx()) => memoryTool.handler(args, c)

describe('memoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgent.mockReturnValue({ id: 'agent_1' })
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockAppendFile.mockResolvedValue(undefined)
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
  })

  it('is named memory with an object schema', () => {
    expect(memoryTool.name).toBe('memory')
    expect((memoryTool.inputSchema as { type: string }).type).toBe('object')
  })

  it('updates FACT.md atomically', async () => {
    const result = await call({ action: 'update', content: '# Facts' })
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('FACT.md.'), '# Facts', 'utf-8')
    expect(mockRename).toHaveBeenCalled()
    expect(result.content[0]).toMatchObject({ text: 'Memory updated.' })
  })

  it('throws when update content is missing', async () => {
    await expect(call({ action: 'update' })).rejects.toMatchObject({ code: ToolErrorCode.InvalidParams })
  })

  it('appends a journal entry with tags', async () => {
    const result = await call({ action: 'append', text: 'Deployed', tags: ['deploy'] })
    expect(mockAppendFile).toHaveBeenCalledWith(
      '/workspace/test/memory/JOURNAL.jsonl',
      expect.stringContaining('"text":"Deployed"'),
      'utf-8'
    )
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('Journal entry added') })
  })

  it('searches the journal by tag in reverse-chronological order', async () => {
    mockReadFile.mockResolvedValue(
      [
        '{"ts":"2024-01-01T00:00:00Z","tags":["deploy"],"text":"v1"}',
        '{"ts":"2024-01-02T00:00:00Z","tags":["bug"],"text":"fix"}',
        '{"ts":"2024-01-03T00:00:00Z","tags":["deploy"],"text":"v2"}'
      ].join('\n')
    )
    const result = await call({ action: 'search', tag: 'deploy' })
    const parsed = JSON.parse((result.content[0] as { text: string }).text)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].text).toBe('v2')
  })

  it('reports an absent journal', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const result = await call({ action: 'search' })
    expect(result.content[0]).toMatchObject({ text: 'No journal entries found.' })
  })

  it('throws InternalError when the agent is gone', async () => {
    mockGetAgent.mockReturnValueOnce(null)
    await expect(call({ action: 'update', content: 'x' })).rejects.toMatchObject({
      code: ToolErrorCode.InternalError
    })
  })

  it('throws on unknown action', async () => {
    await expect(call({ action: 'nope' })).rejects.toBeInstanceOf(ToolError)
  })
})
