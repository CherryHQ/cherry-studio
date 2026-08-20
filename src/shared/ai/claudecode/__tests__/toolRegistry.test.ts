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
    expect(names.has('mcp__cherry_tools__webSearch__a26653c54bd6')).toBe(false)
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
    expect(byName.get('mcp__cherry_tools__webSearch__a26653c54bd6')?.label).toBe('Web Search')
    expect(byName.get('Bash')?.label).toBe('Bash')
  })

  it('exposes the mutating kb_manage and autonomy tools but hides the read-only kb deep tools', () => {
    expect(byName.has('mcp__cherry_tools__kbManage__d21480aca963')).toBe(true) // user — its own toggle
    expect(byName.get('mcp__cherry_tools__kbManage__d21480aca963')?.label).toBe('Manage Knowledge')
    expect(byName.has('mcp__cherry_tools__notify__2484dc7ba152')).toBe(true)
    expect(byName.get('mcp__cherry_tools__notify__2484dc7ba152')?.label).toBe('Notify')
    expect(byName.has('mcp__cherry_tools__config__7ebbe6253854')).toBe(true)
    expect(byName.get('mcp__cherry_tools__config__7ebbe6253854')?.label).toBe('Configuration')
    expect(byName.has('mcp__cherry_tools__kbRead__01a3c9c066e6')).toBe(false) // internal — follows kb capability
  })

  it('exposes generate_image as a user-facing media tool', () => {
    const tool = byName.get('mcp__cherry_tools__generateImage__d51e7b5767c3')
    expect(tool?.label).toBe('Generate Image')
    expect(tool?.category).toBe('media')
  })
})

describe('CLAUDE_KNOWLEDGE_TOOL_NAMES', () => {
  it('covers exactly the four in-process knowledge-base tool wire names', () => {
    expect([...CLAUDE_KNOWLEDGE_TOOL_NAMES].sort()).toEqual([
      'mcp__cherry_tools__kbList__1ca9920aae6d',
      'mcp__cherry_tools__kbManage__d21480aca963',
      'mcp__cherry_tools__kbRead__01a3c9c066e6',
      'mcp__cherry_tools__kbSearch__7fb1469c1b2d'
    ])
  })

  it('contains the user-facing kb toggles so the edit-dialog catalog can gate them', () => {
    // These are the two the builtin catalog hides when the agent has no bound base.
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry_tools__kbSearch__7fb1469c1b2d')).toBe(true)
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry_tools__kbManage__d21480aca963')).toBe(true)
    // Non-kb cherry tools must not be swept in.
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry_tools__webSearch__a26653c54bd6')).toBe(false)
    expect(CLAUDE_KNOWLEDGE_TOOL_NAMES.has('mcp__cherry_tools__generateImage__d51e7b5767c3')).toBe(false)
  })
})
