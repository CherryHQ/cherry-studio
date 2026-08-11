import { describe, expect, it } from 'vitest'

import { CLAUDE_KNOWLEDGE_TOOL_NAMES, claudeRegistrySdkDescriptors, claudeUserFacingTools } from '../toolRegistry'

describe('claudeRegistrySdkDescriptors', () => {
  const descriptors = claudeRegistrySdkDescriptors()
  const names = new Set(descriptors.map((d) => d.name))

  it('includes non-disabled SDK tools', () => {
    expect(names.has('Bash')).toBe(true)
    expect(names.has('Agent')).toBe(true)
    expect(names.has('Workflow')).toBe(true)
  })

  it('excludes disabled SDK tools and all MCP tools', () => {
    expect(names.has('WebSearch')).toBe(false)
    expect(names.has('NotebookEdit')).toBe(false)
    expect(names.has('mcp__cherry-tools__web_search')).toBe(false)
  })

  it('marks every descriptor as builtin origin', () => {
    expect(descriptors.every((d) => d.origin === 'builtin')).toBe(true)
  })
})

describe('claudeUserFacingTools', () => {
  const tools = claudeUserFacingTools()
  const byName = new Map(tools.map((tool) => [tool.name, tool]))

  it('exposes only `user` tools, hiding internal and disabled ones', () => {
    expect(byName.has('Bash')).toBe(true) // user
    expect(byName.has('Agent')).toBe(false) // internal
    expect(byName.has('WebSearch')).toBe(false) // disabled
  })

  it('labels MCP wire tools via MCP_TOOL_LABELS and SDK tools by their name', () => {
    expect(byName.get('mcp__cherry-tools__web_search')?.label).toBe('Web Search')
    expect(byName.get('Bash')?.label).toBe('Bash')
  })

  it('exposes the mutating kb_manage and autonomy tools but hides the read-only kb deep tools', () => {
    expect(byName.has('mcp__cherry-tools__kb_manage')).toBe(true) // user — its own toggle
    expect(byName.get('mcp__cherry-tools__kb_manage')?.label).toBe('Manage Knowledge')
    expect(byName.has('mcp__cherry-tools__notify')).toBe(true)
    expect(byName.get('mcp__cherry-tools__notify')?.label).toBe('Notify')
    expect(byName.has('mcp__cherry-tools__config')).toBe(true)
    expect(byName.get('mcp__cherry-tools__config')?.label).toBe('Configuration')
    expect(byName.has('mcp__cherry-tools__kb_read')).toBe(false) // internal — follows kb capability
  })

  it('exposes generate_image as a user-facing media tool', () => {
    const tool = byName.get('mcp__cherry-tools__generate_image')
    expect(tool?.label).toBe('Generate Image')
    expect(tool?.category).toBe('media')
  })
})

describe('CLAUDE_KNOWLEDGE_TOOL_NAMES', () => {
  it('covers exactly the four in-process knowledge-base tool wire names', () => {
    expect([...CLAUDE_KNOWLEDGE_TOOL_NAMES].sort()).toEqual([
      'mcp__cherry-tools__kb_list',
      'mcp__cherry-tools__kb_manage',
      'mcp__cherry-tools__kb_read',
      'mcp__cherry-tools__kb_search'
    ])
  })

  it('contains the user-facing kb toggles so the edit-dialog catalog can gate them', () => {
    // These are the two the builtin catalog hides when the agent has no bound base.
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry-tools__kb_search')).toBe(true)
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry-tools__kb_manage')).toBe(true)
    // Non-kb cherry tools must not be swept in.
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry-tools__web_search')).toBe(false)
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry-tools__generate_image')).toBe(false)
  })
})
