import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isAgentRuntimeConfigCaptureExcluded,
  isManagedSkillTarget,
  isWorkspaceManagedSkillProjection
} from '../capturePolicy'

describe('skill capture ownership policy', () => {
  const skillsRoot = path.resolve('/profile/Data/Skills')

  it('recognizes only direct workspace skill links into the managed skill library', () => {
    expect(
      isWorkspaceManagedSkillProjection('.claude/skills/find-skills', path.join(skillsRoot, 'find-skills'), skillsRoot)
    ).toBe(true)
    expect(
      isWorkspaceManagedSkillProjection(
        '.claude/skills/find-skills/nested',
        path.join(skillsRoot, 'find-skills'),
        skillsRoot
      )
    ).toBe(false)
    expect(isWorkspaceManagedSkillProjection('.claude/skills/find-skills', '/external/find-skills', skillsRoot)).toBe(
      false
    )
    expect(
      isWorkspaceManagedSkillProjection('.claude/skills/find-skills', path.join(skillsRoot, 'pdf'), skillsRoot)
    ).toBe(false)
    expect(
      isWorkspaceManagedSkillProjection(
        '.claude/skills/find-skills',
        path.join(skillsRoot, 'find-skills', 'nested'),
        skillsRoot
      )
    ).toBe(false)
  })

  it('uses component-aware containment for managed skill targets', () => {
    expect(isManagedSkillTarget(path.join(skillsRoot, 'pdf'), skillsRoot)).toBe(true)
    expect(isManagedSkillTarget(`${skillsRoot}-copy/pdf`, skillsRoot)).toBe(false)
    expect(isManagedSkillTarget('C:\\Profile\\Data\\Skills\\PDF', 'c:\\profile\\data\\skills')).toBe(true)
    expect(isManagedSkillTarget('C:\\Profile\\Data\\Skills-copy\\PDF', 'c:\\profile\\data\\skills')).toBe(false)
    expect(isManagedSkillTarget('/profile/Data/Skills/../Secrets', skillsRoot)).toBe(false)
  })

  it('matches direct Windows projections case-insensitively', () => {
    expect(
      isWorkspaceManagedSkillProjection(
        '.claude/skills/find-skills',
        'C:\\Profile\\Data\\Skills\\FIND-SKILLS',
        'c:\\profile\\data\\skills'
      )
    ).toBe(true)
  })

  it('excludes the generated runtime skill mirror but not similarly named config', () => {
    expect(isAgentRuntimeConfigCaptureExcluded('skills')).toBe(true)
    expect(isAgentRuntimeConfigCaptureExcluded('skills/pdf/SKILL.md')).toBe(true)
    expect(isAgentRuntimeConfigCaptureExcluded('skills.json')).toBe(false)
  })
})
