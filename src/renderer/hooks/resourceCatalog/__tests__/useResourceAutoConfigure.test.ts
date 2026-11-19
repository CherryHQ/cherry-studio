import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useResourceAutoConfigure } from '../useResourceAutoConfigure'

const fetchGenerate = vi.hoisted(() => vi.fn<(input: { content: string }) => Promise<string>>())

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
      { id: 'mcp-browser', name: '@cherry/browser', type: 'inMemory', isActive: true }
    ]
  })
}))

describe('useResourceAutoConfigure', () => {
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
})
