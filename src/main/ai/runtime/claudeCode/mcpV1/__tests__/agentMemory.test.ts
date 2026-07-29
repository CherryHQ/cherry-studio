// v1 compatibility island regression tests.
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAgent = vi.fn()

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: mockGetAgent
  }
}))

const { default: AgentMemoryServer } = await import('../agentMemory')
type AgentMemoryServerInstance = InstanceType<typeof AgentMemoryServer>

async function callTool(server: AgentMemoryServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) throw new Error('No tools/call handler registered')
  return callToolHandler({ method: 'tools/call', params: { name: 'memory', arguments: args } }, {})
}

async function listTools(server: AgentMemoryServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) throw new Error('No tools/list handler registered')
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('AgentMemoryServer', () => {
  const agentId = 'agent_1'
  let agentsDataRoot: string
  let agentDataPath: string
  let memoryPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    mockGetAgent.mockReturnValue({ id: agentId })
    agentsDataRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-memory-'))
    agentDataPath = path.join(agentsDataRoot, agentId)
    memoryPath = path.join(agentDataPath, 'memory')
    await mkdir(memoryPath, { recursive: true })
    await writeFile(path.join(agentDataPath, 'SOUL.md'), '')
    await writeFile(path.join(agentDataPath, 'USER.md'), '')
  })

  afterEach(async () => {
    await rm(agentsDataRoot, { recursive: true, force: true })
  })

  function createServer() {
    return new AgentMemoryServer(agentId, agentDataPath)
  }

  it('exposes only the memory tool', async () => {
    const result = await listTools(createServer())
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('memory')
  })

  it('updates FACT.md atomically', async () => {
    const result = await callTool(createServer(), { action: 'update', content: '# Facts\n\nNew knowledge' })

    expect(await readFile(path.join(memoryPath, 'FACT.md'), 'utf-8')).toBe('# Facts\n\nNew knowledge')
    expect((await readdir(memoryPath)).filter((entry) => entry.endsWith('.tmp'))).toEqual([])
    expect(result.content[0].text).toBe('Memory updated.')
  })

  it('appends and searches journal entries', async () => {
    const server = createServer()
    await callTool(server, { action: 'append', text: 'Deployed v1.0', tags: ['deploy'] })
    await callTool(server, { action: 'append', text: 'Fixed login bug', tags: ['bugfix'] })
    await callTool(server, { action: 'append', text: 'Deployed v2.0', tags: ['deploy'] })

    const result = await callTool(server, { action: 'search', tag: 'deploy' })
    const parsed = JSON.parse(result.content[0].text)
    expect(parsed.map((entry: { text: string }) => entry.text)).toEqual(['Deployed v2.0', 'Deployed v1.0'])
  })

  it('returns a stable message when no journal exists', async () => {
    const result = await callTool(createServer(), { action: 'search' })
    expect(result.content[0].text).toBe('No journal entries found.')
  })

  it('rejects missing update content and missing append text', async () => {
    await expect(callTool(createServer(), { action: 'update' })).resolves.toMatchObject({ isError: true })
    await expect(callTool(createServer(), { action: 'append' })).resolves.toMatchObject({ isError: true })
  })

  it('stops memory access after the owning agent is deleted', async () => {
    mockGetAgent.mockReturnValueOnce(null)
    const result = await callTool(createServer(), { action: 'update', content: 'test' })
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain('Agent not found')
  })

  it.skipIf(process.platform === 'win32')('never follows a FACT.md symlink', async () => {
    const outsideFile = path.join(agentsDataRoot, 'outside-fact.md')
    await writeFile(outsideFile, 'outside')
    await symlink(outsideFile, path.join(memoryPath, 'FACT.md'))

    const result = await callTool(createServer(), { action: 'update', content: 'replacement' })

    expect(result).toMatchObject({ isError: true })
    expect(await readFile(outsideFile, 'utf-8')).toBe('outside')
  })

  it.skipIf(process.platform === 'win32')('never follows a JOURNAL.jsonl symlink', async () => {
    const outsideFile = path.join(agentsDataRoot, 'outside-journal.jsonl')
    await writeFile(outsideFile, '{"text":"outside"}\n')
    await symlink(outsideFile, path.join(memoryPath, 'JOURNAL.jsonl'))

    const appendResult = await callTool(createServer(), { action: 'append', text: 'inside' })
    const searchResult = await callTool(createServer(), { action: 'search' })

    expect(appendResult).toMatchObject({ isError: true })
    expect(searchResult).toMatchObject({ isError: true })
    expect(await readFile(outsideFile, 'utf-8')).toBe('{"text":"outside"}\n')
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked memory directory', async () => {
    const outsideDir = path.join(agentsDataRoot, 'outside-memory')
    await mkdir(outsideDir)
    await rm(memoryPath, { recursive: true })
    await symlink(outsideDir, memoryPath, 'dir')

    const result = await callTool(createServer(), { action: 'update', content: 'replacement' })

    expect(result).toMatchObject({ isError: true })
    expect(await readdir(outsideDir)).toEqual([])
  })
})
