import fs from 'node:fs/promises'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { installBuiltinSkills } from '../utils/builtinSkills'

vi.mock('node:fs/promises', () => ({
  default: {
    access: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    cp: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    readlink: vi.fn(),
    symlink: vi.fn(),
    rm: vi.fn()
  }
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: vi.fn(() => '/app'),
    getPath: vi.fn(() => '/userData'),
    getVersion: vi.fn(() => '2.0.0')
  }
}))

vi.mock('../utils', () => ({
  getDataPath: vi.fn((subPath?: string) => (subPath ? path.join('/userData/Data', subPath) : '/userData/Data')),
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

// vi.mock factories are hoisted above top-level declarations, so use
// `vi.hoisted` to give the factories safe references to the mock fns.
const { mockRepo, mockEnableForAllAgents } = vi.hoisted(() => ({
  mockRepo: {
    getByFolderName: vi.fn(),
    delete: vi.fn(),
    insert: vi.fn(),
    updateMetadata: vi.fn()
  },
  mockEnableForAllAgents: vi.fn()
}))

vi.mock('../services/agents/skills/SkillRepository', () => ({
  SkillRepository: {
    getInstance: () => mockRepo
  }
}))

vi.mock('../services/agents/skills/SkillService', () => ({
  skillService: {
    enableForAllAgents: mockEnableForAllAgents
  }
}))

vi.mock('../utils/markdownParser', () => ({
  parseSkillMetadata: vi.fn(() =>
    Promise.resolve({
      name: 'Test Skill',
      description: 'A test skill',
      filename: 'test-skill',
      author: 'test',
      tags: []
    })
  ),
  findSkillMdPath: vi.fn(),
  findAllSkillDirectories: vi.fn()
}))

const resourceSkillsPath = '/app/resources/skills'
const globalSkillsPath = '/userData/Data/Skills'

beforeEach(() => {
  vi.clearAllMocks()
  mockRepo.getByFolderName.mockResolvedValue(null)
  mockRepo.insert.mockResolvedValue({ id: 'test-id' })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('installBuiltinSkills', () => {
  it('should return early when resources/skills does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'))

    await installBuiltinSkills()

    expect(fs.access).toHaveBeenCalledWith(resourceSkillsPath)
    expect(fs.readdir).not.toHaveBeenCalled()
  })

  it('should copy skills that do not exist at destination', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined) // resourceSkillsPath exists
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    // Destination .version read fails → skill not installed yet
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT'))
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    // computeHash: SKILL.md read
    vi.mocked(fs.readFile).mockResolvedValueOnce('# My Skill' as any)

    await installBuiltinSkills()

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill'), { recursive: true })
    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '2.0.0', 'utf-8')
    // With the per-agent model no global symlink is created — skills are
    // linked per-agent via SkillService.enableForAllAgents.
    expect(fs.symlink).not.toHaveBeenCalled()
  })

  it('should register built-in skill in DB with legacy is_enabled=false and fan out to agents', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT')) // .version
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValueOnce('# My Skill' as any) // computeHash

    mockRepo.insert.mockResolvedValueOnce({ id: 'new-skill-id', folderName: 'my-skill' })

    await installBuiltinSkills()

    expect(mockRepo.getByFolderName).toHaveBeenCalledWith('my-skill')
    expect(mockRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        folder_name: 'my-skill',
        source: 'builtin',
        // Legacy column — deliberately false in the new per-agent model.
        is_enabled: false
      })
    )
    // First install of this builtin → fan out to every existing agent.
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('new-skill-id', 'my-skill')
  })

  it('should skip skills that are already up to date', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined) // resourceSkillsPath exists
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    // .version file returns current app version
    vi.mocked(fs.readFile).mockResolvedValueOnce('2.0.0' as any)
    // DB already has the skill
    mockRepo.getByFolderName.mockResolvedValueOnce({ id: 'existing', isEnabled: true })

    await installBuiltinSkills()

    expect(fs.cp).not.toHaveBeenCalled()
    // Should not re-insert since files are up to date and DB row exists
    expect(mockRepo.insert).not.toHaveBeenCalled()
    // And should not re-fan-out — user per-agent choices are preserved.
    expect(mockEnableForAllAgents).not.toHaveBeenCalled()
  })

  it('should update skills when app version is newer', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    // Installed version is older
    vi.mocked(fs.readFile).mockResolvedValueOnce('1.0.0' as any)
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValueOnce('# My Skill' as any) // computeHash

    await installBuiltinSkills()

    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '2.0.0', 'utf-8')
  })

  it('should not fan out to all agents when updating an existing built-in skill', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('1.0.0' as any) // older version
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)
    vi.mocked(fs.readFile).mockResolvedValueOnce('# My Skill' as any) // computeHash

    mockRepo.getByFolderName.mockResolvedValueOnce({
      id: 'existing-id',
      isEnabled: false,
      createdAt: 1000
    })

    await installBuiltinSkills()

    // Existing builtin: update metadata in-place (preserves skill ID and agent_skills rows).
    expect(mockRepo.updateMetadata).toHaveBeenCalledWith(
      'existing-id',
      expect.objectContaining({
        name: 'Test Skill'
      })
    )
    // Must NOT delete+insert — that would cascade-drop agent_skills rows.
    expect(mockRepo.delete).not.toHaveBeenCalled()
    expect(mockRepo.insert).not.toHaveBeenCalled()
    // Existing builtin: do NOT re-fan-out; per-agent state survives the metadata refresh.
    expect(mockEnableForAllAgents).not.toHaveBeenCalled()
  })

  it('should skip entries with path traversal in name', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([
      { name: '..', isDirectory: () => true },
      { name: '../etc', isDirectory: () => true }
    ] as any)

    await installBuiltinSkills()

    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(fs.cp).not.toHaveBeenCalled()
  })

  it('should skip non-directory entries', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'README.md', isDirectory: () => false }] as any)

    await installBuiltinSkills()

    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(fs.cp).not.toHaveBeenCalled()
  })

  it('should register DB row and fan out even when files are up to date but row is missing', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('2.0.0' as any) // up to date
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    mockRepo.getByFolderName.mockResolvedValueOnce(null) // but missing from DB
    vi.mocked(fs.readFile).mockResolvedValueOnce('# My Skill' as any) // computeHash
    mockRepo.insert.mockResolvedValueOnce({ id: 'reinserted-id', folderName: 'my-skill' })

    await installBuiltinSkills()

    // Files not copied since up to date
    expect(fs.cp).not.toHaveBeenCalled()
    // But DB row should be created
    expect(mockRepo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        folder_name: 'my-skill',
        source: 'builtin'
      })
    )
    // And since the row was missing, we fan out so existing agents get it.
    expect(mockEnableForAllAgents).toHaveBeenCalledWith('reinserted-id', 'my-skill')
  })
})
