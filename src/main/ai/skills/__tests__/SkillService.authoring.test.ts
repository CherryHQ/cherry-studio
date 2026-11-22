import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'

import { setupTestDatabase } from '@test-helpers/db'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { isWin } from '@main/core/platform'
import { readByPath, writeIfUnchangedByPath } from '@main/services/file'
import { PathStaleVersionError } from '@main/utils/file'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import type { AbsoluteFilePath } from '@shared/types/file'
import { hasSkillRemoteUpdateProvenance } from '@shared/utils/skillMarketplace'

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
const SOURCE_URL = 'https://skills.sh/owner/repo/writer'

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
      sourceUrl?: string | null
      contentHash?: string
      isEnabled?: boolean
      updatedAt?: number
    } = {}
  ): Promise<void> {
    const directory = path.join(skillsRoot, folderName)
    const contentHash = options.contentHash ?? (await installer.computeContentHash(directory))
    await dbh.db.insert(agentGlobalSkillTable).values({
      id,
      name: folderName,
      description: `${folderName} description`,
      folderName,
      source: options.source ?? 'marketplace',
      sourceUrl:
        options.sourceUrl === undefined ? (options.source === 'builtin' ? null : SOURCE_URL) : options.sourceUrl,
      version: '1.0.0',
      contentHash,
      isEnabled: options.isEnabled ?? true,
      updatedAt: options.updatedAt
    })
  }

  async function createFetchedSkill(version: string, supportingContent: string) {
    const tempDir = await makeTempDir('skill-remote-')
    const skillDir = path.join(tempDir, 'writer')
    await writeSkill(skillDir, { name: 'writer', version, supportingContent })
    return { tempDir, skillDir, sourceUrl: SOURCE_URL }
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
    const baseline = await installer.computeContentHash(skillDir)
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
    expect(updated).toMatchObject({ contentHash: baseline, updatedAt: 10 })
    expect(untouched?.updatedAt).toBe(20)
    await expect(fs.promises.readFile(path.join(mirrorRoot, 'writer', 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo changed\n'
    )
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('reconciles edited metadata without replacing the installation baseline', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    const baseline = await installer.computeContentHash(skillDir)
    await seedSkill(SKILL_ID, 'writer', { updatedAt: 10 })
    await writeSkill(skillDir, { version: '2.0.0' })

    await new SkillService().reconcileSkill(SKILL_ID)

    const updated = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID)).get()
    expect(updated).toMatchObject({ version: '2.0.0', contentHash: baseline })
    expect(updated?.updatedAt).toBeGreaterThan(10)
    expect(notifyDataApiDataChangeMock).toHaveBeenCalledExactlyOnceWith([
      { endpoint: '/skills', kind: 'projection', entityIds: [SKILL_ID] },
      { endpoint: '/skills/:skillId', entityIds: [SKILL_ID] }
    ])
  })

  it('keeps the installation baseline during full library reconciliation', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    const baseline = await installer.computeContentHash(skillDir)
    await seedSkill(SKILL_ID, 'writer', { updatedAt: 10 })
    await writeSkill(skillDir, { version: '2.0.0', supportingContent: 'echo locally edited\n' })

    await new SkillService().reconcileSkills()

    const updated = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID)).get()
    expect(updated).toMatchObject({ version: '2.0.0', contentHash: baseline })
    expect(updated?.updatedAt).toBeGreaterThan(10)
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

  it('stores the exact Skill source URL and full-directory installation baseline', async () => {
    const fetched = await createFetchedSkill('1.0.0', 'echo installed\n')
    const contentHash = await installer.computeContentHash(fetched.skillDir)
    const onInstalled = vi.fn()
    fetchRemoteSkillMock.mockResolvedValue({ ...fetched, onInstalled })

    const installed = await new SkillService().install({ installSource: INSTALL_SOURCE })

    const row = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, installed.id)).get()
    expect(row).toMatchObject({ sourceUrl: SOURCE_URL, contentHash })
    expect(hasSkillRemoteUpdateProvenance(installed)).toBe(true)
    expect(fetchRemoteSkillMock).toHaveBeenCalledExactlyOnceWith('skills.sh', 'owner/repo/writer')
    expect(onInstalled).toHaveBeenCalledOnce()
    await expect(fs.promises.access(fetched.tempDir)).rejects.toThrow()
  })

  it('upgrades a legacy skills.sh repo-root source through an explicit exact reinstall', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    await seedSkill(SKILL_ID, 'writer', {
      sourceUrl: 'https://github.com/owner/repo',
      contentHash: 'legacy-skill-md-hash'
    })
    const fetched = await createFetchedSkill('2.0.0', 'echo upgraded\n')
    fetchRemoteSkillMock.mockResolvedValue(fetched)

    const installed = await new SkillService().install({ installSource: INSTALL_SOURCE })

    expect(installed).toMatchObject({ id: SKILL_ID, sourceUrl: SOURCE_URL, version: '2.0.0' })
    expect(hasSkillRemoteUpdateProvenance(installed)).toBe(true)
  })

  it('checks a dirty Skill, refuses implicit overwrite, then applies the confirmed remote version in place', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    await seedSkill(SKILL_ID, 'writer', { isEnabled: false })
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
    expect(row?.contentHash).toBe(await installer.computeContentHash(skillDir))
    for (const tempDir of fetchedTempDirs) {
      await expect(fs.promises.access(tempDir)).rejects.toThrow()
    }
  })

  it('leaves files and the installation baseline unchanged when remote publication fails', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    const contentHash = await installer.computeContentHash(skillDir)
    await seedSkill(SKILL_ID, 'writer')
    let fetchedTempDir = ''
    fetchRemoteSkillMock.mockImplementation(async () => {
      const fetched = await createFetchedSkill('2.0.0', 'echo remote\n')
      fetchedTempDir = fetched.tempDir
      return fetched
    })
    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    if (check.state !== 'available') throw new Error('Expected an available update')
    const installSpy = vi
      .spyOn(SkillInstaller.prototype, 'prepareInstall')
      .mockRejectedValueOnce(new Error('publish failed'))

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
    expect(row).toMatchObject({ version: '1.0.0', sourceUrl: SOURCE_URL, contentHash })
    await expect(fs.promises.access(fetchedTempDir)).rejects.toThrow()
  })

  it('restores files and metadata when mirror publication fails after replacement', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    const contentHash = await installer.computeContentHash(skillDir)
    await seedSkill(SKILL_ID, 'writer')
    fetchRemoteSkillMock.mockImplementation(() => createFetchedSkill('2.0.0', 'echo remote\n'))
    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    if (check.state !== 'available') throw new Error('Expected an available update')
    const mirrorSpy = vi
      .spyOn(service, 'linkMirror')
      .mockRejectedValueOnce(new Error('mirror failed'))
      .mockResolvedValueOnce(false)

    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: check.revision, overwriteLocalChanges: false })
    ).rejects.toThrow('mirror failed')

    await expect(fs.promises.readFile(path.join(skillDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo baseline\n'
    )
    expect(agentGlobalSkillService.getById(SKILL_ID)).toMatchObject({
      version: '1.0.0',
      sourceUrl: SOURCE_URL,
      contentHash
    })
    expect(mirrorSpy).toHaveBeenCalledTimes(2)
    expect(notifyDataApiDataChangeMock).not.toHaveBeenCalled()
  })

  it('serializes editor writes with remote replacement so the write fails stale instead of being lost', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    await seedSkill(SKILL_ID, 'writer')
    fetchRemoteSkillMock.mockImplementation(() => createFetchedSkill('2.0.0', 'echo remote\n'))
    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    if (check.state !== 'available') throw new Error('Expected an available update')

    const target = path.join(skillDir, 'scripts', 'run.sh') as AbsoluteFilePath
    const snapshot = await readByPath(target, { encoding: 'binary' })
    const originalPrepare = service['installer'].prepareInstall.bind(service['installer'])
    let releasePrepare!: () => void
    let signalPrepareStarted!: () => void
    const prepareStarted = new Promise<void>((resolve) => (signalPrepareStarted = resolve))
    const prepareGate = new Promise<void>((resolve) => (releasePrepare = resolve))
    vi.spyOn(service['installer'], 'prepareInstall').mockImplementation(async (...args) => {
      signalPrepareStarted()
      await prepareGate
      return originalPrepare(...args)
    })

    const update = service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: check.revision,
      overwriteLocalChanges: false
    })
    await prepareStarted

    let writeSettled = false
    const write = writeIfUnchangedByPath(
      target,
      new TextEncoder().encode('echo editor\n'),
      snapshot.version,
      snapshot.contentHash
    ).finally(() => (writeSettled = true))
    void write.catch(() => undefined)
    await Promise.resolve()
    expect(writeSettled).toBe(false)

    releasePrepare()
    await update
    await expect(write).rejects.toBeInstanceOf(PathStaleVersionError)
    await expect(fs.promises.readFile(target, 'utf-8')).resolves.toBe('echo remote\n')
  })

  it('rejects a stale checked revision before replacing the local folder', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    await seedSkill(SKILL_ID, 'writer')
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

  it('does not treat a legacy SKILL.md-only hash as an installation baseline', async () => {
    const oldSkillDir = path.join(skillsRoot, 'writer')
    await writeSkill(oldSkillDir)
    await seedSkill(SKILL_ID, 'writer', { contentHash: 'legacy-skill-md-hash' })
    const service = new SkillService()

    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toEqual({
      state: 'unsupported',
      reason: 'missing_provenance'
    })

    const contentHash = await installer.computeContentHash(oldSkillDir)
    await dbh.db.update(agentGlobalSkillTable).set({ contentHash }).where(eq(agentGlobalSkillTable.id, SKILL_ID))
    fetchRemoteSkillMock.mockRejectedValue(new Error('offline'))
    await expect(service.checkRemoteUpdate(SKILL_ID)).rejects.toThrow('offline')
    await expect(fs.promises.readFile(path.join(oldSkillDir, 'SKILL.md'), 'utf-8')).resolves.toContain('version: 1.0.0')
  })

  it('checks and applies a system skill update from its file origin in place', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: await installer.computeContentHash(canonicalOrigin)
    })
    await dbh.db.insert(agentTable).values({
      id: AGENT_ID,
      type: 'claude-code',
      name: 'Agent',
      instructions: '',
      model: null,
      orderKey: 'a0'
    })
    await dbh.db.insert(agentSkillTable).values({ agentId: AGENT_ID, skillId: SKILL_ID, isEnabled: true })
    // Diverge the managed copy, then publish a new version at the source folder.
    await fs.promises.writeFile(path.join(installedDir, 'scripts', 'run.sh'), 'echo local\n', 'utf-8')
    await writeSkill(originDir, { version: '2.0.0', supportingContent: 'echo remote\n' })
    const service = new SkillService()

    const check = await service.checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'available', localChanges: true, remoteVersion: '2.0.0' })
    if (check.state !== 'available') throw new Error('Expected an available update')

    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: check.revision, overwriteLocalChanges: false })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_LOCAL_CHANGES })
    await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo local\n'
    )

    const updated = await service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: check.revision,
      overwriteLocalChanges: true
    })
    expect(updated).toMatchObject({ id: SKILL_ID, source: 'system', version: '2.0.0' })
    // Identity and per-agent enablement survive the update: no row is deleted or re-inserted.
    expect(dbh.db.select().from(agentSkillTable).get()).toMatchObject({
      agentId: AGENT_ID,
      skillId: SKILL_ID,
      isEnabled: true
    })
    await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo remote\n'
    )
    const row = dbh.db.select().from(agentGlobalSkillTable).where(eq(agentGlobalSkillTable.id, SKILL_ID)).get()
    expect(row?.contentHash).toBe(await installer.computeContentHash(installedDir))
    expect(fetchRemoteSkillMock).not.toHaveBeenCalled()
  })

  it('reports a system skill as up to date when its file origin matches the install baseline', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir)
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: await installer.computeContentHash(canonicalOrigin)
    })

    await expect(new SkillService().checkRemoteUpdate(SKILL_ID)).resolves.toMatchObject({
      state: 'up_to_date',
      localChanges: false,
      remoteVersion: '1.0.0'
    })
    expect(fetchRemoteSkillMock).not.toHaveBeenCalled()
  })

  it('does not offer updates for system skills without file provenance or for local sources', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    await seedSkill(SKILL_ID, 'writer', { source: 'system', sourceUrl: 'https://example.com/skills/writer' })
    const service = new SkillService()

    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toEqual({
      state: 'unsupported',
      reason: 'missing_provenance'
    })
    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: 'unused', overwriteLocalChanges: false })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_UNSUPPORTED })

    await dbh.db
      .update(agentGlobalSkillTable)
      .set({ source: 'local', sourceUrl: null })
      .where(eq(agentGlobalSkillTable.id, SKILL_ID))
    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toEqual({
      state: 'unsupported',
      reason: 'not_remote'
    })
    expect(fetchRemoteSkillMock).not.toHaveBeenCalled()
  })

  it('does not offer remote updates for Clawhub provenance without a China-capable transport', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir)
    await seedSkill(SKILL_ID, 'writer', { sourceUrl: 'https://clawhub.ai/owner/skills/writer' })
    const service = new SkillService()

    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toEqual({
      state: 'unsupported',
      reason: 'missing_provenance'
    })
    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: 'unused', overwriteLocalChanges: false })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_UNSUPPORTED })
    expect(fetchRemoteSkillMock).not.toHaveBeenCalled()
  })

  it('refreshes a system skill whose source occupies its own export destination without deleting the source', async () => {
    const externalRoot = application.getPath('external.agents.skills')
    const sourceDir = path.join(externalRoot, 'writer')
    await fs.promises.mkdir(sourceDir, { recursive: true })
    await writeSkill(sourceDir, { supportingContent: 'echo baseline\n' })
    const canonicalSource = await fs.promises.realpath(sourceDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalSource, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalSource).href,
      contentHash: await installer.computeContentHash(canonicalSource)
    })
    MockMainPreferenceServiceUtils.setPreferenceValue('agent.skills.external_export.enabled', true)
    try {
      await writeSkill(sourceDir, { version: '2.0.0', supportingContent: 'echo remote\n' })
      const service = new SkillService()

      const check = await service.checkRemoteUpdate(SKILL_ID)
      expect(check).toMatchObject({ state: 'available', localChanges: false })
      if (check.state !== 'available') throw new Error('Expected an available update')

      const updated = await service.applyRemoteUpdate({
        skillId: SKILL_ID,
        revision: check.revision,
        overwriteLocalChanges: false
      })
      expect(updated).toMatchObject({ id: SKILL_ID, version: '2.0.0' })
      await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
        'echo remote\n'
      )
      // The user-owned source occupies the export destination: it must survive as a real
      // directory with the new source content, not be replaced by an export symlink.
      const sourceStat = await fs.promises.lstat(canonicalSource)
      expect(sourceStat.isDirectory()).toBe(true)
      expect(sourceStat.isSymbolicLink()).toBe(false)
      await expect(fs.promises.readFile(path.join(canonicalSource, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
        'echo remote\n'
      )
      await expect(fs.promises.readFile(path.join(mirrorRoot, 'writer', 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
        'echo remote\n'
      )

      // Explicit re-sync uses the same export-tolerant path and also preserves the source.
      await fs.promises.writeFile(path.join(installedDir, 'scripts', 'run.sh'), 'echo local\n', 'utf-8')
      const resynced = await service['resyncSystemSkill'](SKILL_ID, canonicalSource, null, SKILL_ID)
      expect(resynced).toMatchObject({ id: SKILL_ID, version: '2.0.0' })
      await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
        'echo remote\n'
      )
      const preservedStat = await fs.promises.lstat(canonicalSource)
      expect(preservedStat.isDirectory()).toBe(true)
      expect(preservedStat.isSymbolicLink()).toBe(false)
    } finally {
      MockMainPreferenceServiceUtils.setPreferenceValue('agent.skills.external_export.enabled', false)
    }
  })

  it('normalizes a lowercase descriptor without reporting false local changes', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await fs.promises.mkdir(path.join(originDir, 'scripts'), { recursive: true })
    await fs.promises.writeFile(
      path.join(originDir, 'skill.md'),
      '---\nname: writer\ndescription: writer description\nversion: 1.0.0\n---\n\n# Instructions\n',
      'utf-8'
    )
    await fs.promises.writeFile(path.join(originDir, 'scripts', 'run.sh'), 'echo baseline\n', 'utf-8')
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: await installer.computeContentHash(canonicalOrigin)
    })
    const service = new SkillService()
    await service.reconcileSkill(SKILL_ID)

    await expect(fs.promises.access(path.join(installedDir, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toMatchObject({
      state: 'up_to_date',
      localChanges: false
    })

    await fs.promises.writeFile(
      path.join(originDir, 'skill.md'),
      '---\nname: writer\ndescription: writer description\nversion: 2.0.0\n---\n\n# Instructions\n',
      'utf-8'
    )
    const check = await service.checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'available', localChanges: false })
    if (check.state !== 'available') throw new Error('Expected an available update')
    const updated = await service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: check.revision,
      overwriteLocalChanges: false
    })
    expect(updated).toMatchObject({ version: '2.0.0' })
    await expect(fs.promises.access(path.join(installedDir, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(fs.promises.readFile(path.join(installedDir, 'SKILL.md'), 'utf-8')).resolves.toContain(
      'version: 2.0.0'
    )
  })

  it('heals a stale baseline when the managed tree matches its source', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir)
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: 'directory-sha256:0000000000000000000000000000000000000000000000000000000000000000'
    })

    const check = await new SkillService().checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'up_to_date', localChanges: false })
    const healed = agentGlobalSkillService.getById(SKILL_ID)
    expect(healed?.contentHash).toBe(await installer.computeContentHash(installedDir))
    expect(healed?.contentHash).not.toBe(
      'directory-sha256:0000000000000000000000000000000000000000000000000000000000000000'
    )
  })

  it('recovers the matching tree when a crash leaves new files with a new baseline', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const cleanupPath = path.join(skillsRoot, '.writer.cleanup')
    const oldDir = path.join(root, 'old')
    const newDir = path.join(root, 'new')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.rm(cleanupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const newHash = await installer.computeContentHash(newDir)
    const oldHash = await installer.computeContentHash(oldDir)

    // Crash after SQLite committed the new hash but before prepared.commit():
    // the new tree matches the baseline, so recovery must keep it, not restore old.
    await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })

    // Crash after prepare but before the database write: the old backup matches the
    // old baseline, so recovery must roll the partial replacement back.
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    await installer.recoverInterruptedInstallWithBaseline(destPath, oldHash)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo old\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })

    // Committed backup (.cleanup) with a new baseline keeps the new tree.
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(cleanupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, cleanupPath, { recursive: true })
    await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.lstat(cleanupPath)).rejects.toMatchObject({ code: 'ENOENT' })

    // Committed backup with an old baseline restores the matching old tree.
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(cleanupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, cleanupPath, { recursive: true })
    await installer.recoverInterruptedInstallWithBaseline(destPath, oldHash)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo old\n')
    await expect(fs.promises.lstat(cleanupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('includes a newly added helper file during system re-sync', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: await installer.computeContentHash(canonicalOrigin)
    })
    await fs.promises.writeFile(path.join(originDir, 'scripts', 'helper.sh'), 'echo helper\n', 'utf-8')
    await writeSkill(originDir, { version: '2.0.0', supportingContent: 'echo baseline\n' })
    await fs.promises.writeFile(path.join(originDir, 'scripts', 'helper.sh'), 'echo helper\n', 'utf-8')

    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'available', localChanges: false })
    if (check.state !== 'available') throw new Error('Expected an available update')
    const updated = await service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: check.revision,
      overwriteLocalChanges: false
    })
    expect(updated).toMatchObject({ version: '2.0.0' })
    await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'helper.sh'), 'utf-8')).resolves.toBe(
      'echo helper\n'
    )
  })

  it('aborts re-sync and preserves the previous installation when the source keeps changing', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    const baseline = await installer.computeContentHash(canonicalOrigin)
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: baseline
    })
    const service = new SkillService()
    const computeSpy = vi
      .spyOn(service['installer'], 'computeDirectoryHash')
      .mockImplementation(async (directory: string) => {
        if (directory.includes('skill-local-update-')) return 'a'.repeat(64)
        if (directory === canonicalOrigin) return 'b'.repeat(64)
        return installer.computeDirectoryHash(directory)
      })
    try {
      await expect(service['resyncSystemSkill'](SKILL_ID, canonicalOrigin, null, SKILL_ID)).rejects.toThrow(
        /changed during snapshot/
      )
    } finally {
      computeSpy.mockRestore()
    }
    await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo baseline\n'
    )
    expect(agentGlobalSkillService.getById(SKILL_ID)).toMatchObject({ contentHash: baseline })
  })

  it.skipIf(isWin)('detects a mode-only source change and protects a managed mode edit', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
    const helperPath = path.join(originDir, 'scripts', 'run.sh')
    await fs.promises.chmod(helperPath, 0o644)
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: await installer.computeContentHash(canonicalOrigin)
    })
    const service = new SkillService()

    await fs.promises.chmod(helperPath, 0o755)
    const modeCheck = await service.checkRemoteUpdate(SKILL_ID)
    expect(modeCheck).toMatchObject({ state: 'available', localChanges: false })
    if (modeCheck.state !== 'available') throw new Error('Expected an available mode-only update')
    const modeUpdated = await service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: modeCheck.revision,
      overwriteLocalChanges: false
    })
    expect(modeUpdated).toMatchObject({ id: SKILL_ID })
    expect((await fs.promises.stat(path.join(installedDir, 'scripts', 'run.sh'))).mode & 0o111).not.toBe(0)

    await fs.promises.chmod(path.join(installedDir, 'scripts', 'run.sh'), 0o644)
    await fs.promises.chmod(helperPath, 0o644)
    const healedBaseline = await installer.computeContentHash(installedDir)
    await dbh.db
      .update(agentGlobalSkillTable)
      .set({ contentHash: healedBaseline })
      .where(eq(agentGlobalSkillTable.id, SKILL_ID))

    await fs.promises.chmod(path.join(installedDir, 'scripts', 'run.sh'), 0o755)
    await expect(service.checkRemoteUpdate(SKILL_ID)).resolves.toMatchObject({
      state: 'up_to_date',
      localChanges: true
    })

    await writeSkill(originDir, { version: '2.0.0', supportingContent: 'echo baseline\n' })
    await fs.promises.chmod(path.join(originDir, 'scripts', 'run.sh'), 0o644)
    const contentCheck = await service.checkRemoteUpdate(SKILL_ID)
    expect(contentCheck).toMatchObject({ state: 'available', localChanges: true })
    if (contentCheck.state !== 'available') throw new Error('Expected an available content update')
    await expect(
      service.applyRemoteUpdate({
        skillId: SKILL_ID,
        revision: contentCheck.revision,
        overwriteLocalChanges: false
      })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_LOCAL_CHANGES })
    const overwritten = await service.applyRemoteUpdate({
      skillId: SKILL_ID,
      revision: contentCheck.revision,
      overwriteLocalChanges: true
    })
    expect(overwritten).toMatchObject({ version: '2.0.0' })
    expect((await fs.promises.stat(path.join(installedDir, 'scripts', 'run.sh'))).mode & 0o111).toBe(0)
  })
})
