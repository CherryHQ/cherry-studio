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
  fetchMock.mockImplementation(async (url: string) => ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => {
      if (url.startsWith('https://skills.sh/')) return { skills: [] }
      if (url.startsWith('https://clawhub.ai/')) return { results: [] }
      return { skills }
    }
  }))
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
          stars: 42,
          installs: 100,
          sourceUrl: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices',
          metadata: {
            repoOwner: 'vercel-labs',
            repoName: 'agent-skills',
            directoryPath: 'skills/react-best-practices'
          }
        }
      ])

      const result = await callTool(createServer(), 'search_skills', { query: 'react perf' })
      const payload = JSON.parse(
        result.content[0].text.slice(result.content[0].text.indexOf('['), result.content[0].text.lastIndexOf(']') + 1)
      )

      expect(result.isError).toBeFalsy()
      expect(payload).toEqual([
        expect.objectContaining({
          stars: 42,
          source_registry: 'claude-plugins.dev',
          source_url: 'https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices',
          install_source: 'claude-plugins:vercel-labs/agent-skills/skills/react-best-practices'
        })
      ])
    })

    it('searches every marketplace supported by the renderer', async () => {
      fetchMock.mockImplementation(async (url: string) => ({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => {
          if (url.startsWith('https://skills.sh/')) {
            return {
              query: 'developer tools',
              count: 1,
              skills: [
                {
                  id: 'owner/repo/web-search',
                  skillId: 'web-search',
                  name: 'Web Search',
                  source: 'owner/repo',
                  installs: 12
                }
              ]
            }
          }
          if (url.startsWith('https://clawhub.ai/')) {
            return {
              results: [
                {
                  score: 1,
                  slug: 'code-review',
                  displayName: 'Code Review',
                  summary: 'Review code',
                  version: '1.0.0',
                  updatedAt: 1,
                  ownerHandle: 'owner'
                }
              ]
            }
          }
          return { skills: [] }
        }
      }))

      const result = await callTool(createServer(), 'search_skills', { query: 'developer tools' })
      const payload = JSON.parse(
        result.content[0].text.slice(result.content[0].text.indexOf('['), result.content[0].text.lastIndexOf(']') + 1)
      )

      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(payload).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ source_registry: 'skills.sh', install_source: 'skills.sh:owner/repo/web-search' }),
          expect.objectContaining({ source_registry: 'clawhub.ai', install_source: 'clawhub:owner/code-review' })
        ])
      )
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
      const server = createServer('agent-42')
      mockMarketplace([
        {
          id: 'react',
          name: 'React Best Practices',
          namespace: 'vercel-labs',
          metadata: {
            repoOwner: 'vercel-labs',
            repoName: 'agent-skills',
            directoryPath: 'skills/react-best-practices'
          }
        }
      ])
      installMock.mockResolvedValue({
        id: 'skill-1',
        name: 'React Best Practices',
        folderName: 'react-best-practices',
        description: 'React perf'
      })
      toggleMock.mockReturnValue({ id: 'skill-1', isEnabled: true })

      const installSource = 'claude-plugins:vercel-labs/agent-skills/skills/react-best-practices'
      await callTool(server, 'search_skills', { query: 'react' })
      const result = await callTool(server, 'install_skill', { install_source: installSource })

      expect(installMock).toHaveBeenCalledWith({ installSource })
      expect(toggleMock).toHaveBeenCalledWith({ skillId: 'skill-1', agentId: 'agent-42', isEnabled: true })
      expect(result.isError).toBeFalsy()
      expect(result.content[0].text).toContain('installed and enabled for this agent')
    })

    it('rejects an install_source that was not returned by this server session', async () => {
      const result = await callTool(createServer(), 'install_skill', {
        install_source: 'skills.sh:owner/repo/unreviewed'
      })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('was not returned by search_skills in this session')
      expect(installMock).not.toHaveBeenCalled()
    })

    it('errors when install_source is missing (never touches SkillService)', async () => {
      const result = await callTool(createServer(), 'install_skill', {})
      expect(result.isError).toBe(true)
      expect(installMock).not.toHaveBeenCalled()
    })

    it('surfaces an install failure as an error result, not a throw', async () => {
      const server = createServer()
      mockMarketplace([
        {
          id: 'c',
          name: 'C',
          namespace: 'a',
          metadata: { repoOwner: 'a', repoName: 'b', directoryPath: 'c' }
        }
      ])
      installMock.mockRejectedValue(new Error('clone failed'))
      await callTool(server, 'search_skills', { query: 'c' })
      const result = await callTool(server, 'install_skill', { install_source: 'claude-plugins:a/b/c' })
      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('clone failed')
    })
  })

  it('rejects an unknown tool', async () => {
    const result = await callTool(createServer(), 'nope', {})
    expect(result.isError).toBe(true)
  })
})
