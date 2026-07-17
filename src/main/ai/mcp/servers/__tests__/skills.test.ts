import { beforeEach, describe, expect, it, vi } from 'vitest'

const { installMock, toggleMock } = vi.hoisted(() => ({ installMock: vi.fn(), toggleMock: vi.fn() }))
const fetchMock = vi.hoisted(() => vi.fn())

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: { install: installMock, toggle: toggleMock }
}))
vi.mock('electron', () => ({ net: { fetch: fetchMock } }))

const { default: SkillsServer } = await import('../skills')
type SkillsServerInstance = InstanceType<typeof SkillsServer>

function createServer(agentId = 'agent-1') {
  return new SkillsServer(agentId)
}

function handlers(server: SkillsServerInstance) {
  return (server.mcpServer.server as any)._requestHandlers
}

async function listTools(server: SkillsServerInstance): Promise<any> {
  return handlers(server).get('tools/list')({ method: 'tools/list', params: {} }, {})
}

async function callTool(server: SkillsServerInstance, name: string, args: Record<string, unknown>): Promise<any> {
  return handlers(server).get('tools/call')({ method: 'tools/call', params: { name, arguments: args } }, {})
}

describe('SkillsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exposes exactly search_skills and install_skill', async () => {
    const result = await listTools(createServer())
    expect(result.tools.map((t: any) => t.name)).toEqual(['search_skills', 'install_skill'])
  })

  describe('search_skills', () => {
    it('returns marketplace matches with an owner/repo/skill identifier', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          skills: [
            {
              name: 'react-best-practices',
              description: 'React perf',
              author: 'vercel',
              installs: 100,
              metadata: { repoOwner: 'vercel-labs', repoName: 'agent-skills' }
            }
          ]
        })
      })

      const result = await callTool(createServer(), 'search_skills', { query: 'react perf' })

      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('vercel-labs/agent-skills/react-best-practices')
    })

    it('errors when the query is missing', async () => {
      const result = await callTool(createServer(), 'search_skills', {})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/query/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('install_skill', () => {
    it('installs exactly one skill via SkillService and enables it for the current agent', async () => {
      installMock.mockResolvedValue({
        id: 'skill-1',
        name: 'React Best Practices',
        folderName: 'react-best-practices',
        description: 'React perf'
      })
      toggleMock.mockReturnValue({ id: 'skill-1', isEnabled: true })

      const result = await callTool(createServer('agent-42'), 'install_skill', {
        identifier: 'vercel-labs/agent-skills/react-best-practices'
      })

      expect(installMock).toHaveBeenCalledWith({
        installSource: 'claude-plugins:vercel-labs/agent-skills/react-best-practices'
      })
      expect(toggleMock).toHaveBeenCalledWith({ skillId: 'skill-1', agentId: 'agent-42', isEnabled: true })
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('installed and enabled for this agent')
    })

    it('errors when the identifier is missing (never touches SkillService)', async () => {
      const result = await callTool(createServer(), 'install_skill', {})
      expect(result.isError).toBe(true)
      expect(installMock).not.toHaveBeenCalled()
    })

    it('surfaces an install failure as an error result, not a throw', async () => {
      installMock.mockRejectedValue(new Error('clone failed'))
      const result = await callTool(createServer(), 'install_skill', { identifier: 'a/b/c' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('clone failed')
    })
  })

  it('rejects an unknown tool', async () => {
    const result = await callTool(createServer(), 'nope', {})
    expect(result.isError).toBe(true)
  })
})
