import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { agentSkillTable } from '@data/db/schemas/agentSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { readByPath, writeIfUnchangedByPath } from '@main/services/file'
import { PathStaleVersionError } from '@main/utils/file'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import type { AbsoluteFilePath } from '@shared/types/file'
import { hasSkillRemoteUpdateProvenance } from '@shared/utils/skillMarketplace'

const fetchRemoteSkillMock = vi.hoisted(() => vi.fn())
const notifyDataApiDataChangeMock = vi.hoisted(() => vi.fn())

vi.mock('../skillRemoteSource', () => ({ fetchRemoteSkill: fetchRemoteSkillMock }))
vi.mock('@data/dataApiDataChange', () => ({ notifyDataApiDataChange: notifyDataApiDataChangeMock }))

import { skillCaptureService } from '../SkillCaptureService'
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

  describe('Save as Skill', () => {
    const SESSION = '33333333-3333-4333-8333-333333333333'
    const MESSAGE = '44444444-4444-4444-8444-444444444444'
    const GENERATION = '55555555-5555-4555-8555-555555555555'
    const SECOND_AGENT = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const ref = { sessionId: SESSION, messageId: MESSAGE }
    const suggestion = {
      taskKey: 'weekly-report',
      name: 'Weekly report',
      description: 'Build a weekly sales report',
      reason: 'Reuse with next week data',
      summary: 'Clean input, calculate totals, check figures, write the agreed report format.'
    }
    let runtimeSpy: { mockRestore(): void }
    let currentMessageId: string
    let headless: boolean
    let busy: boolean

    beforeEach(async () => {
      currentMessageId = MESSAGE
      headless = false
      busy = false
      const container = application.getContainer()
      const get = container.get.bind(container)
      runtimeSpy = vi.spyOn(container, 'get').mockImplementation(((name: string) =>
        name === 'AgentSessionRuntimeService'
          ? {
              getLiveAssistantMessageId: () => currentMessageId,
              getInteractionState: () => ({
                currentTurn: headless ? 'headless' : 'interactive',
                userResponse: headless ? 'unavailable' : 'stream'
              }),
              isSessionBusyForArchive: () => busy
            }
          : get(name as never)) as typeof container.get)
      for (const id of [AGENT_ID, SECOND_AGENT]) {
        dbh.db.insert(agentTable).values({ id, name: id, instructions: '', type: 'claude-code', orderKey: id }).run()
      }
      dbh.db
        .insert(agentWorkspaceTable)
        .values({ id: SESSION, name: 'Work', path: root, type: 'user', orderKey: 'a' })
        .run()
      dbh.db
        .insert(agentSessionTable)
        .values({ id: SESSION, agentId: AGENT_ID, name: 'Reports', workspaceId: SESSION, orderKey: 'a' })
        .run()
      for (const id of [MESSAGE, GENERATION]) {
        dbh.db
          .insert(agentSessionMessageTable)
          .values({
            id,
            sessionId: SESSION,
            role: 'assistant',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'Done' }] }
          })
          .run()
      }
      await writeSkill(path.join(skillsRoot, 'skill-creator'))
      await seedSkill(SKILL_ID, 'skill-creator', { source: 'builtin' })
    })

    afterEach(() => runtimeSpy.mockRestore())

    async function draft() {
      skillCaptureService.suggest(SESSION, AGENT_ID, suggestion)
      const capture = agentSessionMessageService.getSessionMessage(SESSION, MESSAGE).data.skillCapture!
      agentSessionMessageService.setSkillCapture(SESSION, MESSAGE, {
        ...capture,
        status: 'generating',
        generationMessageId: GENERATION
      })
      currentMessageId = GENERATION
      const directory = path.join(root, 'feature.agents.skill_drafts', SESSION, MESSAGE, 'working', 'writer')
      await writeSkill(directory)
      return directory
    }

    it('preserves a suggestion through terminal message persistence and remembers dismissal', () => {
      skillCaptureService.suggest(SESSION, AGENT_ID, suggestion)
      agentSessionMessageService.saveMessage({
        sessionId: SESSION,
        message: {
          id: MESSAGE,
          role: 'assistant',
          status: 'success',
          data: { parts: [{ type: 'text', text: 'Final answer' }] }
        }
      })
      expect(agentSessionMessageService.getSessionMessage(SESSION, MESSAGE).data.skillCapture?.status).toBe('suggested')
      agentSessionMessageService.dismissSkillCapture(SESSION, MESSAGE)
      currentMessageId = GENERATION
      expect(skillCaptureService.suggest(SESSION, AGENT_ID, suggestion).ok).toBe(false)
      expect(agentSessionMessageService.listSkillCaptures(SESSION)).toHaveLength(1)
      expect(agentSessionMessageService.getSessionMessage(SESSION, MESSAGE).data.skillCapture?.status).toBe('dismissed')
    })

    it('supports the stable non-UUID identity of the built-in Cherry Assistant', () => {
      dbh.db
        .insert(agentTable)
        .values({
          id: 'cherry-assistant',
          name: 'Cherry Assistant',
          type: 'claude-code',
          instructions: '',
          orderKey: 'builtin',
          configuration: { builtin_role: 'assistant' }
        })
        .run()
      dbh.db
        .update(agentSessionTable)
        .set({ agentId: 'cherry-assistant' })
        .where(eq(agentSessionTable.id, SESSION))
        .run()
      expect(skillCaptureService.suggest(SESSION, 'cherry-assistant', suggestion).ok).toBe(true)
      expect(agentSessionMessageService.getSessionMessage(SESSION, MESSAGE).data.skillCapture?.agentId).toBe(
        'cherry-assistant'
      )
    })

    it('keeps drafts out of the library until confirmation and enables only the current Agent', async () => {
      await draft()
      await skillCaptureService.prepare(ref, 'writer')
      expect(await new SkillService().getByFolderName('writer')).toBeNull()
      expect((await skillCaptureService.prepare(ref, 'writer')).ok).toBe(false)
      const preview = await skillCaptureService.review(ref)
      expect(preview.files.map((file) => file.name)).toContain('SKILL.md')
      const id = await skillCaptureService.save(ref, preview.revision)
      expect(agentGlobalSkillService.list({ agentId: AGENT_ID }).find((skill) => skill.id === id)?.isEnabled).toBe(true)
      expect(agentGlobalSkillService.list({ agentId: SECOND_AGENT }).find((skill) => skill.id === id)?.isEnabled).toBe(
        false
      )
      expect(await skillCaptureService.save(ref, preview.revision)).toBe(id)
      expect(agentSessionMessageService.getSessionMessage(SESSION, MESSAGE).data.skillCapture?.status).toBe('saved')
    })

    it('rejects stale review after edits and saves the newly reviewed content', async () => {
      const directory = await draft()
      await skillCaptureService.prepare(ref, 'writer')
      const old = await skillCaptureService.review(ref)
      await fs.promises.writeFile(path.join(directory, 'scripts', 'run.sh'), 'echo revised\n')
      await expect(skillCaptureService.save(ref, old.revision)).rejects.toThrow('draft changed')
      await skillCaptureService.prepare(ref, 'writer')
      const next = await skillCaptureService.review(ref)
      expect(next.revision).not.toBe(old.revision)
      await expect(skillCaptureService.save(ref, old.revision)).rejects.toThrow('Preview')
      await skillCaptureService.save(ref, next.revision)
      expect(await fs.promises.readFile(path.join(skillsRoot, 'writer', 'scripts', 'run.sh'), 'utf8')).toBe(
        'echo revised\n'
      )
    })

    it('rejects a draft directory redirected outside its owned staging area', async () => {
      const directory = await draft()
      const working = path.dirname(directory)
      const outside = path.join(root, 'outside')
      await fs.promises.rename(working, outside)
      await fs.promises.symlink(outside, working, 'junction')
      await expect(skillCaptureService.prepare(ref, 'writer')).rejects.toThrow('symbolic links')
      expect(await new SkillService().getByFolderName('writer')).toBeNull()
    })

    it('rejects a reviewed snapshot changed at the install boundary', async () => {
      await draft()
      await skillCaptureService.prepare(ref, 'writer')
      const preview = await skillCaptureService.review(ref)
      const original = SkillInstaller.prototype.install
      const install = vi
        .spyOn(SkillInstaller.prototype, 'install')
        .mockImplementationOnce(async function (this: SkillInstaller, source, destination, expectedHash) {
          await fs.promises.appendFile(path.join(source, 'SKILL.md'), '\nUnexpected change')
          return original.call(this, source, destination, expectedHash)
        })
      try {
        await expect(skillCaptureService.save(ref, preview.revision)).rejects.toThrow('changed before installation')
        expect(await new SkillService().getByFolderName('writer')).toBeNull()
      } finally {
        install.mockRestore()
      }
    })

    it('requires user activation and a successful generation before saving', async () => {
      skillCaptureService.suggest(SESSION, AGENT_ID, suggestion)
      await expect(skillCaptureService.prepare(ref, 'writer')).rejects.toThrow('has not started')
      await draft()
      await skillCaptureService.prepare(ref, 'writer')
      const preview = await skillCaptureService.review(ref)
      dbh.db
        .update(agentSessionMessageTable)
        .set({ status: 'error' })
        .where(eq(agentSessionMessageTable.id, GENERATION))
        .run()
      await expect(skillCaptureService.save(ref, preview.revision)).rejects.toThrow('did not finish')
      expect(await new SkillService().getByFolderName('writer')).toBeNull()
    })

    it('rejects headless suggestions and revoked ownership', async () => {
      headless = true
      expect(() => skillCaptureService.suggest(SESSION, AGENT_ID, suggestion)).toThrow('interactive')
      headless = false
      await draft()
      dbh.db.update(agentSessionTable).set({ agentId: SECOND_AGENT }).where(eq(agentSessionTable.id, SESSION)).run()
      await expect(skillCaptureService.prepare(ref, 'writer')).rejects.toThrow('cannot create')
    })

    it('preserves existing skills on a name conflict and prevents saves during active work', async () => {
      await draft()
      await skillCaptureService.prepare(ref, 'writer')
      const preview = await skillCaptureService.review(ref)
      busy = true
      await expect(skillCaptureService.save(ref, preview.revision)).rejects.toThrow('Wait')
      busy = false
      await writeSkill(path.join(skillsRoot, 'writer'), { body: '# Existing instructions' })
      await seedSkill(OTHER_SKILL_ID, 'writer')
      await expect(skillCaptureService.save(ref, preview.revision)).rejects.toThrow('refusing to overwrite')
      expect(await fs.promises.readFile(path.join(skillsRoot, 'writer', 'SKILL.md'), 'utf8')).toContain(
        'Existing instructions'
      )
      await skillCaptureService.discard(ref)
      await expect(skillCaptureService.save(ref, preview.revision)).rejects.toThrow('Preview')
    })
  })

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
      .mockResolvedValueOnce(undefined)

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
})
