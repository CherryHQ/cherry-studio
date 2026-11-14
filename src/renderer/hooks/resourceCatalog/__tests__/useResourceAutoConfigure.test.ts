import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useResourceAutoConfigure } from '../useResourceAutoConfigure'

const fetchGenerate = vi.hoisted(() => vi.fn<(input: { content: string }) => Promise<string>>())
const addMcpServer = vi.hoisted(() => vi.fn())

vi.mock('@renderer/utils/aiGeneration', () => ({ fetchGenerate }))
vi.mock('@renderer/hooks/useSkills', () => ({
  useInstalledSkills: () => ({
    loading: false,
    skills: [
      { id: 'skill-review', name: 'Review', source: 'marketplace', isGlobalEnabled: true },
      { id: 'skill-builtin', name: 'Builtin', source: 'builtin', isGlobalEnabled: true },
      { id: 'skill-off', name: 'Off', source: 'marketplace', isGlobalEnabled: false }
    ]
  })
}))
vi.mock('@renderer/hooks/useKnowledgeBase', () => ({
  useKnowledgeBases: () => ({ isLoading: false, bases: [{ id: 'kb-docs', name: 'Docs' }] })
}))
vi.mock('@renderer/hooks/useMcpServer', () => ({
  useMcpServers: () => ({
    isLoading: false,
    mcpServers: [
      { id: 'mcp-github', name: 'GitHub', type: 'stdio', isActive: true },
      { id: 'mcp-inactive', name: 'Inactive', type: 'stdio', isActive: false },
      { id: 'mcp-browser', name: '@cherry/browser', type: 'inMemory', isActive: true },
      { id: 'mcp-sequential', name: '@cherry/sequentialthinking', type: 'inMemory', isActive: true }
    ],
    addMcpServer
  })
}))

describe('useResourceAutoConfigure', () => {
  beforeEach(() => {
    addMcpServer.mockReset()
  })

  it('never links builtin or disabled skills, or inactive or browser MCP servers', async () => {
    fetchGenerate.mockResolvedValue(
      JSON.stringify({
        name: 'Reviewer',
        prompt: 'You review.',
        skillIds: ['skill-review', 'skill-builtin', 'skill-off'],
        mcpServerIds: ['mcp-github', 'mcp-inactive', 'mcp-browser'],
        knowledgeBaseIds: ['kb-docs']
      })
    )
    const { result } = renderHook(() => useResourceAutoConfigure('agent'))

    const draft = await result.current.generate({
      agentType: 'claude-code',
      purpose: 'Review PRs',
      name: '',
      signal: new AbortController().signal
    })

    expect(result.current.ready).toBe(true)
    expect(draft).toMatchObject({
      skillIds: ['skill-review'],
      mcpServerIds: ['mcp-github'],
      knowledgeBaseIds: ['kb-docs']
    })
    const offered = fetchGenerate.mock.calls[0][0].content
    for (const hidden of ['skill-builtin', 'skill-off', 'mcp-inactive', 'mcp-browser']) {
      expect(offered).not.toContain(hidden)
    }
  })

  it('offers uninstalled configuration-free featured MCP servers by preset ID, never ones that need configuration', async () => {
    fetchGenerate.mockResolvedValue(
      JSON.stringify({
        name: 'Researcher',
        prompt: 'You research.',
        mcpServerIds: ['preset:@cherry/fetch', 'preset:@cherry/brave-search', 'preset:@cherry/sequentialthinking']
      })
    )
    const { result } = renderHook(() => useResourceAutoConfigure('assistant'))

    const draft = await result.current.generate({
      agentType: 'claude-code',
      purpose: 'Research the web',
      name: '',
      signal: new AbortController().signal
    })

    const offered = fetchGenerate.mock.calls.at(-1)![0].content
    expect(offered).toContain('preset:@cherry/fetch')
    // Brave Search needs an API key; sequential thinking is already installed and listed by its own ID.
    expect(offered).not.toContain('preset:@cherry/brave-search')
    expect(offered).not.toContain('preset:@cherry/sequentialthinking')
    expect(draft?.mcpServerIds).toEqual(['preset:@cherry/fetch'])
  })

  it('installs picked featured servers once, active, and swaps in their new IDs', async () => {
    addMcpServer.mockResolvedValue({ id: 'mcp-fetch-new', name: '@cherry/fetch' })
    const { result } = renderHook(() => useResourceAutoConfigure('agent'))

    const ids = await result.current.installFeaturedMcpServers(['mcp-github', 'preset:@cherry/fetch'])

    expect(ids).toEqual(['mcp-github', 'mcp-fetch-new'])
    expect(addMcpServer).toHaveBeenCalledTimes(1)
    expect(addMcpServer.mock.calls[0][0]).toMatchObject({ name: '@cherry/fetch', isActive: true })
  })

  it('fails when a featured server cannot be installed', async () => {
    addMcpServer.mockRejectedValue(new Error('npm offline'))
    const { result } = renderHook(() => useResourceAutoConfigure('agent'))

    await expect(result.current.installFeaturedMcpServers(['preset:@cherry/fetch'])).rejects.toThrow('npm offline')
  })
})
