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

function mockMarketplace(skills: unknown[]) {
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ skills }) })
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
    it('returns matches with an install_source built from the real directoryPath', async () => {
      mockMarketplace([
        {
          id: 's1',
          name: 'React Best Practices',
          namespace: 'vercel-labs',
          description: 'React perf',
          author: 'vercel',
          installs: 100,
          metadata: { repoOwner: 'vercel-labs', repoName: 'agent-skills', directoryPath: 'skills/react-best-practices' }
        }
      ])

      const result = await callTool(createServer(), 'search_skills', { query: 'react perf' })

      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('claude-plugins:vercel-labs/agent-skills/skills/react-best-practices')
    })

    it('builds install_source from directoryPath, not the display name (regression)', async () => {
      // Real data has display names that differ entirely from the directory.
      mockMarketplace([
        {
          id: 'ad',
          name: 'Agent Development',
          namespace: 'anthropics',
          installs: 1,
          metadata: {
            repoOwner: 'anthropics',
            repoName: 'claude-code',
            directoryPath: 'plugins/plugin-dev/skills/agent-development'
          }
        }
      ])

      const result = await callTool(createServer(), 'search_skills', { query: 'agent dev' })

      expect(result.content[0].text).toContain(
        'claude-plugins:anthropics/claude-code/plugins/plugin-dev/skills/agent-development'
      )
      // The identifier must NOT be assembled from the display name.
      expect(result.content[0].text).not.toContain('anthropics/claude-code/Agent Development')
    })

    it('drops results without a resolvable install directory (fail closed)', async () => {
      mockMarketplace([{ id: 'x', name: 'No Dir', namespace: 'ns', metadata: { repoOwner: 'o', repoName: 'r' } }])

      const result = await callTool(createServer(), 'search_skills', { query: 'x' })

      expect(result.content[0].text).toContain('No installable skills found')
    })

    it('errors when the query is missing', async () => {
      const result = await callTool(createServer(), 'search_skills', {})
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toMatch(/query/i)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('install_skill', () => {
    it('installs the exact install_source via SkillService and enables it for the current agent', async () => {
      installMock.mockResolvedValue({
        id: 'skill-1',
        name: 'React Best Practices',
        folderName: 'react-best-practices',
        description: 'React perf'
      })
      toggleMock.mockReturnValue({ id: 'skill-1', isEnabled: true })

      const installSource = 'claude-plugins:vercel-labs/agent-skills/skills/react-best-practices'
      const result = await callTool(createServer('agent-42'), 'install_skill', { install_source: installSource })

      expect(installMock).toHaveBeenCalledWith({ installSource })
      expect(toggleMock).toHaveBeenCalledWith({ skillId: 'skill-1', agentId: 'agent-42', isEnabled: true })
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('installed and enabled for this agent')
    })

    it('errors when install_source is missing (never touches SkillService)', async () => {
      const result = await callTool(createServer(), 'install_skill', {})
      expect(result.isError).toBe(true)
      expect(installMock).not.toHaveBeenCalled()
    })

    it('surfaces an install failure as an error result, not a throw', async () => {
      installMock.mockRejectedValue(new Error('clone failed'))
      const result = await callTool(createServer(), 'install_skill', { install_source: 'claude-plugins:a/b/c' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('clone failed')
    })
  })

  it('rejects an unknown tool', async () => {
    const result = await callTool(createServer(), 'nope', {})
    expect(result.isError).toBe(true)
  })
})
