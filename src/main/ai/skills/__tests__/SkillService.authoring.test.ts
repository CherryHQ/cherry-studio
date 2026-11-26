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

  it.skipIf(isWin)(
    'applies a pending update for an untouched legacy executable baseline without overwrite',
    async () => {
      const originDir = path.join(root, 'origin', 'writer')
      await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
      const helperPath = path.join(originDir, 'scripts', 'run.sh')
      await fs.promises.chmod(helperPath, 0o755)
      const canonicalOrigin = await fs.promises.realpath(originDir)
      const installedDir = path.join(skillsRoot, 'writer')
      await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
      // Seed the pre-upgrade (no mode bits) baseline: the managed tree is untouched
      // but the current fingerprint differs due to the format migration alone.
      const legacyBaseline = await installer.computeLegacyContentHash(installedDir)
      const currentFingerprint = await installer.computeContentHash(installedDir)
      expect(currentFingerprint).not.toBe(legacyBaseline)
      await seedSkill(SKILL_ID, 'writer', {
        source: 'system',
        sourceUrl: pathToFileURL(canonicalOrigin).href,
        contentHash: legacyBaseline
      })

      await writeSkill(originDir, { version: '2.0.0', supportingContent: 'echo remote\n' })
      await fs.promises.chmod(path.join(originDir, 'scripts', 'run.sh'), 0o755)
      const service = new SkillService()

      const check = await service.checkRemoteUpdate(SKILL_ID)
      expect(check).toMatchObject({ state: 'available', localChanges: false })
      if (check.state !== 'available') throw new Error('Expected an available update for legacy baseline')

      const updated = await service.applyRemoteUpdate({
        skillId: SKILL_ID,
        revision: check.revision,
        overwriteLocalChanges: false
      })
      expect(updated).toMatchObject({ id: SKILL_ID, version: '2.0.0' })
      await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
        'echo remote\n'
      )
    }
  )

  it('reports up_to_date with local changes for a legacy baseline with edited managed files and unchanged source', async () => {
    const skillDir = path.join(skillsRoot, 'writer')
    await writeSkill(skillDir, { supportingContent: 'echo baseline\n' })
    const legacyBaseline = await installer.computeLegacyContentHash(skillDir)
    await seedSkill(SKILL_ID, 'writer', { contentHash: legacyBaseline })
    // Upstream is unchanged: same version and content as the pre-upgrade baseline.
    fetchRemoteSkillMock.mockImplementation(() => createFetchedSkill('1.0.0', 'echo baseline\n'))
    // Edit a managed file after install.
    await fs.promises.writeFile(path.join(skillDir, 'scripts', 'run.sh'), 'echo local\n', 'utf-8')

    const check = await new SkillService().checkRemoteUpdate(SKILL_ID)
    // The v2 source hash can never equal the legacy baseline, but comparing in the
    // baseline's format shows the source is unchanged: must not offer a destructive
    // update that would replace the managed edit with the original upstream files.
    expect(check).toMatchObject({ state: 'up_to_date', localChanges: true })
    await expect(fs.promises.readFile(path.join(skillDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo local\n')
  })

  it('preserves a baseline-matching replacement when obsolete-backup staging fails', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old')
    const newDir = path.join(root, 'new')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const newHash = await installer.computeContentHash(newDir)

    const originalRename = fs.promises.rename
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: unknown[]) => {
      const [from, to] = args as [string, string]
      if (from === backupPath && to === path.join(skillsRoot, '.writer.cleanup')) {
        throw Object.assign(new Error('staging failed'), { code: 'EACCES' })
      }
      return (originalRename as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)
    } finally {
      renameSpy.mockRestore()
    }

    // The good replacement is preserved and the obsolete backup is left intact for retry.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()

    // The baseline-aware sweep runs before the generic one: skipping catalogued folders
    // keeps the good tree even though the obsolete `.bak` is still present.
    await installer.recoverInterruptedInstalls(skillsRoot, { skipFolderNames: new Set(['writer']) })
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()

    // Retry without the fault stages the obsolete backup and cleans it up.
    await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the installed tree when the generic backup is incomplete', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const goodDir = path.join(root, 'good')
    await writeSkill(goodDir, { supportingContent: 'echo good\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(goodDir, destPath, { recursive: true })
    await fs.promises.cp(goodDir, backupPath, { recursive: true })
    await fs.promises.rm(path.join(backupPath, 'SKILL.md'))

    await installer.recoverInterruptedInstall(destPath)

    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo good\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('heals a legacy baseline when reconcile renames skill.md to SKILL.md while the source stays lowercase', async () => {
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
    const legacyBaseline = await installer.computeLegacyContentHash(canonicalOrigin)
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: legacyBaseline
    })
    // Simulate reconcile normalizing the managed descriptor to uppercase while the source stays lowercase.
    await fs.promises.rename(path.join(installedDir, 'skill.md'), path.join(installedDir, 'SKILL.md'))

    const check = await new SkillService().checkRemoteUpdate(SKILL_ID)
    // v2 digests agree (canonicalized descriptor, same bytes/modes), so the stale legacy baseline
    // must heal instead of reporting a false overwrite prompt.
    expect(check).toMatchObject({ state: 'up_to_date', localChanges: false })
    const healed = agentGlobalSkillService.getById(SKILL_ID)
    expect(healed?.contentHash).toBe(await installer.computeContentHash(installedDir))
  })

  it.skipIf(isWin)('hides a source mode-only change when the managed tree is edited on a legacy baseline', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
    const helperPath = path.join(originDir, 'scripts', 'run.sh')
    await fs.promises.chmod(helperPath, 0o644)
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    const legacyBaseline = await installer.computeLegacyContentHash(canonicalOrigin)
    await seedSkill(SKILL_ID, 'writer', {
      source: 'system',
      sourceUrl: pathToFileURL(canonicalOrigin).href,
      contentHash: legacyBaseline
    })
    // Edit a managed file, then change only the execute bits of the source script.
    // The legacy `directory-sha256:` baseline records no mode history, so a
    // source-vs-managed mode difference cannot prove the source changed. A managed
    // bytes+mode edit with unchanged upstream must stay `up_to_date` instead of
    // offering a destructive update that would replace the edit.
    await fs.promises.writeFile(path.join(installedDir, 'scripts', 'run.sh'), 'echo local\n', 'utf-8')
    await fs.promises.chmod(helperPath, 0o755)

    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'up_to_date', localChanges: true })
  })

  it.skipIf(isWin)('keeps a managed-only bytes+mode edit up_to_date on a legacy baseline', async () => {
    const originDir = path.join(root, 'origin', 'writer')
    await writeSkill(originDir, { supportingContent: 'echo baseline\n' })
    const helperPath = path.join(originDir, 'scripts', 'run.sh')
    await fs.promises.chmod(helperPath, 0o644)
    const canonicalOrigin = await fs.promises.realpath(originDir)
    const installedDir = path.join(skillsRoot, 'writer')
    await fs.promises.cp(canonicalOrigin, installedDir, { recursive: true })
    const legacyBaseline = await installer.computeLegacyContentHash(canonicalOrigin)
    await seedSkill(SKILL_ID, 'writer', {
      source: 'marketplace',
      sourceUrl: SOURCE_URL,
      contentHash: legacyBaseline
    })
    fetchRemoteSkillMock.mockImplementation(() => createFetchedSkill('1.0.0', 'echo baseline\n'))
    // Leave upstream unchanged; edit managed bytes and flip its mode 0644 -> 0755.
    await fs.promises.writeFile(path.join(installedDir, 'scripts', 'run.sh'), 'echo local\n', 'utf-8')
    await fs.promises.chmod(path.join(installedDir, 'scripts', 'run.sh'), 0o755)

    const service = new SkillService()
    const check = await service.checkRemoteUpdate(SKILL_ID)
    expect(check).toMatchObject({ state: 'up_to_date', localChanges: true })
    // A stale revision built from the same unchanged source must be rejected instead
    // of allowing a destructive apply over the managed edit.
    const staleRevision = (service as unknown as { createRemoteRevision: (input: unknown) => string })[
      'createRemoteRevision'
    ]({
      skillId: SKILL_ID,
      sourceUrl: SOURCE_URL,
      baselineHash: legacyBaseline,
      currentHash: await installer.computeContentHash(installedDir),
      remoteHash: await installer.computeContentHash(canonicalOrigin)
    })
    await expect(
      service.applyRemoteUpdate({ skillId: SKILL_ID, revision: staleRevision, overwriteLocalChanges: true })
    ).rejects.toMatchObject({ code: skillErrorCodes.REMOTE_STALE })
    await expect(fs.promises.readFile(path.join(installedDir, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo local\n'
    )
  })

  it('preserves an intervening edit when obsolete-backup staging failed before the next sweep', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old')
    const newDir = path.join(root, 'new')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const newHash = await installer.computeContentHash(newDir)

    const originalRename = fs.promises.rename
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: unknown[]) => {
      const [from, to] = args as [string, string]
      if (from === backupPath && to === path.join(skillsRoot, '.writer.cleanup')) {
        throw Object.assign(new Error('staging failed'), { code: 'EACCES' })
      }
      return (originalRename as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)
    } finally {
      renameSpy.mockRestore()
    }
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')

    // User edits before the next sweep: the destination no longer matches the baseline, but the
    // leftover `.bak` is still obsolete (old tree) and must not be restored over the edit.
    // Content differs (edited vs old), so byte-identical coverage fails and the marker is
    // preserved for the next verified publish instead of being deleted: a truncated helper
    // passes path coverage with the same paths but shortened bytes, so paths alone cannot
    // justify deletion. The next `prepareInstall` stashes this marker aside and deletes it
    // only after the new verified install commits.
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo edited\n', 'utf-8')
    await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)

    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo edited\n')
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()
  })

  it('retires an obsolete backup before reusing the slot so an interrupted retry preserves edits', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old-obsolete-reuse')
    const newDir = path.join(root, 'new-obsolete-reuse')
    const sourceDir = path.join(root, 'source-obsolete-reuse')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await writeSkill(sourceDir, { supportingContent: 'echo replacement\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.rm(`${backupPath}.obsolete`, { force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const baseline = await installer.computeContentHash(newDir)

    // Fail `.bak` -> `.cleanup` staging so recovery leaves an obsolete `.bak`
    // with a durable `<backup>.obsolete` record.
    const originalRename = fs.promises.rename
    const stagingSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: unknown[]) => {
      const [from, to] = args as [string, string]
      if (from === backupPath && to === path.join(skillsRoot, '.writer.cleanup')) {
        throw Object.assign(new Error('staging failed'), { code: 'EACCES' })
      }
      return (originalRename as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    } finally {
      stagingSpy.mockRestore()
    }
    await expect(fs.promises.access(`${backupPath}.obsolete`)).resolves.toBeUndefined()

    // User edits before the next retry: the destination no longer matches the baseline.
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo edited\n', 'utf-8')

    // The retry must retire the obsolete tree and its record before reusing `.bak`.
    // At copy time the new `.bak` (edited tree) must not inherit the stale record,
    // otherwise a crash after `rename(dest, .bak)` would delete the only copy.
    const originalCopyFile = fs.promises.copyFile
    let observedObsoleteDuringCopy: boolean | null = null
    const copySpy = vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (...args: unknown[]) => {
      if (observedObsoleteDuringCopy === null) {
        try {
          await fs.promises.access(`${backupPath}.obsolete`)
          observedObsoleteDuringCopy = true
        } catch {
          observedObsoleteDuringCopy = false
        }
      }
      return (originalCopyFile as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      const prepared = await installer.prepareInstall(sourceDir, destPath, baseline)
      await prepared.commit()
    } finally {
      copySpy.mockRestore()
    }

    expect(observedObsoleteDuringCopy).toBe(false)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo replacement\n'
    )
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.lstat(`${backupPath}.obsolete`)).rejects.toMatchObject({ code: 'ENOENT' })
    const stashes = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.stash-'))
    expect(stashes).toEqual([])

    // Simulate the crash window with the fixed layout: `dest` missing, `.bak` holds
    // the only copy of the edits, and no stale `.obsolete` remains. Recovery must
    // restore the edits instead of deleting them.
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo edited\n', 'utf-8')
    await fs.promises.rename(destPath, backupPath)
    await expect(fs.promises.lstat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })

    await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo edited\n')
  })

  it('restores the only complete copy when the replacement is partial and no tree matches the baseline', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old')
    const newDir = path.join(root, 'new')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    // Old tree holds managed edits, so neither tree matches the persisted old baseline.
    await fs.promises.writeFile(path.join(oldDir, 'scripts', 'run.sh'), 'echo old-edited\n', 'utf-8')
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    // Simulate a crash mid-copy: replacement exists but its descriptor is missing (partial),
    // while `.bak` is the only complete tree.
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.rm(path.join(destPath, 'SKILL.md'))
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const oldBaseline = await installer.computeContentHash(oldDir)
    // Corrupt the baseline view: backup has edits so it doesn't match either; use the clean
    // old hash to emulate the pre-commit baseline (neither partial dest nor edited backup matches).
    const cleanOldDir = path.join(root, 'clean-old')
    await writeSkill(cleanOldDir, { supportingContent: 'echo old\n' })
    const cleanOldHash = await installer.computeContentHash(cleanOldDir)

    await installer.recoverInterruptedInstallWithBaseline(destPath, cleanOldHash)

    // The complete backup (with edits) must survive instead of being deleted as obsolete.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo old-edited\n'
    )
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(oldBaseline).not.toBe(cleanOldHash)
  })

  it('matches a legacy baseline in its own format during recovery', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old')
    const newDir = path.join(root, 'new')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const legacyOldHash = await installer.computeLegacyContentHash(oldDir)

    // Crash before the database commit with an untouched legacy install: the old backup
    // matches the legacy baseline, so recovery must roll the partial replacement back.
    // (v2 hashes would never equal the legacy baseline, which previously forced the
    // no-match path that deleted the only complete copy.)
    await installer.recoverInterruptedInstallWithBaseline(destPath, legacyOldHash)

    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo old\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('restores an incomplete backup when no verified replacement exists', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const goodDir = path.join(root, 'good')
    await writeSkill(goodDir, { supportingContent: 'echo good\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(goodDir, backupPath, { recursive: true })
    await fs.promises.rm(path.join(backupPath, 'SKILL.md'))

    await installer.recoverInterruptedInstall(destPath)

    // The only copy of the helper files survives, so reconcile keeps the row instead of pruning.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo good\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a complete backup when descriptor stat fails transiently', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const goodDir = path.join(root, 'good')
    await writeSkill(goodDir, { supportingContent: 'echo good\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(goodDir, destPath, { recursive: true })
    await fs.promises.cp(goodDir, backupPath, { recursive: true })

    const originalStat = fs.promises.stat
    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (...args: unknown[]) => {
      const [target] = args as [string]
      if (target.startsWith(backupPath) && (target.endsWith('SKILL.md') || target.endsWith('skill.md'))) {
        throw Object.assign(new Error('transient stat failure'), { code: 'EACCES' })
      }
      return (originalStat as (...a: unknown[]) => Promise<unknown>)(...args) as never
    })
    try {
      await installer.recoverInterruptedInstall(destPath)
    } finally {
      statSpy.mockRestore()
    }

    // A failed descriptor `stat` must not delete the complete backup.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo good\n')
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()
  })

  it('preserves the only complete backup when the replacement has a descriptor but is missing a helper', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old-partial')
    const newDir = path.join(root, 'new-partial')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await fs.promises.writeFile(path.join(oldDir, 'scripts', 'run.sh'), 'echo old-edited\n', 'utf-8')
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    // Simulate a crash mid-copy after `SKILL.md` copied but before helpers finished:
    // the replacement has a descriptor yet is missing a helper, while `.bak` is the
    // only complete tree (with managed edits). Neither matches the pre-commit baseline.
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.rm(path.join(destPath, 'scripts', 'run.sh'))
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const cleanOldDir = path.join(root, 'clean-old-partial')
    await writeSkill(cleanOldDir, { supportingContent: 'echo old\n' })
    const cleanOldHash = await installer.computeContentHash(cleanOldDir)

    await installer.recoverInterruptedInstallWithBaseline(destPath, cleanOldHash)

    // The descriptor-only check must not treat the partial replacement as complete:
    // the only complete backup (with edits) survives instead of being deleted.
    await expect(fs.promises.access(path.join(destPath, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(fs.promises.readFile(path.join(backupPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo old-edited\n'
    )
  })

  it('preserves the only complete backup when the replacement helper is truncated', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old-truncated')
    const newDir = path.join(root, 'new-truncated')
    await writeSkill(oldDir, { supportingContent: 'echo old-complete-content\n' })
    await writeSkill(newDir, { supportingContent: 'echo new-complete-content\n' })
    await fs.promises.writeFile(path.join(oldDir, 'scripts', 'run.sh'), 'echo old-edited\n', 'utf-8')
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    // Simulate a crash during the final helper copy: all paths exist but the helper
    // is truncated, while `.bak` holds the only complete tree with managed edits.
    // Neither tree matches the pre-commit baseline.
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo new-c', 'utf-8')
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const cleanOldDir = path.join(root, 'clean-old-truncated')
    await writeSkill(cleanOldDir, { supportingContent: 'echo old\n' })
    const cleanOldHash = await installer.computeContentHash(cleanOldDir)

    await installer.recoverInterruptedInstallWithBaseline(destPath, cleanOldHash)

    // Path coverage passes (same file set) but bytes differ: the backup must survive
    // instead of being deleted as obsolete.
    await expect(fs.promises.access(path.join(destPath, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(fs.promises.readFile(path.join(backupPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo old-edited\n'
    )
  })

  it('retries a preserved interrupted install through prepareInstall without losing the repair', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old-retry')
    const newDir = path.join(root, 'new-retry')
    const sourceDir = path.join(root, 'source-retry')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await writeSkill(sourceDir, { supportingContent: 'echo new\n' })
    await fs.promises.writeFile(path.join(oldDir, 'scripts', 'run.sh'), 'echo old-edited\n', 'utf-8')
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    // Crash mid-copy: replacement is missing its helper while `.bak` is the only complete
    // tree. Recovery preserves both; the next retry must install the complete source even
    // though `.bak` already occupies the rollback slot.
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.rm(path.join(destPath, 'scripts', 'run.sh'))
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const cleanOldDir = path.join(root, 'clean-old-retry')
    await writeSkill(cleanOldDir, { supportingContent: 'echo old\n' })
    const cleanOldHash = await installer.computeContentHash(cleanOldDir)
    await installer.recoverInterruptedInstallWithBaseline(destPath, cleanOldHash)
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()

    const prepared = await installer.prepareInstall(sourceDir, destPath, cleanOldHash)
    await prepared.commit()

    // The retry installs the complete tree and frees the preserved rollback slot.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.access(path.join(destPath, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers a stashed backup stranded by a crash right after freeing the rollback slot', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old-stash-crash')
    const sourceDir = path.join(root, 'source-stash-crash')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(sourceDir, { supportingContent: 'echo new\n' })
    await fs.promises.writeFile(path.join(oldDir, 'scripts', 'run.sh'), 'echo old-edited\n', 'utf-8')
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    // Partial replacement plus the only complete copy in `.bak`.
    await fs.promises.cp(sourceDir, destPath, { recursive: true })
    await fs.promises.rm(path.join(destPath, 'scripts', 'run.sh'))
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const cleanOldDir = path.join(root, 'clean-old-stash-crash')
    await writeSkill(cleanOldDir, { supportingContent: 'echo old\n' })
    const cleanOldHash = await installer.computeContentHash(cleanOldDir)
    await installer.recoverInterruptedInstallWithBaseline(destPath, cleanOldHash)
    // Simulate a retry that stashed `.bak` aside and then crashed before
    // `rename(dest, .bak)`: only `dest` (partial) and `.bak.stash-*` (complete)
    // remain, with no `.bak` for the sweep to find.
    const stashCandidates = await fs.promises.readdir(skillsRoot)
    for (const name of stashCandidates) {
      if (name.startsWith('.writer.bak.stash-')) {
        await fs.promises.rm(path.join(skillsRoot, name), { recursive: true, force: true })
      }
    }
    const stashPath = `${backupPath}.stash-${Date.now()}-test`
    await fs.promises.rename(backupPath, stashPath)
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })

    // Startup recovery must promote the stash back to the rollback slot instead
    // of leaving it stranded.
    await installer.recoverInterruptedInstallWithBaseline(destPath, cleanOldHash)
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()
    await expect(fs.promises.readFile(path.join(backupPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo old-edited\n'
    )

    // The next retry then installs the complete source and frees the slot.
    const prepared = await installer.prepareInstall(sourceDir, destPath, cleanOldHash)
    await prepared.commit()
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo new\n')
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const remaining = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.stash-'))
    expect(remaining).toEqual([])
  })

  it('preserves both trees when the destination descriptor stat fails transiently during baseline recovery', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const oldDir = path.join(root, 'old-eio')
    const newDir = path.join(root, 'new-eio')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo new\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    const newHash = await installer.computeContentHash(newDir)
    // User edits before the next sweep so neither tree matches the baseline; the
    // leftover `.bak` is obsolete but must not be restored over the edit.
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo edited\n', 'utf-8')

    const originalStat = fs.promises.stat
    const statSpy = vi.spyOn(fs.promises, 'stat').mockImplementation(async (...args: unknown[]) => {
      const [target] = args as [string]
      if (target.startsWith(destPath) && (target.endsWith('SKILL.md') || target.endsWith('skill.md'))) {
        throw Object.assign(new Error('transient destination stat failure'), { code: 'EIO' })
      }
      return (originalStat as (...a: unknown[]) => Promise<unknown>)(...args) as never
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, newHash)
    } finally {
      statSpy.mockRestore()
    }

    // The intervening edit survives and the obsolete backup is preserved for retry
    // instead of being restored over the edited replacement.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo edited\n')
    await expect(fs.promises.access(path.join(backupPath, 'SKILL.md'))).resolves.toBeUndefined()
  })

  it('retires superseded stashes when the destination already matches the committed baseline', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const committedDir = path.join(root, 'committed-stash-retire')
    const obsoleteDir = path.join(root, 'obsolete-stash-retire')
    await writeSkill(committedDir, { supportingContent: 'echo committed\n' })
    await writeSkill(obsoleteDir, { supportingContent: 'echo obsolete\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    // Committed replacement plus an obsolete backup and an even older stash.
    await fs.promises.cp(committedDir, destPath, { recursive: true })
    await fs.promises.cp(obsoleteDir, backupPath, { recursive: true })
    const baseline = await installer.computeContentHash(committedDir)
    const stashPath = `${backupPath}.stash-${Date.now()}-retire`
    await fs.promises.cp(obsoleteDir, stashPath, { recursive: true })

    await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)

    // The committed replacement survives while the obsolete backup and stash are retired,
    // so a later sweep cannot promote the stash over a fresh edit or after uninstall.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo committed\n'
    )
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const remaining = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.stash-'))
    expect(remaining).toEqual([])
  })

  it('does not promote a stash when its retired deletion fails with EACCES', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const committedDir = path.join(root, 'committed-stash-eacces')
    const obsoleteDir = path.join(root, 'obsolete-stash-eacces')
    await writeSkill(committedDir, { supportingContent: 'echo committed\n' })
    await writeSkill(obsoleteDir, { supportingContent: 'echo obsolete\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(committedDir, destPath, { recursive: true })
    await fs.promises.cp(obsoleteDir, backupPath, { recursive: true })
    const baseline = await installer.computeContentHash(committedDir)
    const stashPath = `${backupPath}.stash-${Date.now()}-eacces`
    await fs.promises.cp(obsoleteDir, stashPath, { recursive: true })

    // Simulate swallowed EACCES during recursive deletion of the retired marker:
    // retirement (rename) succeeds, deletion fails, leaving an inert copy.
    const originalRm = fs.promises.rm
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string
      if (typeof target === 'string' && target.includes('.bak.retired-')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRm as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    } finally {
      rmSpy.mockRestore()
    }

    // The original stash namespace is gone (renamed), so no sweep can promote it.
    const remainingStash = (await fs.promises.readdir(skillsRoot)).filter((name) =>
      name.startsWith('.writer.bak.stash-')
    )
    expect(remainingStash).toEqual([])
    const retired = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.retired-'))
    expect(retired.length).toBe(1)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo committed\n'
    )

    // A fresh edit after the failed cleanup must survive later recovery: the
    // retired marker is inert and never promoted over the destination.
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo edited\n', 'utf-8')
    await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    await installer.recoverInterruptedInstalls(skillsRoot, { skipFolderNames: new Set(['writer']) })
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo edited\n')
    const stillStash = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.stash-'))
    expect(stillStash).toEqual([])
  })

  it('removes recovery markers when uninstalling so a stale copy cannot resurrect the skill', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const committedDir = path.join(root, 'committed-uninstall-markers')
    await writeSkill(committedDir, { supportingContent: 'echo committed\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(committedDir, destPath, { recursive: true })
    await fs.promises.cp(committedDir, backupPath, { recursive: true })
    const stashPath = `${backupPath}.stash-${Date.now()}-uninstall`
    await fs.promises.cp(committedDir, stashPath, { recursive: true })

    await installer.uninstall(destPath)

    await expect(fs.promises.lstat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    const remaining = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.stash-'))
    expect(remaining).toEqual([])
  })

  it('keeps a superseded stash inert when both retirement rename and removal fail', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const committedDir = path.join(root, 'committed-double-fail')
    const obsoleteDir = path.join(root, 'obsolete-double-fail')
    await writeSkill(committedDir, { supportingContent: 'echo committed\n' })
    await writeSkill(obsoleteDir, { supportingContent: 'echo obsolete\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(committedDir, destPath, { recursive: true })
    await fs.promises.cp(obsoleteDir, backupPath, { recursive: true })
    const baseline = await installer.computeContentHash(committedDir)
    const stashPath = `${backupPath}.stash-${Date.now()}-double-fail`
    // Superseded stash that still matches the committed baseline (e.g. same-version
    // reinstall): without a durable obsolete record, promoting it later would
    // overwrite a fresh edit or resurrect the skill after uninstall.
    await fs.promises.cp(committedDir, stashPath, { recursive: true })

    // Deny both retirement rename and direct removal for the stash: the fallback
    // must leave a durable `.obsolete` record instead of a promotable marker.
    // Allow promotion renames (stash -> `.bak`) so the pre-commit stranded case
    // still recovers; only retirement (stash -> `.bak.retired-*`) is denied.
    const originalRename = fs.promises.rename
    const originalRm = fs.promises.rm
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: unknown[]) => {
      const [from, to] = args as [string, string]
      if (
        typeof from === 'string' &&
        typeof to === 'string' &&
        from.includes('.bak.stash-') &&
        to.includes('.bak.retired-')
      ) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRename as (...a: unknown[]) => Promise<void>)(...args)
    })
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string
      if (typeof target === 'string' && target.includes('.bak.stash-') && !target.endsWith('.obsolete')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRm as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    } finally {
      renameSpy.mockRestore()
      rmSpy.mockRestore()
    }

    // Both operations failed, so the stash directory remains — but it must carry
    // the durable obsolete record and never be promoted.
    await expect(fs.promises.lstat(stashPath)).resolves.toMatchObject({ isDirectory: expect.any(Function) })
    await expect(fs.promises.access(`${stashPath}.obsolete`)).resolves.toBeUndefined()
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo committed\n'
    )

    // A fresh edit after the failed cleanup must survive: the obsolete stash is
    // deleted instead of promoted, even though it still exists on disk.
    await fs.promises.writeFile(path.join(destPath, 'scripts', 'run.sh'), 'echo edited\n', 'utf-8')
    await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo edited\n')
    const stillStash = (await fs.promises.readdir(skillsRoot)).filter((name) => name.startsWith('.writer.bak.stash-'))
    expect(stillStash).toEqual([])

    // Uninstall stays effective: with the stash gone, a missing destination is
    // pruned instead of resurrected. Re-create the matching-baseline stash state,
    // fail retirement again, then uninstall and sweep.
    await fs.promises.cp(committedDir, stashPath, { recursive: true })
    const renameSpy2 = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: unknown[]) => {
      const [from, to] = args as [string, string]
      if (
        typeof from === 'string' &&
        typeof to === 'string' &&
        from.includes('.bak.stash-') &&
        to.includes('.bak.retired-')
      ) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRename as (...a: unknown[]) => Promise<void>)(...args)
    })
    const rmSpy2 = vi.spyOn(fs.promises, 'rm').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string
      if (typeof target === 'string' && target.includes('.bak.stash-') && !target.endsWith('.obsolete')) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRm as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    } finally {
      renameSpy2.mockRestore()
      rmSpy2.mockRestore()
    }
    await installer.uninstall(destPath)
    await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    await installer.recoverInterruptedInstalls(skillsRoot, { skipFolderNames: new Set(['writer']) })
    await expect(fs.promises.lstat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a longer-named skill backup when uninstalling a prefix-colliding skill', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const otherFolder = 'writer.bak.retired-notes'
    const otherDest = path.join(skillsRoot, otherFolder)
    const otherBackup = path.join(skillsRoot, `.${otherFolder}.bak`)
    const committedDir = path.join(root, 'committed-prefix-collision')
    const otherDir = path.join(root, 'other-prefix-collision')
    await writeSkill(committedDir, { supportingContent: 'echo committed\n' })
    await writeSkill(otherDir, { supportingContent: 'echo other\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(otherDest, { recursive: true, force: true })
    await fs.promises.rm(otherBackup, { recursive: true, force: true })
    await fs.promises.cp(committedDir, destPath, { recursive: true })
    await fs.promises.cp(otherDir, otherDest, { recursive: true })
    await fs.promises.cp(otherDir, otherBackup, { recursive: true })

    await installer.uninstall(destPath)

    // The uninstalled skill is gone, but the longer-named skill's backup — which
    // shares the `.writer.bak.retired-` prefix — must survive for its own recovery.
    await expect(fs.promises.lstat(destPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.readFile(path.join(otherBackup, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo other\n'
    )
    await expect(fs.promises.readFile(path.join(otherDest, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo other\n')
  })

  it('aborts slot reuse when the obsolete marker cannot be cleared so edits survive a crash', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const obsoleteMarker = `${backupPath}.obsolete`
    const sourceDir = path.join(root, 'source-obsolete-marker-denied')
    const oldDir = path.join(root, 'old-obsolete-marker-denied')
    const newDir = path.join(root, 'new-obsolete-marker-denied')
    await writeSkill(oldDir, { supportingContent: 'echo old\n' })
    await writeSkill(newDir, { supportingContent: 'echo edited\n' })
    await writeSkill(sourceDir, { supportingContent: 'echo replacement\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.rm(obsoleteMarker, { force: true })
    await fs.promises.cp(newDir, destPath, { recursive: true })
    await fs.promises.cp(oldDir, backupPath, { recursive: true })
    await fs.promises.writeFile(obsoleteMarker, 'obsolete:stale', 'utf-8')
    const baseline = await installer.computeContentHash(newDir)

    // Deny removal of the obsolete record only: retirement of the `.bak` directory
    // itself still succeeds, but the stale record would mis-mark the fresh `.bak`.
    const originalRm = fs.promises.rm
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string
      if (typeof target === 'string' && target === obsoleteMarker) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRm as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await expect(installer.prepareInstall(sourceDir, destPath, baseline)).rejects.toThrow(/obsolete marker/)
    } finally {
      rmSpy.mockRestore()
    }

    // Publication must abort before `rename(dest, .bak)`: the edited tree stays in
    // place and no stale-marked backup is created.
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo edited\n')
    await expect(fs.promises.access(obsoleteMarker)).resolves.toBeUndefined()

    // Retry without the fault retires the obsolete tree and clears the record, so
    // the verified install commits with no stale marker left behind.
    const prepared = await installer.prepareInstall(sourceDir, destPath, baseline)
    await prepared.commit()
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo replacement\n'
    )
    await expect(fs.promises.lstat(obsoleteMarker)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reuses the backup slot when the legacy obsolete marker is unaddressable (ENAMETOOLONG)', async () => {
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const sourceDir = path.join(root, 'source-obsolete-nametoolong')
    const oldDir = path.join(root, 'old-obsolete-nametoolong')
    await writeSkill(sourceDir, { supportingContent: 'echo replacement\n' })
    await writeSkill(oldDir, { supportingContent: 'echo edited\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(oldDir, destPath, { recursive: true })
    const baseline = await installer.computeContentHash(oldDir)

    // Simulate ext4 with a long skill folder: the `<backup>.obsolete` sibling
    // exceeds NAME_MAX, so both removal and verification fail with
    // ENAMETOOLONG even though no marker exists. The bounded companion (short
    // hashed name) stays addressable and absent.
    const originalRm = fs.promises.rm
    const originalLstat = fs.promises.lstat
    const rmSpy = vi.spyOn(fs.promises, 'rm').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string
      if (typeof target === 'string' && target.endsWith('.bak.obsolete')) {
        throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
      }
      return (originalRm as (...a: unknown[]) => Promise<void>)(...args)
    })
    const lstatSpy = vi.spyOn(fs.promises, 'lstat').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string
      if (typeof target === 'string' && target.endsWith('.bak.obsolete')) {
        throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
      }
      return (originalLstat as (...a: unknown[]) => Promise<unknown>)(...args) as never
    })
    try {
      const prepared = await installer.prepareInstall(sourceDir, destPath, baseline)
      await prepared.commit()
    } finally {
      rmSpy.mockRestore()
      lstatSpy.mockRestore()
    }

    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe(
      'echo replacement\n'
    )
  })

  it('records obsolete state under the bounded marker when the legacy sibling is unaddressable', async () => {
    const { createHash } = await import('node:crypto')
    const destPath = path.join(skillsRoot, 'writer')
    const backupPath = path.join(skillsRoot, '.writer.bak')
    const staleDir = path.join(root, 'stale-obsolete-bounded')
    await writeSkill(staleDir, { supportingContent: 'echo stale\n' })
    await fs.promises.rm(destPath, { recursive: true, force: true })
    await fs.promises.rm(backupPath, { recursive: true, force: true })
    await fs.promises.cp(staleDir, destPath, { recursive: true })
    await fs.promises.cp(staleDir, backupPath, { recursive: true })
    const baseline = await installer.computeContentHash(staleDir)
    const boundedMarker = path.join(
      path.dirname(backupPath),
      `.${createHash('sha1').update(backupPath).digest('hex')}.obsolete`
    )
    await fs.promises.rm(boundedMarker, { force: true })

    // Deny staging of the `.bak` for cleanup and deny the legacy sibling
    // write with ENAMETOOLONG: the fallback must record the obsolete state
    // under the bounded companion instead.
    const originalRename = fs.promises.rename
    const originalWriteFile = fs.promises.writeFile
    const renameSpy = vi.spyOn(fs.promises, 'rename').mockImplementation(async (...args: unknown[]) => {
      const [from] = args as [string, string]
      if (typeof from === 'string' && from === backupPath) {
        throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
      }
      return (originalRename as (...a: unknown[]) => Promise<void>)(...args)
    })
    const writeSpy = vi.spyOn(fs.promises, 'writeFile').mockImplementation(async (...args: unknown[]) => {
      const target = args[0] as string | URL
      if (typeof target === 'string' && target === `${backupPath}.obsolete`) {
        throw Object.assign(new Error('ENAMETOOLONG'), { code: 'ENAMETOOLONG' })
      }
      return (originalWriteFile as (...a: unknown[]) => Promise<void>)(...args)
    })
    try {
      await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    } finally {
      renameSpy.mockRestore()
      writeSpy.mockRestore()
    }

    // The `.bak` directory remains but carries the bounded obsolete record, so
    // the next sweep stages it for cleanup instead of restoring it over the
    // destination, and drops the bounded record with it.
    await expect(fs.promises.access(boundedMarker)).resolves.toBeUndefined()
    await installer.recoverInterruptedInstallWithBaseline(destPath, baseline)
    await expect(fs.promises.lstat(backupPath)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.lstat(boundedMarker)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.promises.readFile(path.join(destPath, 'scripts', 'run.sh'), 'utf-8')).resolves.toBe('echo stale\n')
  })
})
