import { describe, expect, it } from 'vitest'

import { claudeRegistrySdkDescriptors, claudeUserFacingTools } from '../toolRegistry'

describe('claudeRegistrySdkDescriptors', () => {
  const descriptors = claudeRegistrySdkDescriptors()

  it('marks every descriptor as builtin origin', () => {
    expect(descriptors.every((d) => d.origin === 'builtin')).toBe(true)
  })
})

describe('claudeUserFacingTools', () => {
  it('exposes ask_expert as a user-facing orchestration tool', () => {
    const byName = new Map(claudeUserFacingTools().map((tool) => [tool.name, tool]))
    const tool = byName.get('mcp__cherry-tools__ask_expert')

    expect(tool?.label).toBe('Ask Expert')
    expect(tool?.category).toBe('orchestration')
  })
})
