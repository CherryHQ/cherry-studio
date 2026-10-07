import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { Client } from '@modelcontextprotocol/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { connectAgentMcpClient, serveAgentMcpServer } from '@main/ai/runtime/agentMcpServer'

const mockGetAgent = vi.fn()

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: mockGetAgent
  }
}))

const mockAssertAgentDataDirectory = vi.fn()
vi.mock('@main/ai/agents/agentDataDirectory', () => ({
  assertAgentDataDirectory: (...args: unknown[]) => mockAssertAgentDataDirectory(...args)
}))

const { createAgentMemoryServer } = await import('../agentMemory')

type Result = { isError?: boolean; content: Array<{ type: string; text?: string }> }
const clients: Client[] = []

async function createServer(): Promise<Client> {
  const ctx = { agentId, agentDataPath }
  const client = await connectAgentMcpClient(
    { name: 'agent-memory', connect: serveAgentMcpServer(() => createAgentMemoryServer(ctx)) },
    'test'
  )
  clients.push(client)
  return client
}

async function callTool(client: Client | Promise<Client>, args: Record<string, unknown>): Promise<Result> {
  return (await client).callTool({ name: 'memory', arguments: args })
}

async function listTools(client: Client | Promise<Client>) {
  return (await client).listTools()
}

let agentId: string
let agentDataPath: string

describe('agent-memory MCP server', () => {
  let agentsDataRoot: string
  let memoryPath: string

  beforeEach(async () => {
    vi.clearAllMocks()
    agentId = 'agent_1'
    mockGetAgent.mockReturnValue({ id: agentId })
    agentsDataRoot = await mkdtemp(path.join(os.tmpdir(), 'agent-memory-'))
    agentDataPath = path.join(agentsDataRoot, agentId)
    memoryPath = path.join(agentDataPath, 'memory')
    await mkdir(memoryPath, { recursive: true })
    await writeFile(path.join(agentDataPath, 'SOUL.md'), '')
    await writeFile(path.join(agentDataPath, 'USER.md'), '')
    mockAssertAgentDataDirectory.mockImplementation(async () => agentDataPath)
  })

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.close()))
    await rm(agentsDataRoot, { recursive: true, force: true })
  })

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
    const parsed = JSON.parse(result.content[0].text!)
    expect(parsed.map((entry: { text: string }) => entry.text)).toEqual(['Deployed v2.0', 'Deployed v1.0'])
  })

  it('returns a stable message when no journal exists', async () => {
    const result = await callTool(createServer(), { action: 'search' })
    expect(result.content[0].text).toBe('No journal entries found.')
  })

  it.each([
    { action: 'update' },
    { action: 'append' },
    { action: 'update', content: 42 },
    { action: 'append', text: 42 }
  ])('rejects missing or non-string memory content without writing: %j', async (args) => {
    const result = await callTool(createServer(), args)
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain('Input validation error')
    expect(await readdir(memoryPath)).toEqual([])
  })

  it('rejects an unknown action', async () => {
    const result = await callTool(createServer(), { action: 'nope' })
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain('Input validation error')
  })

  it('rejects an agent data path that no longer matches the agent', async () => {
    mockAssertAgentDataDirectory.mockResolvedValueOnce(path.join(agentDataPath, 'other'))
    const result = await callTool(createServer(), { action: 'update', content: 'x' })
    expect(result).toMatchObject({ isError: true })
    expect(result.content[0].text).toContain('Agent data path mismatch')
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
