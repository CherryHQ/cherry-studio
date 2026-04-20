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
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

const { mockSyncBuiltinSkill } = vi.hoisted(() => ({
  mockSyncBuiltinSkill: vi.fn()
}))

vi.mock('../services/agents/skills/SkillService', () => ({
  skillService: {
    syncBuiltinSkill: mockSyncBuiltinSkill
  }
}))

// Matches the stub in tests/main.setup.ts → mockApplicationFactory().getPath
const resourceSkillsPath = '/mock/feature.agents.skills.builtin'
const globalSkillsPath = '/mock/feature.agents.skills'

beforeEach(() => {
  vi.clearAllMocks()
  mockSyncBuiltinSkill.mockResolvedValue(undefined)
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
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('ENOENT')) // .version missing → needs update
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    await installBuiltinSkills()

    expect(fs.mkdir).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill'), { recursive: true })
    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '2.0.0', 'utf-8')
    // Per-agent symlinks are handled by SkillService, not here
    expect(fs.symlink).not.toHaveBeenCalled()
    // syncBuiltinSkill called with filesUpdated=true
    expect(mockSyncBuiltinSkill).toHaveBeenCalledWith('my-skill', path.join(globalSkillsPath, 'my-skill'), true)
  })

  it('should skip skills that are already up to date', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('2.0.0' as any) // up to date

    await installBuiltinSkills()

    expect(fs.cp).not.toHaveBeenCalled()
    // syncBuiltinSkill still called, but with filesUpdated=false
    expect(mockSyncBuiltinSkill).toHaveBeenCalledWith('my-skill', path.join(globalSkillsPath, 'my-skill'), false)
  })

  it('should update skills when app version is newer', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('1.0.0' as any) // older version
    vi.mocked(fs.mkdir).mockResolvedValue(undefined as any)
    vi.mocked(fs.cp).mockResolvedValue(undefined)
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    await installBuiltinSkills()

    expect(fs.cp).toHaveBeenCalledWith(
      path.join(resourceSkillsPath, 'my-skill'),
      path.join(globalSkillsPath, 'my-skill'),
      { recursive: true }
    )
    expect(fs.writeFile).toHaveBeenCalledWith(path.join(globalSkillsPath, 'my-skill', '.version'), '2.0.0', 'utf-8')
    expect(mockSyncBuiltinSkill).toHaveBeenCalledWith('my-skill', path.join(globalSkillsPath, 'my-skill'), true)
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
    expect(mockSyncBuiltinSkill).not.toHaveBeenCalled()
  })

  it('should skip non-directory entries', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'README.md', isDirectory: () => false }] as any)

    await installBuiltinSkills()

    expect(fs.mkdir).not.toHaveBeenCalled()
    expect(fs.cp).not.toHaveBeenCalled()
    expect(mockSyncBuiltinSkill).not.toHaveBeenCalled()
  })

  it('should call syncBuiltinSkill even when files are up to date (DB row may be missing)', async () => {
    vi.mocked(fs.access).mockResolvedValueOnce(undefined)
    vi.mocked(fs.readdir).mockResolvedValueOnce([{ name: 'my-skill', isDirectory: () => true }] as any)
    vi.mocked(fs.readFile).mockResolvedValueOnce('2.0.0' as any) // up to date

    await installBuiltinSkills()

    expect(fs.cp).not.toHaveBeenCalled()
    // syncBuiltinSkill is still called with filesUpdated=false so it can
    // insert the DB row if it was missing (e.g. after a DB reset).
    expect(mockSyncBuiltinSkill).toHaveBeenCalledWith('my-skill', path.join(globalSkillsPath, 'my-skill'), false)
  })
})
