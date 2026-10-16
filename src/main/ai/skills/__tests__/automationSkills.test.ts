import { describe, expect, it } from 'vitest'

import { isAutomationSkillAvailable } from '../automationSkills'

describe('automation skill capability routing', () => {
  it('exposes only the enabled surface without removing unrelated or user-owned skills', () => {
    const skills = [
      { source: 'builtin', folderName: 'cherry-browser' },
      { source: 'builtin', folderName: 'cherry-computer' },
      { source: 'builtin', folderName: 'cherry-tool-guide' },
      { source: 'local', folderName: 'cherry-computer' }
    ] as const
    const available = skills.filter((skill) => isAutomationSkillAvailable(skill, { browser: true, computer: false }))
    expect(available).toEqual([skills[0], skills[2], skills[3]])
    expect(skills.filter((skill) => isAutomationSkillAvailable(skill, { browser: false, computer: false }))).toEqual([
      skills[2],
      skills[3]
    ])
  })
})
