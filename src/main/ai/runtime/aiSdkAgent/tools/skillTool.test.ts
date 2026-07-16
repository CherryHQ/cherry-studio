import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  readFile: vi.fn()
}))

vi.mock('@main/ai/skills/SkillService', () => ({
  skillService: { list: mocks.list, readFile: mocks.readFile }
}))

import { createSkillTool } from './skillTool'

const CALL_OPTIONS = { toolCallId: 'call-1', messages: [] }

const reviewSkill = {
  id: 'skill-1',
  name: 'code-review',
  description: 'review',
  folderName: 'code-review',
  isEnabled: true
}
const disabledSkill = { id: 'skill-2', name: 'deploy', description: null, folderName: 'deploy', isEnabled: false }

describe('skill tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.list.mockResolvedValue([reviewSkill, disabledSkill])
    mocks.readFile.mockResolvedValue('# Code Review\n\nDo the review.')
  })

  it('reads SKILL.md of an enabled skill by name', async () => {
    const tool = createSkillTool('agent-1')
    const output = await tool.execute!({ name: 'code-review' } as never, CALL_OPTIONS)

    expect(output).toContain('Do the review.')
    expect(mocks.list).toHaveBeenCalledWith({ agentId: 'agent-1' })
    expect(mocks.readFile).toHaveBeenCalledWith('skill-1', 'SKILL.md')
  })

  it('rejects a skill that is not enabled, listing what is available', async () => {
    const tool = createSkillTool('agent-1')
    await expect(tool.execute!({ name: 'deploy' } as never, CALL_OPTIONS)).rejects.toThrow(
      'Skill "deploy" is not enabled for this agent. Available skills: code-review'
    )
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('re-resolves enablement at fire-time', async () => {
    const tool = createSkillTool('agent-1')
    await expect(tool.execute!({ name: 'code-review' } as never, CALL_OPTIONS)).resolves.toBeDefined()

    mocks.list.mockResolvedValue([{ ...reviewSkill, isEnabled: false }])
    await expect(tool.execute!({ name: 'code-review' } as never, CALL_OPTIONS)).rejects.toThrow('not enabled')
  })

  it('never accepts a path — only catalog names resolve', async () => {
    const tool = createSkillTool('agent-1')
    await expect(tool.execute!({ name: '../../etc/passwd' } as never, CALL_OPTIONS)).rejects.toThrow('not enabled')
    expect(mocks.readFile).not.toHaveBeenCalled()
  })

  it('surfaces a missing SKILL.md as a tool error', async () => {
    mocks.readFile.mockResolvedValue(null)
    const tool = createSkillTool('agent-1')
    await expect(tool.execute!({ name: 'code-review' } as never, CALL_OPTIONS)).rejects.toThrow(
      'has no readable SKILL.md'
    )
  })
})
