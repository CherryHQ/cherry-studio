import { describe, expect, it } from 'vitest'

import { formatAttachedSkillsSystemPrompt } from '../SkillsContextService'

describe('SkillsContextService', () => {
  it('formats attached skills into a single system prompt', () => {
    const prompt = formatAttachedSkillsSystemPrompt([
      {
        folderName: 'a',
        name: '技能A',
        description: '描述A',
        body: '内容A'
      },
      {
        folderName: 'b',
        name: '技能B',
        body: '内容B'
      }
    ])

    expect(prompt).toContain('以下内容为用户在输入栏“附加技能”中选择的技能')
    expect(prompt).toContain('【技能】技能A - 描述A')
    expect(prompt).toContain('内容A')
    expect(prompt).toContain('【技能】技能B')
    expect(prompt).toContain('内容B')
  })
})
