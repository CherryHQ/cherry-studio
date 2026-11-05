import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { isWin } from '@main/core/platform'
import { readByPath, writeIfUnchangedByPath } from '@main/services/file'
import { BackupManager } from '@main/services/LegacyBackupManager'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { SkillService } from '../SkillService'

vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: vi.fn().mockResolvedValue({}) }))

const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CONTENT = '---\nname: Example\ndescription: A system skill\n---\nOriginal instructions\n'

describe('system Skill import ownership', () => {
  const dbh = setupTestDatabase()
  let root: string
  let source: string
  let managed: string
  let mirror: string
  let service: SkillService
  let restorePaths: () => void

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'system-skill-')))
    source = path.join(root, '.agents', 'skills', 'example')
    managed = path.join(root, 'Data', 'Skills', 'example')
    mirror = path.join(root, 'Data', 'Agents', '.claude', 'skills', 'example')
    await fs.mkdir(source, { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), CONTENT)
    const paths: Record<string, string> = {
      'sys.home': root,
      'feature.agents.skills': path.dirname(managed),
      'feature.agents.claude.skills': path.dirname(mirror)
    }
    const spy = vi.spyOn(application, 'getPath').mockImplementation((key, filename) => {
      const base = paths[key] ?? path.join(root, key)
      return filename ? path.join(base, filename) : base
    })
    restorePaths = () => spy.mockRestore()
    service = new SkillService()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    restorePaths()
    await fs.rm(root, { recursive: true, force: true })
  })

  it('keeps the default copy independent of later source edits', async () => {
    const skill = await service.importSystem({ directoryPath: source })
    await fs.writeFile(path.join(source, 'SKILL.md'), 'Changed source')
    expect(await fs.readFile(path.join(managed, 'SKILL.md'), 'utf8')).toBe(CONTENT)
    expect(await service.getStorageInfo(skill)).toMatchObject({ mode: 'copy', status: 'ready' })
    await service.uninstall(skill.id)
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe('Changed source')
  })

  it('reads source updates through both managed and runtime links and edits the source', async () => {
    const skill = await service.importSystem({ directoryPath: source, mode: 'symlink' })
    await fs.writeFile(path.join(source, 'SKILL.md'), CONTENT + 'Updated')
    expect(await fs.readFile(path.join(mirror, 'SKILL.md'), 'utf8')).toBe(CONTENT + 'Updated')
    const editable = AbsoluteFilePathSchema.parse(path.join(await service.resolveSkillDirectory(skill), 'SKILL.md'))
    const before = await readByPath(editable, { encoding: 'binary' })
    await writeIfUnchangedByPath(
      editable,
      new TextEncoder().encode('Edited in Cherry'),
      before.version,
      before.contentHash
    )
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe('Edited in Cherry')
    await service.uninstall(skill.id)
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe('Edited in Cherry')
    await expect(fs.lstat(managed)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.lstat(mirror)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves identity and agent enablement through a broken link and recovery', async () => {
    dbh.db
      .insert(agentTable)
      .values({ id: AGENT_ID, type: 'claude-code', name: 'Agent', instructions: '', orderKey: 'a0' })
      .run()
    const skill = await service.importSystem({ directoryPath: source, mode: 'symlink' })
    agentGlobalSkillService.updateGlobalEnabled(skill.id, true)
    service.toggle({ skillId: skill.id, agentId: AGENT_ID, isEnabled: true })
    await fs.rename(source, source + '-away')
    await service.reconcileSkills()
    await service.reconcileSkill(skill.id)
    expect(await service.getStorageInfo(skill)).toMatchObject({ mode: 'symlink', status: 'missing' })
    expect(await service.listAvailable({ agentId: AGENT_ID })).toEqual([])
    expect(dbh.db.select().from(agentSkillTable).all()).toHaveLength(1)
    expect((await service.listCatalog()).map((entry) => entry.id)).toContain(skill.id)
    await fs.rename(source + '-away', source)
    await new SkillService().reconcileSkills()
    expect((await service.listAvailable({ agentId: AGENT_ID })).map((entry) => entry.id)).toEqual([skill.id])
    expect(await fs.readFile(path.join(mirror, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it('restores a linked skill backup as an independent copy and skips broken links', async () => {
    const skill = await service.importSystem({ directoryPath: source, mode: 'symlink' })
    const broken = path.join(path.dirname(managed), 'broken')
    await fs.symlink(path.join(root, 'missing'), broken, isWin ? 'junction' : 'dir')
    const backup = path.join(root, 'backup')
    const manager = new BackupManager()
    await manager['copyDirWithProgress'](path.dirname(managed), backup, () => {}, { dereferenceSymlinks: true })
    expect((await fs.lstat(path.join(backup, 'example'))).isSymbolicLink()).toBe(false)
    await expect(fs.lstat(path.join(backup, 'broken'))).rejects.toMatchObject({ code: 'ENOENT' })
    await fs.unlink(managed)
    await fs.unlink(broken)
    await fs.rename(source, source + '-away')
    await manager['copyDirWithProgress'](backup, path.dirname(managed), () => {}, { dereferenceSymlinks: false })
    await service.reconcileSkills()
    expect(await service.getStorageInfo(skill)).toMatchObject({ mode: 'copy', status: 'ready' })
    expect((await service.list()).map((entry) => entry.id)).toContain(skill.id)
    expect(await fs.readFile(path.join(managed, 'SKILL.md'), 'utf8')).toBe(CONTENT)
    await fs.writeFile(path.join(source + '-away', 'SKILL.md'), 'Changed after backup')
    expect(await fs.readFile(path.join(managed, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it('rejects retargeting without adopting or deleting the new target', async () => {
    const skill = await service.importSystem({ directoryPath: source, mode: 'symlink' })
    const other = path.join(root, 'other')
    await fs.mkdir(other)
    await fs.writeFile(path.join(other, 'SKILL.md'), 'Other')
    await fs.unlink(managed)
    await fs.symlink(other, managed, isWin ? 'junction' : 'dir')
    await service.reconcileSkills()
    expect(await service.getStorageInfo(skill)).toMatchObject({ status: 'invalid' })
    await expect(service.resolveSkillDirectory(skill)).rejects.toThrow('invalid')
    await expect(fs.lstat(mirror)).rejects.toMatchObject({ code: 'ENOENT' })
    await service.uninstall(skill.id)
    expect(await fs.readFile(path.join(other, 'SKILL.md'), 'utf8')).toBe('Other')
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it('rolls back a failed runtime projection without removing source files', async () => {
    vi.spyOn(service, 'linkMirror').mockRejectedValueOnce(new Error('mirror failed'))
    await expect(service.importSystem({ directoryPath: source, mode: 'symlink' })).rejects.toThrow('mirror failed')
    expect(await service.list()).toEqual([])
    await expect(fs.lstat(managed)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it('removes the new link when database registration fails', async () => {
    vi.spyOn(agentGlobalSkillService, 'insertTx').mockImplementationOnce(() => {
      throw new Error('database failed')
    })
    await expect(service.importSystem({ directoryPath: source, mode: 'symlink' })).rejects.toThrow('database failed')
    expect(await service.list()).toEqual([])
    await expect(fs.lstat(managed)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })

  it('does not rename an external lowercase descriptor on a case-sensitive filesystem', async (ctx) => {
    await fs.rename(path.join(source, 'SKILL.md'), path.join(source, 'skill.md'))
    if (
      await fs.access(path.join(source, 'SKILL.md')).then(
        () => true,
        () => false
      )
    )
      ctx.skip()
    await expect(service.importSystem({ directoryPath: source, mode: 'symlink' })).rejects.toThrow()
    expect(await fs.readFile(path.join(source, 'skill.md'), 'utf8')).toBe(CONTENT)
    expect(await service.list()).toEqual([])
  })

  it('does not overwrite a dangling destination or install the same source concurrently', async () => {
    await fs.mkdir(path.dirname(managed), { recursive: true })
    await fs.symlink(path.join(root, 'missing'), managed, isWin ? 'junction' : 'dir')
    await expect(service.importSystem({ directoryPath: source, mode: 'symlink' })).rejects.toThrow('conflicts')
    expect(await fs.readlink(managed)).toBe(path.join(root, 'missing'))
    await fs.unlink(managed)
    const results = await Promise.allSettled([
      service.importSystem({ directoryPath: source, mode: 'symlink' }),
      service.importSystem({ directoryPath: source, mode: 'copy' })
    ])
    expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(await service.list()).toHaveLength(1)
    expect(await fs.readFile(path.join(source, 'SKILL.md'), 'utf8')).toBe(CONTENT)
  })
})
