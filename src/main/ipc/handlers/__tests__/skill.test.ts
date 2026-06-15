import { beforeEach, describe, expect, it, vi } from 'vitest'

const skillServiceMock = vi.hoisted(() => ({
  list: vi.fn(),
  install: vi.fn(),
  uninstall: vi.fn(),
  toggle: vi.fn(),
  installFromZip: vi.fn(),
  installFromDirectory: vi.fn(),
  readFile: vi.fn(),
  listFiles: vi.fn(),
  listLocal: vi.fn()
}))

vi.mock('@main/ai/skills/SkillService', () => ({ skillService: skillServiceMock }))

import { skillHandlers } from '../skill'

const ctx = { senderId: 'w1' }

function createSkill(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    name: 'Skill One',
    description: 'First skill',
    folderName: 'skill-one',
    source: 'builtin',
    sourceUrl: null,
    namespace: null,
    author: null,
    sourceTags: [],
    contentHash: 'hash-1',
    isEnabled: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('skillHandlers', () => {
  it('list delegates optional agentId and returns the SkillResult envelope', async () => {
    const skills = [createSkill()]
    skillServiceMock.list.mockResolvedValueOnce(skills)

    const result = await skillHandlers['skill.list']({ agentId: 'agent-1' }, ctx)

    expect(skillServiceMock.list).toHaveBeenCalledWith({ agentId: 'agent-1' })
    expect(result).toEqual({ success: true, data: skills })
  })

  it('install / uninstall / toggle delegate to SkillService', async () => {
    const skill = createSkill({ isEnabled: true })
    skillServiceMock.install.mockResolvedValueOnce(skill)
    skillServiceMock.uninstall.mockResolvedValueOnce(undefined)
    skillServiceMock.toggle.mockResolvedValueOnce(skill)

    await expect(skillHandlers['skill.install']({ installSource: 'skills.sh:owner/repo' }, ctx)).resolves.toEqual({
      success: true,
      data: skill
    })
    await expect(skillHandlers['skill.uninstall']({ skillId: 'skill-1' }, ctx)).resolves.toEqual({
      success: true,
      data: undefined
    })
    await expect(
      skillHandlers['skill.toggle']({ agentId: 'agent-1', skillId: 'skill-1', isEnabled: true }, ctx)
    ).resolves.toEqual({ success: true, data: skill })
  })

  it('install_from_zip / install_from_directory delegate to SkillService', async () => {
    const zipSkill = createSkill({ id: 'zip' })
    const dirSkill = createSkill({ id: 'dir' })
    skillServiceMock.installFromZip.mockResolvedValueOnce(zipSkill)
    skillServiceMock.installFromDirectory.mockResolvedValueOnce(dirSkill)

    await expect(skillHandlers['skill.install_from_zip']({ zipFilePath: '/tmp/skill.zip' }, ctx)).resolves.toEqual({
      success: true,
      data: zipSkill
    })
    await expect(skillHandlers['skill.install_from_directory']({ directoryPath: '/tmp/skill' }, ctx)).resolves.toEqual({
      success: true,
      data: dirSkill
    })
  })

  it('read_file / list_files / list_local delegate to SkillService', async () => {
    const fileTree = [{ name: 'SKILL.md', path: 'SKILL.md', type: 'file' }]
    const localSkills = [{ name: 'Local Skill', filename: 'local-skill' }]
    skillServiceMock.readFile.mockResolvedValueOnce('# Skill')
    skillServiceMock.listFiles.mockResolvedValueOnce(fileTree)
    skillServiceMock.listLocal.mockResolvedValueOnce(localSkills)

    await expect(skillHandlers['skill.read_file']({ skillId: 'skill-1', filename: 'SKILL.md' }, ctx)).resolves.toEqual({
      success: true,
      data: '# Skill'
    })
    await expect(skillHandlers['skill.list_files']({ skillId: 'skill-1' }, ctx)).resolves.toEqual({
      success: true,
      data: fileTree
    })
    await expect(skillHandlers['skill.list_local']({ workdir: '/tmp/workspace' }, ctx)).resolves.toEqual({
      success: true,
      data: localSkills
    })
  })

  it('returns a failed SkillResult when the service throws', async () => {
    const error = new Error('install failed')
    skillServiceMock.install.mockRejectedValueOnce(error)

    await expect(skillHandlers['skill.install']({ installSource: 'skills.sh:owner/repo' }, ctx)).resolves.toEqual({
      success: false,
      error: 'install failed'
    })
  })
})
