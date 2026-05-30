import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGetAgent = vi.fn()
const mockMkdir = vi.fn()
const mockWriteFile = vi.fn()
const mockRename = vi.fn()
const mockAppendFile = vi.fn()
const mockReadFile = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  writeFile: (...args: unknown[]) => mockWriteFile(...args),
  rename: (...args: unknown[]) => mockRename(...args),
  appendFile: (...args: unknown[]) => mockAppendFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args)
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: mockGetAgent
  }
}))

const { default: WorkspaceMemoryServer } = await import('../workspaceMemory')
type WorkspaceMemoryServerInstance = InstanceType<typeof WorkspaceMemoryServer>

function createServer(agentId = 'agent_test') {
  return new WorkspaceMemoryServer(agentId)
}

async function callTool(server: WorkspaceMemoryServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'memory', arguments: args } }, {})
}

async function listTools(server: WorkspaceMemoryServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('WorkspaceMemoryServer', () => {
  const agentWithWorkspace = { accessiblePaths: ['/workspace/test'] }

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetAgent.mockResolvedValue(agentWithWorkspace)
    mockMkdir.mockResolvedValue(undefined)
    mockWriteFile.mockResolvedValue(undefined)
    mockRename.mockResolvedValue(undefined)
    mockAppendFile.mockResolvedValue(undefined)
    // resolveFileCI: exact path always found
    mockStat.mockResolvedValue({ mtimeMs: 1000 })
  })

  it('should expose only the memory tool', async () => {
    const server = createServer()
    const result = await listTools(server)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('memory')
  })

  describe('update action', () => {
    it('should update FACT.md atomically', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'update', content: '# Facts\n\nNew knowledge' })

      expect(mockMkdir).toHaveBeenCalledWith('/workspace/test/memory', { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('FACT.md.'),
        '# Facts\n\nNew knowledge',
        'utf-8'
      )
      expect(mockRename).toHaveBeenCalled()
      expect(result.content[0].text).toBe('Memory updated.')
    })

    it('should error when content is missing', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'update' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'content' is required")
    })
  })

  describe('append action', () => {
    it('should append journal entry with tags', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, {
        action: 'append',
        text: 'Deployed v2.0',
        tags: ['deploy', 'release']
      })

      expect(mockAppendFile).toHaveBeenCalledWith(
        '/workspace/test/memory/JOURNAL.jsonl',
        expect.stringContaining('"text":"Deployed v2.0"'),
        'utf-8'
      )
      expect(result.content[0].text).toContain('Journal entry added')
    })

    it('should error when text is missing', async () => {
      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'append' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'text' is required")
    })
  })

  describe('search action', () => {
    it('should search journal by tag', async () => {
      const entries = [
        '{"ts":"2024-01-01T00:00:00Z","tags":["deploy"],"text":"Deployed v1.0"}',
        '{"ts":"2024-01-02T00:00:00Z","tags":["bugfix"],"text":"Fixed login bug"}',
        '{"ts":"2024-01-03T00:00:00Z","tags":["deploy"],"text":"Deployed v2.0"}'
      ].join('\n')
      mockReadFile.mockResolvedValue(entries)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', tag: 'deploy' })

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toHaveLength(2)
      expect(parsed[0].text).toBe('Deployed v2.0') // reverse chronological
    })

    it('should search journal with text query', async () => {
      const entries = [
        '{"ts":"2024-01-01T00:00:00Z","tags":[],"text":"Setup project"}',
        '{"ts":"2024-01-02T00:00:00Z","tags":[],"text":"Fixed login bug"}'
      ].join('\n')
      mockReadFile.mockResolvedValue(entries)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'login' })

      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toHaveLength(1)
      expect(parsed[0].text).toBe('Fixed login bug')
    })

    it('should return message when no matches', async () => {
      mockReadFile.mockResolvedValue('{"ts":"2024-01-01T00:00:00Z","tags":[],"text":"hello"}\n')

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'nonexistent' })

      expect(result.content[0].text).toBe('No matching journal entries found.')
    })

    it('should return message when journal does not exist', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search' })

      expect(result.content[0].text).toBe('No journal entries found.')
    })
  })

  it('should error when agent has no workspace', async () => {
    mockGetAgent.mockResolvedValue({ accessiblePaths: [] })

    const server = createServer('agent_1')
    const result = await callTool(server, { action: 'update', content: 'test' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('no workspace path')
  })

  it('should handle unknown action', async () => {
    const server = createServer()
    const result = await callTool(server, { action: 'unknown' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown action')
  })
})
