import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mocks must be declared before importing SkillsServer
const mockSkillInstall = vi.fn()
const mockSkillUninstallByFolderName = vi.fn()
const mockSkillList = vi.fn()
const mockSkillToggle = vi.fn()
const mockSkillInstallFromDirectory = vi.fn()
const mockSkillGetSkillDirectory = vi.fn()
const mockSkillGetByFolderName = vi.fn()
const mockNetFetch = vi.fn()
const mockMkdir = vi.fn()
const mockReaddir = vi.fn()

vi.mock('node:fs/promises', () => ({
  mkdir: (...args: unknown[]) => mockMkdir(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args)
}))

vi.mock('@main/services/agents/skills', () => ({
  skillService: {
    install: mockSkillInstall,
    uninstallByFolderName: mockSkillUninstallByFolderName,
    list: mockSkillList,
    toggle: mockSkillToggle,
    installFromDirectory: mockSkillInstallFromDirectory,
    getSkillDirectory: mockSkillGetSkillDirectory,
    getByFolderName: mockSkillGetByFolderName
  }
}))

// Override net.fetch with our local mock — electron is mocked globally in main.setup.ts
const electron = await import('electron')
vi.mocked(electron.net.fetch).mockImplementation(mockNetFetch)

const { default: SkillsServer } = await import('../skills')
type SkillsServerInstance = InstanceType<typeof SkillsServer>

function createServer(agentId = 'agent_test') {
  return new SkillsServer(agentId)
}

async function callTool(server: SkillsServerInstance, args: Record<string, unknown>) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const callToolHandler = handlers?.get('tools/call')
  if (!callToolHandler) {
    throw new Error('No tools/call handler registered')
  }
  return callToolHandler({ method: 'tools/call', params: { name: 'skills', arguments: args } }, {})
}

async function listTools(server: SkillsServerInstance) {
  const handlers = (server.mcpServer.server as any)._requestHandlers
  const listHandler = handlers?.get('tools/list')
  if (!listHandler) {
    throw new Error('No tools/list handler registered')
  }
  return listHandler({ method: 'tools/list', params: {} }, {})
}

describe('SkillsServer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSkillToggle.mockResolvedValue({ id: 'skill-1', isEnabled: true })
  })

  it('should expose only the skills tool', async () => {
    const server = createServer()
    const result = await listTools(server)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].name).toBe('skills')
  })

  describe('search action', () => {
    it('should search marketplace skills', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          skills: [
            {
              name: 'gh-create-pr',
              description: 'Create GitHub PRs',
              author: 'test-author',
              namespace: '@test-owner/test-repo',
              installs: 42,
              metadata: { repoOwner: 'test-owner', repoName: 'test-repo' }
            }
          ],
          total: 1
        })
      }
      mockNetFetch.mockResolvedValue(mockResponse)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'search', query: 'github pr' })

      expect(mockNetFetch).toHaveBeenCalledWith(expect.stringContaining('/api/skills'), { method: 'GET' })
      expect(result.content[0].text).toContain('gh-create-pr')
      expect(result.content[0].text).toContain('test-owner/test-repo/gh-create-pr')
    })

    it('should handle empty search results', async () => {
      mockNetFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ skills: [], total: 0 })
      })

      const server = createServer()
      const result = await callTool(server, { action: 'search', query: 'nonexistent' })

      expect(result.content[0].text).toContain('No skills found')
    })

    it('should error when query is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'search' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'query' is required")
    })
  })

  describe('install action', () => {
    it('should install and auto-enable a marketplace skill', async () => {
      mockSkillInstall.mockResolvedValue({
        id: 'skill-1',
        name: 'gh-create-pr',
        description: 'Create PRs',
        folderName: 'gh-create-pr',
        isEnabled: false
      })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'install', identifier: 'owner/repo/gh-create-pr' })

      expect(mockSkillInstall).toHaveBeenCalledWith({
        installSource: 'claude-plugins:owner/repo/gh-create-pr'
      })
      expect(mockSkillToggle).toHaveBeenCalledWith({
        skillId: 'skill-1',
        agentId: 'agent_1',
        isEnabled: true
      })
      expect(result.content[0].text).toContain('Skill installed and enabled for this agent')
      expect(result.content[0].text).toContain('gh-create-pr')
    })

    it('should warn when toggle fails after install', async () => {
      mockSkillInstall.mockResolvedValue({
        id: 'skill-1',
        name: 'gh-create-pr',
        description: 'Create PRs',
        folderName: 'gh-create-pr',
        isEnabled: false
      })
      mockSkillToggle.mockResolvedValue(null)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'install', identifier: 'owner/repo/gh-create-pr' })

      expect(result.content[0].text).toContain('warning: failed to enable')
      expect(result.content[0].text).toContain('Enabled: false')
    })

    it('should error when identifier is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'install' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'identifier' is required")
    })
  })

  describe('remove action', () => {
    it('should remove an installed skill', async () => {
      mockSkillUninstallByFolderName.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'remove', name: 'gh-create-pr' })

      expect(mockSkillUninstallByFolderName).toHaveBeenCalledWith('gh-create-pr')
      expect(result.content[0].text).toContain('removed')
    })

    it('should error when name is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'remove' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })
  })

  describe('list action', () => {
    it('should list installed skills with absolute on-disk paths', async () => {
      mockSkillList.mockResolvedValue([
        { id: '1', name: 'gh-create-pr', description: 'Create PRs', folderName: 'gh-create-pr', isEnabled: true },
        { id: '2', name: 'code-review', description: 'Review code', folderName: 'code-review', isEnabled: true }
      ])
      mockSkillGetSkillDirectory.mockImplementation((folder: string) => `/global-skills/${folder}`)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'list' })

      // list is scoped to the current agent so enablement reflects
      // the per-agent state, not a shared global flag.
      expect(mockSkillList).toHaveBeenCalledWith('agent_1')
      const parsed = JSON.parse(result.content[0].text)
      expect(parsed).toHaveLength(2)
      // Each entry must include the absolute path so the model can patch the
      // skill in place via Read / Edit on the symlinked files.
      expect(parsed[0]).toMatchObject({
        name: 'gh-create-pr',
        folder: 'gh-create-pr',
        path: '/global-skills/gh-create-pr',
        enabled: true
      })
      expect(parsed[1]).toMatchObject({
        name: 'code-review',
        folder: 'code-review',
        path: '/global-skills/code-review',
        enabled: true
      })
      expect(mockSkillGetSkillDirectory).toHaveBeenCalledWith('gh-create-pr')
      expect(mockSkillGetSkillDirectory).toHaveBeenCalledWith('code-review')
    })

    it('should handle empty list', async () => {
      mockSkillList.mockResolvedValue([])

      const server = createServer()
      const result = await callTool(server, { action: 'list' })

      expect(result.content[0].text).toBe('No skills installed.')
    })
  })

  describe('init action', () => {
    it('should create the skill directory and return its path', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockSkillGetByFolderName.mockResolvedValue(null)
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      mockMkdir.mockResolvedValue(undefined)

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(mockSkillGetSkillDirectory).toHaveBeenCalledWith('my-skill')
      expect(mockMkdir).toHaveBeenCalledWith('/global-skills/my-skill', { recursive: true })
      expect(result.content[0].text).toContain('/global-skills/my-skill')
      expect(result.content[0].text).toContain('register')
    })

    it('should reject when a skill with the same folder name already exists in DB', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockSkillGetByFolderName.mockResolvedValue({
        id: 'existing-id',
        name: 'My Existing Skill',
        folderName: 'my-skill'
      })

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('already exists')
      expect(result.content[0].text).toContain('My Existing Skill')
      expect(result.content[0].text).toContain('action="remove"')
      expect(mockMkdir).not.toHaveBeenCalled()
    })

    it('should reject when directory exists and is non-empty but not tracked in DB', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockSkillGetByFolderName.mockResolvedValue(null)
      mockReaddir.mockResolvedValue(['SKILL.md', 'scripts'])

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('already exists and is non-empty')
      expect(mockMkdir).not.toHaveBeenCalled()
    })

    it('should allow init when directory exists but is empty', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockSkillGetByFolderName.mockResolvedValue(null)
      mockReaddir.mockResolvedValue([])
      mockMkdir.mockResolvedValue(undefined)

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.content[0].text).toContain('Skill directory ready at:')
      expect(mockMkdir).toHaveBeenCalled()
    })

    it('should reject when readdir fails with non-ENOENT error (e.g. EACCES)', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockSkillGetByFolderName.mockResolvedValue(null)
      mockReaddir.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))

      const server = createServer()
      const result = await callTool(server, { action: 'init', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Cannot read skill directory')
      expect(mockMkdir).not.toHaveBeenCalled()
    })

    it('should error when name is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'init' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })
  })

  describe('register action', () => {
    it('should register an in-place skill and enable it', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockReaddir.mockResolvedValue(['SKILL.md', 'scripts'])
      mockSkillInstallFromDirectory.mockResolvedValue({
        id: 'skill-2',
        name: 'My Skill',
        description: 'Cool skill',
        folderName: 'my-skill',
        isEnabled: false
      })

      const server = createServer('agent_1')
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(mockSkillInstallFromDirectory).toHaveBeenCalledWith({ directoryPath: '/global-skills/my-skill' })
      expect(mockSkillToggle).toHaveBeenCalledWith({
        skillId: 'skill-2',
        agentId: 'agent_1',
        isEnabled: true
      })
      expect(result.content[0].text).toContain('My Skill')
      expect(result.content[0].text).toContain('registered and enabled for this agent')
    })

    it('should error when SKILL.md is missing from directory', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockReaddir.mockResolvedValue(['scripts', 'README.md'])

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('No SKILL.md found')
      expect(mockSkillInstallFromDirectory).not.toHaveBeenCalled()
    })

    it('should error when directory does not exist', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('does not exist')
      expect(result.content[0].text).toContain('Did you call action="init" first')
      expect(mockSkillInstallFromDirectory).not.toHaveBeenCalled()
    })

    it('should error with InternalError when readdir fails with EACCES', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockReaddir.mockRejectedValue(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain('Cannot read skill directory')
      expect(result.content[0].text).not.toContain('Did you call action="init" first')
      expect(mockSkillInstallFromDirectory).not.toHaveBeenCalled()
    })

    it('should warn when toggle fails after register', async () => {
      mockSkillGetSkillDirectory.mockReturnValue('/global-skills/my-skill')
      mockReaddir.mockResolvedValue(['SKILL.md'])
      mockSkillInstallFromDirectory.mockResolvedValue({
        id: 'skill-2',
        name: 'My Skill',
        description: 'Cool skill',
        folderName: 'my-skill',
        isEnabled: false
      })
      mockSkillToggle.mockResolvedValue(null)

      const server = createServer()
      const result = await callTool(server, { action: 'register', name: 'my-skill' })

      expect(result.content[0].text).toContain('warning: failed to enable')
      expect(result.content[0].text).toContain('Enabled: false')
    })

    it('should error when name is missing', async () => {
      const server = createServer()
      const result = await callTool(server, { action: 'register' })

      expect(result.isError).toBe(true)
      expect(result.content[0].text).toContain("'name' is required")
    })
  })

  it('should handle unknown action', async () => {
    const server = createServer()
    const result = await callTool(server, { action: 'unknown' })

    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('Unknown action')
  })
})
