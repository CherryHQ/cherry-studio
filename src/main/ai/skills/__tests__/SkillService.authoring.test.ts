import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchRemoteSkillMock = vi.hoisted(() => vi.fn())
const notifyDataApiDataChangeMock = vi.hoisted(() => vi.fn())

vi.mock('../skillRemoteSource', () => ({ fetchRemoteSkill: fetchRemoteSkillMock }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

import { SkillInstaller } from '../SkillInstaller'
import { SkillService } from '../SkillService'

const SKILL_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_SKILL_ID = '22222222-2222-4222-8222-222222222222'
const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const INSTALL_SOURCE = 'skills.sh:owner/repo/writer'

describe('SkillService authoring and remote updates', () => {
  const dbh = setupTestDatabase()
  const tempDirs: string[] = []
  const installer = new SkillInstaller()
  let root: string
  let skillsRoot: string
  let mirrorRoot: string
  let getPathSpy: { mockRestore: () => void }

  async function makeTempDir(prefix: string): Promise<string> {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), prefix))
    tempDirs.push(directory)
    return directory
  }

  async function writeSkill(
    directory: string,
    options: { name?: string; version?: string; body?: string; supportingContent?: string } = {}
  ): Promise<void> {
    const name = options.name ?? path.basename(directory)
    const version = options.version ?? '1.0.0'
    await fs.promises.mkdir(path.join(directory, 'scripts'), { recursive: true })
    await fs.promises.writeFile(
      path.join(directory, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} description\nversion: ${version}\n---\n\n${options.body ?? '# Instructions'}\n`,
      'utf-8'
    )
    await fs.promises.writeFile(
      path.join(directory, 'scripts', 'run.sh'),
      options.supportingContent ?? 'echo original\n',
      'utf-8'
    )
  }

  async function seedSkill(
    id: string,
    folderName: string,
    options: {
      source?: string
      installSource?: string | null
      upstreamHash?: string | null
      isEnabled?: boolean
      updatedAt?: number
    } = {}
  ): Promise<void> {
    const directory = path.join(skillsRoot, folderName)
    const contentHash = await installer.computeContentHash(directory)
    await dbh.db.insert(agentGlobalSkillTable).values({
      id,
      name: folderName,
      folderName,
      source: options.source ?? 'marketplace',
      contentHash,
      installSource: options.installSource ?? null,
      upstreamHash: options.upstreamHash ?? null,
      isEnabled: options.isEnabled ?? true,
      updatedAt: options.updatedAt
    })
  }

  async function createFetchedSkill(version: string, supportingContent: string) {
    const tempDir = await makeTempDir('skill-remote-')
    const skillDir = path.join(tempDir, 'writer')
    await writeSkill(skillDir, { name: 'writer', version, supportingContent })
    return { tempDir, skillDir, sourceUrl: 'https://github.com/owner/repo' }
  }

  beforeEach(async () => {
    root = await makeTempDir('skill-authoring-')
    skillsRoot = path.join(root, 'Data', 'Skills')
    mirrorRoot = path.join(root, 'Data', 'Agents', '.claude', 'skills')
    await Promise.all([
      fs.promises.mkdir(skillsRoot, { recursive: true }),
      fs.promises.mkdir(mirrorRoot, { recursive: true })
    ])
    getPathSpy = vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
      const roots: Record<string, string> = {
        'feature.agents.skills': skillsRoot,
        'feature.agents.claude.skills': mirrorRoot,
        'feature.agents.skills.install.temp': path.join(root, 'temp')
      }
      const resolved = roots[key] ?? path.join(root, key)
      return filename ? path.join(resolved, filename) : resolved
    })
    fetchRemoteSkillMock.mockReset()
    notifyDataApiDataChangeMock.mockReset()
  })

  afterEach(async () => {
    getPathSpy.mockRestore()
    await Promise.all(
      tempDirs.splice(0).map((directory) => fs.promises.rm(directory, { recursive: true, force: true }))
    )
  })

  it('reconciles only the edited Skill after a supporting-file change', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    const otherDir = path.join(skillsRoot, 'other')
    await writeSkill(skillDir)
    await writeSkill(otherDir)
    await seedSkill(SKILL_ID, 'writer', { updatedAt: 10 })
    await seedSkill(OTHER_SKILL_ID, 'other', { updatedAt: 20 })
    await fs.promises.writeFile(path.join(skillDir, 'scripts', 'run.sh'), 'echo changed\n', 'utf-8')

    await new SkillService().reconcileSkill(SKILL_ID)

    const updated = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID)).get()
    const untouched = dbh.db
      .select()
      .from(agentGlobalSkillTable)
      .where(eq(agentGlobalSkillTable.id, OTHER_SKILL_ID))
      .get()
    expect(updated?.updatedAt).toBeGreaterThan(10)
    expect(untouched?.updatedAt).toBe(20)
    await expect(fs.promises.readFile(path.join(mirrorRoot, 'writer', 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo changed\n'
    )
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/skills', kind: 'projection', entityIds: [SKILL_ID] },
      { endpoint: '/skills/:skillId', entityIds: [SKILL_ID] }
    ])
  })

  it('rejects scoped reconciliation for a built-in Skill', async () => {
    const skillDir = path.join(skillsRoot, 'builtin')
    await writeSkill(skillDir)
    await seedSkill(SKILL_ID, 'builtin', { source: 'builtin' })

    await expect(new SkillService().reconcileSkill(SKILL_ID)).rejects.toThrow('read-only')
    expect(agentGlobalSkillService.getById(SKILL_ID)).not.toBeNull()
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('keeps the catalog row but removes its mirror when the edited descriptor becomes unreadable', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    await seedSkill(SKILL_ID, 'writer')
    const service = new SkillService()
    await service.linkMirror('writer')
    await fs.promises.rm(path.join(skillDir, 'SKILL.md'))
    await fs.promises.mkdir(path.join(skillDir, 'SKILL.md'))

    await expect(service.reconcileSkill(SKILL_ID)).rejects.toThrow()

    expect(agentGlobalSkillService.getById(SKILL_ID)).not.toBeNull()
    await expect(fs.promises.lstat(path.join(mirrorRoot, 'writer'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('prunes a missing target Skill and its agent association without scanning other Skills', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    await seedSkill(SKILL_ID, 'writer')
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Agent',
      instructions: '',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID, isEnabled: true })
    await fs.promises.rm(skillDir, { recursive: true })

    await new SkillService().reconcileSkill(SKILL_ID)

    expect(agentGlobalSkillService.getById(SKILL_ID)).toBeNull()
    expect(dbh.db.select().from(agentSkillTable).all()).toEqual([])
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/skills', kind: 'membership', entityIds: [SKILL_ID] },
      { endpoint: '/skills', kind: 'membership', dimension: 'agentId', entityIds: [SKILL_ID] },
      { endpoint: '/skills/:skillId', entityIds: [SKILL_ID] }
    ])
  })

  it('stores exact remote provenance and derives only safe renderer update fields on install', async () => {
    const fetched = await createFetchedSkill('1.0.0', 'echo installed\n')
    const upstreamHash = await installer.computeDirectoryHash(fetched.skillDir)
    const onInstalled = vi.fn()
    fetchRemoteSkillMock.mockResolvedValue({ ...fetched, onInstalled })

    const installed = await new SkillService().install({ installSource: INSTALL_SOURCE })

    const row = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, installed.id)).get()
    expect(row).toMatchObject({ installSource: INSTALL_SOURCE, upstreamHash })
    expect(installed).toMatchObject({ sourceRegistry: 'skills.sh', canUpdateFromRemote: true })
    expect(installed).not.toHaveProperty('installSource')
    expect(onInstalled).toHaveBeenCalledOnce()
    await expect(fs.promises.access(fetched.tempDir)).rejects.toThrow()
  })

  it('checks a dirty Skill, refuses implicit overwrite, then applies the confirmed remote version in place', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    const upstreamHash = await installer.computeDirectoryHash(skillDir)
    await seedSkill(SKILL_ID, 'writer', { installSource: INSTALL_SOURCE, upstreamHash, isEnabled: false })
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Agent',
      instructions: '',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID, isEnabled: true })
    await fs.promises.writeFile(path.join(skillDir, 'scripts', 'run.sh'), 'echo local\n', 'utf-8')
    const fetchedTempDirs: string[] = []
    fetchRemoteSkillMock.mockImplementation(async () => {
      const fetched = await createFetchedSkill('2.0.0', 'echo remote\n')
      fetchedTempDirs.push(fetched.tempDir)
      return fetched
    })
    const service = new SkillService()

    const check = await service.checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'available', localChanges: true, remoteVersion: '2.0.0' })
    if (check.state !== 'available') throw new Error('Expected an available update')

    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: check.revision, overwriteLocalChanges: false })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_LOCAL_CHANGES })
    await expect(fs.promises.readFile(path.join(skillDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo local\n')

    const updated = await service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: check.revision,
      overwriteLocalChanges: true
    })
    expect(updated).toMatchObject({ id: SKILL_ID, version: '2.0.0', isGlobalEnabled: false })
    expect(dbh.db.select().from(agentSkillTable).get()).toMatchObject({
      agentId: AGENT_ID,
      skillId: SKILL_ID,
      isEnabled: true
    })
    await expect(fs.promises.readFile(path.join(skillDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo remote\n')
    const row = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID)).get()
    expect(row?.upstreamHash).toBe(await installer.computeDirectoryHash(skillDir))
    for (const tempDir of fetchedTempDirs) {
      await expect(fs.promises.access(tempDir)).rejects.toThrow()
    }
  })

  it('leaves files and provenance unchanged when remote publication fails', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    const upstreamHash = await installer.computeDirectoryHash(skillDir)
    await seedSkill(SKILL_ID, 'writer', { installSource: INSTALL_SOURCE, upstreamHash })
    let fetchedTempDir = ''
    fetchRemoteSkillMock.mockImplementation(async () => {
      const fetched = await createFetchedSkill('2.0.0', 'echo remote\n')
      fetchedTempDir = fetched.tempDir
      return fetched
    })
    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    if (check.state !== 'available') throw new Error('Expected an available update')
    const installSpy = vi.spyOn(SkillInstaller.prototype, 'install').mockRejectedValueOnce(new Error('publish failed'))

    try {
      await expect(
        service.applyRemoteUpdate({ skillId: SKILL_ID, revision: check.revision, overwriteLocalChanges: false })
      ).rejects.toThrow('publish failed')
    } finally {
      installSpy.mockRestore()
    }

    await expect(fs.promises.readFile(path.join(skillDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo baseline\n'
    )
    const row = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID)).get()
    expect(row).toMatchObject({ version: null, installSource: INSTALL_SOURCE, upstreamHash })
    await expect(fs.promises.access(fetchedTempDir)).rejects.toThrow()
  })

  it('rejects a stale checked revision before replacing the local folder', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    const upstreamHash = await installer.computeDirectoryHash(skillDir)
    await seedSkill(SKILL_ID, 'writer', { installSource: INSTALL_SOURCE, upstreamHash })
    fetchRemoteSkillMock.mockImplementation(() => createFetchedSkill('2.0.0', 'echo remote\n'))
    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    if (check.state !== 'available') throw new Error('Expected an available update')
    await fs.promises.writeFile(path.join(skillDir, 'scripts', 'run.sh'), 'echo changed-after-check\n', 'utf-8')

    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: check.revision, overwriteLocalChanges: true })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_STALE })
    await expect(fs.promises.readFile(path.join(skillDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo changed-after-check\n'
    )
  })

  it('does not guess provenance for old marketplace rows or modify files after a network failure', async () => {
    const oldSkillDir = path.join(skillsRoot, 'writer')
    await writeSkill(oldSkillDir)
    await seedSkill(SKILL_ID, 'writer')
    const service = new SkillService()

    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toEqual({
      state: 'unsupported',
      reason: 'missing_provenance'
    })

    const upstreamHash = await installer.computeDirectoryHash(oldSkillDir)
    await dbh.db
      .update(agentGlobalSkillTable)
      .set({ installSource: INSTALL_SOURCE, upstreamHash })
      .where(eq(agentGlobalSkillTable.id, SKILL_ID))
    fetchRemoteSkillMock.mockRejectedValue(new Error('offline'))
    await expect(service.checkRemoteUpdate(SKILL_ID)).rejects.toThrow('offline')
    await expect(fs.promises.readFile(path.join(oldSkillDir, 'SKILL.md'), 'utf-8')).resolves.toContain('version: 1.0.0')
  })
})
