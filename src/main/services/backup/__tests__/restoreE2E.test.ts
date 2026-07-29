import {
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { application } from '@application'
import { applyMigrations } from '@data/db/applyMigrations'
import { readRestoreJournalV2, writeRestoreJournalV2 } from '@data/db/restore/restoreJournalV2'
import { runRestorePromotionV2 } from '@data/db/restore/restorePromotionV2'
import { snapshotTo } from '@data/db/restore/snapshot'
import { agentTable } from '@data/db/schemas/agent'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { appStateTable } from '@data/db/schemas/appState'
import { fileEntryTable } from '@data/db/schemas/file'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { noteTable } from '@data/db/schemas/note'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import { ZipArchive } from 'archiver'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import StreamZip from 'node-stream-zip'
import type { Mock } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { acknowledgeRestore } from '../acknowledgeRestore'
import { presentJournalDegradations } from '../degradationReport'
import { ArchiveAdmissionError, SourceDriftError } from '../errors'
import { exportArchive } from '../exportArchive'
import { armPreparedRestore, prepareRestore } from '../prepareRestore'
import { driftHooks } from '../sourceDrift'

/**
 * End-to-end proof for Backup v2: export → prepare → arm → preboot promotion →
 * acknowledgement, with real archives, real SQLite files, and real renames.
 *
 * The two devices are two userData directories and one switchable path
 * registry, which is what makes "cross-device" testable at all: the archive is
 * produced against one root set and consumed against another, so a path the
 * producer wrote can only survive if the rebase actually ran.
 *
 * Every case asserts the same shape of truth — the file sitting in the live
 * database slot afterwards. The target database carries a marker row the archive
 * cannot contain; its disappearance is the proof that a restore REPLACED the
 * database rather than merging into it.
 */

const FILE_ID = '11111111-1111-4111-8111-111111111111'
const AGENT_ID = '22222222-2222-4222-8222-222222222222'
const TARGET_MARKER = 'e2e-target-marker'

const dbh = setupTestDatabase()

let workDir = ''
let sourceUserData = ''
let targetUserData = ''
/** The device the path registry currently describes. */
let activeUserData = ''

function pathFor(key: string, filename?: string): string {
  const bases: Record<string, string> = {
    'app.userdata': activeUserData,
    'app.database.file': join(activeUserData, 'cherrystudio.sqlite'),
    'app.database.migrations': resolveMigrationsPath(),
    'feature.backup.temp': join(activeUserData, 'backup-temp'),
    'feature.backup.restore.file': join(activeUserData, 'restore-journal.json'),
    'feature.backup.restore.staging': join(activeUserData, 'restore-staging'),
    'feature.backup.restore.aside': join(activeUserData, 'restore-aside'),
    'feature.files.data': join(activeUserData, 'Data', 'Files'),
    'feature.knowledgebase.data': join(activeUserData, 'Data', 'KnowledgeBase'),
    'feature.notes.data': join(activeUserData, 'Data', 'Notes'),
    'feature.agents.data': join(activeUserData, 'Data', 'Agents'),
    'feature.agents.system_workspaces': join(activeUserData, 'Data', 'Agents', 'system'),
    'feature.agents.skills': join(activeUserData, 'Data', 'Skills'),
    'feature.mcp.workspace': join(activeUserData, 'Data', 'Workspace'),
    'feature.mcp.memory_file': join(activeUserData, 'Data', 'Mcp', 'memory.json'),
    'feature.agents.channels': join(activeUserData, 'Data', 'Channels'),
    'feature.agents.claude.root': join(activeUserData, 'Data', 'Agents', '.claude')
  }
  const base = bases[key]
  if (!base) throw new Error(`Unexpected path key in restore E2E test: ${key}`)
  return filename ? join(base, filename) : base
}

/** A migrated live database carrying a marker row no archive can contain. */
function makeLiveDb(userData: string): void {
  const sqlite = new Database(join(userData, 'cherrystudio.sqlite'))
  sqlite.pragma('journal_mode = WAL')
  const db = drizzle({ client: sqlite, casing: 'snake_case' })
  applyMigrations(db, resolveMigrationsPath())
  db.insert(appStateTable)
    .values({ key: TARGET_MARKER, value: { device: 'target' } })
    .run()
  sqlite.close()
}

function prepareUserData(userData: string): void {
  mkdirSync(join(userData, 'backup-temp'), { recursive: true })
  mkdirSync(join(userData, 'restore-staging'), { recursive: true })
  makeLiveDb(userData)
}

function query<T>(dbPath: string, sql: string, ...params: unknown[]): T | undefined {
  const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true })
  try {
    return sqlite.prepare(sql).get(...params) as T | undefined
  } finally {
    sqlite.close()
  }
}

/** The database the app would boot from on the target device. */
function liveDbPath(userData = targetUserData): string {
  return join(userData, 'cherrystudio.sqlite')
}

/**
 * Rows referencing every resource kind the adapters enumerate, all pointing at
 * the SOURCE device's managed roots — so a cross-device restore has something to
 * rebase and something to install.
 */
function seedSourceDatabase(): void {
  dbh.db.insert(fileEntryTable).values({ id: FILE_ID, origin: 'internal', name: 'report', ext: 'pdf', size: 4 }).run()
  dbh.db
    .insert(agentTable)
    .values({ id: AGENT_ID, type: 'agent', name: 'Backup agent', instructions: '', orderKey: 'a' })
    .run()
  dbh.db
    .insert(knowledgeBaseTable)
    .values({ id: 'kb-1', name: 'kb', status: 'completed', chunkSize: 512, chunkOverlap: 32 })
    .run()
  dbh.db
    .insert(noteTable)
    .values({ id: 'n-1', rootPath: join(sourceUserData, 'Data', 'Notes'), path: 'a.md', isStarred: true })
    .run()
  dbh.db
    .insert(agentWorkspaceTable)
    .values({
      id: 'w-1',
      name: 'ws',
      path: join(sourceUserData, 'Data', 'Agents', 'system', 's-1'),
      type: 'system',
      orderKey: 'a'
    })
    .run()
  dbh.db
    .insert(agentGlobalSkillTable)
    .values({ id: 'sk-1', name: 'skill', folderName: 'skill-1', source: 'local', contentHash: 'h' })
    .run()
}

/** The bytes those rows point at, on the source device. */
function seedSourceResources(): void {
  const write = (relative: string, content: string) => {
    const target = join(sourceUserData, relative)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, content)
  }
  write(join('Data', 'Files', `${FILE_ID}.pdf`), 'SOURCE-BLOB')
  write(join('Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'SOURCE-KB')
  write(join('Data', 'Notes', 'a.md'), '# source note')
  write(join('Data', 'Agents', AGENT_ID, 'SOUL.md'), 'SOURCE-SOUL')
  write(join('Data', 'Agents', AGENT_ID, 'USER.md'), 'SOURCE-USER')
  write(join('Data', 'Agents', AGENT_ID, 'memory', 'profile.md'), 'SOURCE-MEMORY')
  write(join('Data', 'Agents', 'system', 's-1', 'session.json'), 'SOURCE-WS')
  write(join('Data', 'Skills', 'skill-1', 'SKILL.md'), 'SOURCE-SKILL')
  write(join('Data', 'Workspace', 'draft.md'), 'SOURCE-MCP-WORKSPACE')
  write(join('Data', 'Mcp', 'memory.json'), '{"entities":[],"relations":[]}')
  write(join('Data', 'Channels', 'weixin_bot_channel-1.json'), 'SOURCE-CHANNEL')
  write(join('Data', 'Agents', '.claude', 'settings.json'), 'SOURCE-RUNTIME')
  write(join('Data', 'Agents', '.claude', 'skills', 'skill-1', 'SKILL.md'), 'DERIVED-MIRROR')
}

async function exportFrom(name: string): Promise<string> {
  const out = join(workDir, 'out', `${name}.cherrybackup`)
  activeUserData = sourceUserData
  await exportArchive({ outPath: out })
  return out
}

/**
 * Rewrite one payload's declared live path and repack — the archive an attacker
 * would hand the user. Nothing in the format stops them from editing the
 * manifest, so admission is what has to.
 */
async function retargetFirstPayload(
  archivePath: string,
  livePath: string | null,
  retargetRequirement = false
): Promise<string> {
  const unpacked = join(workDir, 'tamper')
  mkdirSync(unpacked, { recursive: true })
  const zip = new StreamZip.async({ file: archivePath })
  await zip.extract(null, unpacked)
  await zip.close()

  const manifestPath = join(unpacked, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    resourceRequirements: { livePath: string }[]
    resourcePayloads: { livePath: string }[]
  }
  if (livePath !== null) {
    const original = manifest.resourcePayloads[0].livePath
    manifest.resourcePayloads[0].livePath = livePath
    if (retargetRequirement) {
      const requirement = manifest.resourceRequirements.find((candidate) => candidate.livePath === original)
      if (!requirement) throw new Error('fixture payload has no matching requirement')
      requirement.livePath = livePath
    }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest))

  const out = join(workDir, 'out', 'tampered.cherrybackup')
  await new Promise<void>((resolve, reject) => {
    const archive = new ZipArchive({ zlib: { level: 1 }, zip64: true })
    const output = createWriteStream(out)
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    archive.directory(unpacked, false)
    archive.finalize().catch(reject)
  })
  return out
}

function markKnowledgeRebuildComplete(): void {
  const read = readRestoreJournalV2()
  if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error('expected a completed journal')
  writeRestoreJournalV2({
    ...read.journal,
    knowledgeRebuild: { completedBaseIds: read.journal.summary.knowledgeBaseIds }
  })
}

/** Prepare, confirm, and let the preboot gate run — the whole restore. */
async function restoreOnTarget(archivePath: string): Promise<void> {
  activeUserData = targetUserData
  const preview = await prepareRestore({ archivePath })
  armPreparedRestore(preview.restoreId)
  await runRestorePromotionV2()
}

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'cs-e2e-'))
  sourceUserData = join(workDir, 'source')
  targetUserData = join(workDir, 'target')
  mkdirSync(join(workDir, 'out'), { recursive: true })
  prepareUserData(sourceUserData)
  prepareUserData(targetUserData)
  activeUserData = sourceUserData

  vi.spyOn(application, 'getPath').mockImplementation(pathFor)
  ;(application.get('DbService').createSnapshot as unknown as Mock).mockImplementation((target: string) =>
    snapshotTo(dbh.sqlite, target)
  )
  seedSourceDatabase()
})

afterEach(() => {
  driftHooks.afterStagePreVerify = async () => {}
  rmSync(workDir, { recursive: true, force: true })
  ;(application.get('DbService').createSnapshot as unknown as Mock).mockReset()
  vi.restoreAllMocks()
})

describe('restore, cross-device', () => {
  it('replaces the whole database and keeps the replaced one until acknowledgement', async () => {
    const archive = await exportFrom('cross-device')

    await restoreOnTarget(archive)

    // The archive's database is now the database.
    expect(query(liveDbPath(), 'SELECT id FROM note WHERE id = ?', 'n-1')).toBeDefined()
    // …and nothing of the target's own database survived the replacement.
    expect(query(liveDbPath(), 'SELECT key FROM app_state WHERE key = ?', TARGET_MARKER)).toBeUndefined()

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok') throw new Error('expected a terminal journal')
    expect(read.journal.state).toBe('completed')

    // The replaced database is still on disk — a rollback is still possible.
    const aside = join(targetUserData, read.journal.db.aside)
    expect(query(aside, 'SELECT key FROM app_state WHERE key = ?', TARGET_MARKER)).toBeDefined()

    expect(acknowledgeRestore()).toMatchObject({ acknowledged: true, restoreId: read.journal.restoreId })
    expect(existsSync(aside)).toBe(false)
    expect(readRestoreJournalV2().kind).toBe('none')
    // Acknowledgement releases GC protection only after the artifacts are gone.
    expect(existsSync(join(targetUserData, 'restore-staging', read.journal.restoreId))).toBe(false)
  })

  it('rebases the producer’s managed roots onto this device', async () => {
    const archive = await exportFrom('rebase')

    await restoreOnTarget(archive)

    const note = query<{ root_path: string }>(liveDbPath(), 'SELECT root_path FROM note WHERE id = ?', 'n-1')
    const workspace = query<{ path: string }>(liveDbPath(), 'SELECT path FROM agent_workspace WHERE id = ?', 'w-1')
    // A path that still pointed at the producer's profile would send the app
    // reading and writing outside this device's managed roots.
    expect(note?.root_path).toBe(join(targetUserData, 'Data', 'Notes'))
    expect(workspace?.path).toBe(join(targetUserData, 'Data', 'Agents', 'system', 's-1'))
  })
})

describe('Full restore, empty target device', () => {
  it('restores ordinary Notes even when the sparse note state table has zero rows', async () => {
    dbh.db.delete(noteTable).run()
    seedSourceResources()
    const archive = await exportFrom('full-notes-without-state')

    await restoreOnTarget(archive)

    expect(readFileSync(join(targetUserData, 'Data', 'Notes', 'a.md'), 'utf8')).toBe('# source note')
  })

  it('installs every declared resource next to the database that references it', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-empty')

    activeUserData = targetUserData
    const preview = await prepareRestore({ archivePath: archive })
    // Nothing to park on a device that has none of them.
    expect(preview.resources).toEqual({ install: 10, replace: 0 })
    armPreparedRestore(preview.restoreId)
    await runRestorePromotionV2()

    expect(readFileSync(join(targetUserData, 'Data', 'Files', `${FILE_ID}.pdf`), 'utf8')).toBe('SOURCE-BLOB')
    expect(readFileSync(join(targetUserData, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'utf8')).toBe('SOURCE-KB')
    expect(readFileSync(join(targetUserData, 'Data', 'Notes', 'a.md'), 'utf8')).toBe('# source note')
    expect(readFileSync(join(targetUserData, 'Data', 'Agents', AGENT_ID, 'SOUL.md'), 'utf8')).toBe('SOURCE-SOUL')
    expect(readFileSync(join(targetUserData, 'Data', 'Agents', AGENT_ID, 'USER.md'), 'utf8')).toBe('SOURCE-USER')
    expect(readFileSync(join(targetUserData, 'Data', 'Agents', AGENT_ID, 'memory', 'profile.md'), 'utf8')).toBe(
      'SOURCE-MEMORY'
    )
    expect(readFileSync(join(targetUserData, 'Data', 'Agents', 'system', 's-1', 'session.json'), 'utf8')).toBe(
      'SOURCE-WS'
    )
    expect(readFileSync(join(targetUserData, 'Data', 'Skills', 'skill-1', 'SKILL.md'), 'utf8')).toBe('SOURCE-SKILL')
    expect(readFileSync(join(targetUserData, 'Data', 'Workspace', 'draft.md'), 'utf8')).toBe('SOURCE-MCP-WORKSPACE')
    expect(readFileSync(join(targetUserData, 'Data', 'Mcp', 'memory.json'), 'utf8')).toBe(
      '{"entities":[],"relations":[]}'
    )
    expect(readFileSync(join(targetUserData, 'Data', 'Channels', 'weixin_bot_channel-1.json'), 'utf8')).toBe(
      'SOURCE-CHANNEL'
    )
    expect(readFileSync(join(targetUserData, 'Data', 'Agents', '.claude', 'settings.json'), 'utf8')).toBe(
      'SOURCE-RUNTIME'
    )
    expect(existsSync(join(targetUserData, 'Data', 'Agents', '.claude', 'skills'))).toBe(false)
    if (process.platform !== 'win32') {
      expect(statSync(join(targetUserData, 'Data', 'Channels')).mode & 0o777).toBe(0o700)
      expect(statSync(join(targetUserData, 'Data', 'Channels', 'weixin_bot_channel-1.json')).mode & 0o777).toBe(0o600)
      expect(statSync(join(targetUserData, 'Data', 'Agents', '.claude')).mode & 0o777).toBe(0o700)
    }

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok') throw new Error('expected a terminal journal')
    expect(read.journal.state).toBe('completed')
    // Derived work must finish before acknowledgement may erase its retry marker.
    markKnowledgeRebuildComplete()
    // Nothing was parked, so acknowledgement has only the database aside to drop.
    expect(acknowledgeRestore()).toMatchObject({ acknowledged: true, removed: 1 })
  })

  it('names the knowledge bases it installed so the reindex has something to schedule', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-summary')

    await restoreOnTarget(archive)

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error('expected a completed journal')
    expect(read.journal.summary?.knowledgeBaseIds).toEqual(['kb-1'])
  })

  it('restores internal links as ordinary bytes and keeps every omitted reference disclosed', async () => {
    seedSourceResources()
    const notes = join(sourceUserData, 'Data', 'Notes')
    const external = join(workDir, 'outside-note.md')
    writeFileSync(external, 'OUTSIDE')
    symlinkSync('a.md', join(notes, 'alias.md'))
    symlinkSync(external, join(notes, 'external.md'))
    symlinkSync('missing.md', join(notes, 'dangling.md'))
    mkdirSync(join(notes, 'nested'))
    symlinkSync('..', join(notes, 'nested', 'back'))
    const archive = await exportFrom('full-links')

    activeUserData = targetUserData
    const preview = await prepareRestore({ archivePath: archive })
    expect(preview.degradations).toEqual(
      expect.arrayContaining([
        {
          kind: 'resource-entry:note-root',
          livePath: 'Data/Notes/dangling.md',
          reason: 'dangling-reference'
        },
        {
          kind: 'resource-entry:note-root',
          livePath: 'Data/Notes/external.md',
          reason: 'external-reference'
        },
        {
          kind: 'resource-entry:note-root',
          livePath: 'Data/Notes/nested/back',
          reason: 'cyclic-reference'
        }
      ])
    )
    armPreparedRestore(preview.restoreId)
    await runRestorePromotionV2()

    const restoredAlias = join(targetUserData, 'Data', 'Notes', 'alias.md')
    expect(lstatSync(restoredAlias).isFile()).toBe(true)
    expect(lstatSync(restoredAlias).isSymbolicLink()).toBe(false)
    expect(readFileSync(restoredAlias, 'utf8')).toBe('# source note')
    expect(existsSync(join(targetUserData, 'Data', 'Notes', 'external.md'))).toBe(false)
    expect(existsSync(join(targetUserData, 'Data', 'Notes', 'dangling.md'))).toBe(false)
    expect(existsSync(join(targetUserData, 'Data', 'Notes', 'nested', 'back'))).toBe(false)

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error('expected a completed journal')
    expect(presentJournalDegradations(read.journal.degradations ?? [])).toEqual(
      expect.arrayContaining([
        { code: 'external-reference', count: 1, paths: ['Data/Notes/external.md'] },
        { code: 'dangling-reference', count: 1, paths: ['Data/Notes/dangling.md'] },
        { code: 'cyclic-reference', count: 1, paths: ['Data/Notes/nested/back'] }
      ])
    )
  })
})

describe('Full export with source drift after the sealed baseline', () => {
  it('fails the export and publishes no partial archive', async () => {
    seedSourceResources()
    driftHooks.afterStagePreVerify = async (sourcePath) => {
      if (sourcePath === join(sourceUserData, 'Data', 'Notes', 'a.md')) {
        writeFileSync(join(sourceUserData, 'Data', 'Notes', 'changed-during-export.md'), 'DRIFT')
      }
    }
    activeUserData = sourceUserData
    const archive = join(workDir, 'out', 'full-with-drift.cherrybackup')

    await expect(exportArchive({ outPath: archive })).rejects.toBeInstanceOf(SourceDriftError)
    expect(existsSync(archive)).toBe(false)
  })
})

describe('Full restore, same device with content already there', () => {
  beforeEach(() => {
    // One device: the archive is produced and consumed against the same roots.
    targetUserData = sourceUserData
  })

  it('parks what it replaces and leaves undeclared paths alone', async () => {
    seedSourceResources()
    writeFileSync(join(sourceUserData, 'Data', 'Files', 'not-in-the-backup.bin'), 'TARGET-ONLY')
    const archive = await exportFrom('full-same')
    // Change the live content so "replaced" is observable.
    writeFileSync(join(sourceUserData, 'Data', 'Files', `${FILE_ID}.pdf`), 'STALE-BLOB')

    activeUserData = targetUserData
    const preview = await prepareRestore({ archivePath: archive })
    expect(preview.resources).toEqual({ install: 0, replace: 10 })
    armPreparedRestore(preview.restoreId)
    await runRestorePromotionV2()

    expect(readFileSync(join(targetUserData, 'Data', 'Files', `${FILE_ID}.pdf`), 'utf8')).toBe('SOURCE-BLOB')
    // A path the archive never declared is not an install unit, so nothing in
    // the promotion can touch it.
    expect(readFileSync(join(targetUserData, 'Data', 'Files', 'not-in-the-backup.bin'), 'utf8')).toBe('TARGET-ONLY')
  })

  it('leaves a newer live resource in place beside the older database it restored', async () => {
    seedSourceResources()
    const blob = join(sourceUserData, 'Data', 'Files', `${FILE_ID}.pdf`)
    // The blob is rewritten after the snapshot boundary, so the export cannot
    // prove which version it holds and omits the unit (§5.4).
    driftHooks.afterStagePreVerify = async (sourcePath) => {
      if (sourcePath === blob) writeFileSync(blob, 'NEWER-BLOB')
    }
    const archive = await exportFrom('full-newer-resource')
    driftHooks.afterStagePreVerify = async () => {}

    activeUserData = targetUserData
    const preview = await prepareRestore({ archivePath: archive })
    expect(preview.degradations).toEqual(
      expect.arrayContaining([
        { kind: 'resource:file-blob', livePath: `Data/Files/${FILE_ID}.pdf`, reason: 'changed-after-snapshot' }
      ])
    )
    armPreparedRestore(preview.restoreId)
    await runRestorePromotionV2()

    // The contract's honest end state: the promoted database is the archive's,
    // the file it points at is the newer one this device already had, and the
    // disclosure — not a reconciliation — is what tells the user.
    expect(query(liveDbPath(), 'SELECT id FROM file_entry WHERE id = ?', FILE_ID)).toBeDefined()
    expect(readFileSync(blob, 'utf8')).toBe('NEWER-BLOB')

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok' || read.journal.state !== 'completed') throw new Error('expected a completed journal')
    expect(presentJournalDegradations(read.journal.degradations ?? [])).toContainEqual({
      code: 'resource-changed',
      count: 1,
      paths: [`Data/Files/${FILE_ID}.pdf`]
    })
  })

  it('replaces a declared directory as a whole, and holds the old one until acknowledgement', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-dir')
    // A note this device made after the backup. The notes root is ONE unit, so
    // the restore replaces the whole directory rather than merging into it.
    writeFileSync(join(sourceUserData, 'Data', 'Notes', 'newer.md'), '# written after the backup')

    activeUserData = targetUserData
    const preview = await prepareRestore({ archivePath: archive })
    armPreparedRestore(preview.restoreId)
    await runRestorePromotionV2()

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok') throw new Error('expected a terminal journal')
    const notesUnit = read.journal.resourceInstalls.find((entry) => entry.live === 'Data/Notes')
    if (!notesUnit) throw new Error('expected a notes install unit')

    expect(existsSync(join(targetUserData, 'Data', 'Notes', 'newer.md'))).toBe(false)
    // Parked, not destroyed: until the user commits to the restore it is still
    // recoverable from the aside.
    expect(readFileSync(join(targetUserData, notesUnit.aside, 'newer.md'), 'utf8')).toBe('# written after the backup')

    markKnowledgeRebuildComplete()
    acknowledgeRestore()

    // Acknowledgement is the point of no return, and the disclosure says so.
    expect(existsSync(join(targetUserData, notesUnit.aside))).toBe(false)
  })
})

describe('what a restored archive may not switch on', () => {
  it('brings an executable integration back configured but inert', async () => {
    dbh.db
      .insert(mcpServerTable)
      .values({
        id: 'mcp-1',
        name: 'local tool',
        type: 'stdio',
        command: '/usr/bin/whatever',
        dxtPath: join(sourceUserData, 'dxt', 'mcp-1'),
        isActive: true,
        isTrusted: true,
        trustedAt: 1_700_000_000_000
      })
      .run()
    const archive = await exportFrom('mcp')

    await restoreOnTarget(archive)

    const row = query<{ is_active: number; is_trusted: number | null; dxt_path: string | null; command: string }>(
      liveDbPath(),
      'SELECT is_active, is_trusted, dxt_path, command FROM mcp_server WHERE id = ?',
      'mcp-1'
    )
    // An active stdio server is connected at startup with no user action, so
    // activity is the one field an archive may never carry across.
    expect(row?.is_active).toBe(0)
    expect(row?.is_trusted).toBeNull()
    // The producer's extraction directory would decide what actually runs.
    expect(row?.dxt_path).toBeNull()
    // Still re-activatable without retyping the configuration.
    expect(row?.command).toBe('/usr/bin/whatever')
  })

  it('still admits an archive that was only unpacked and repacked', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-repacked')
    const repacked = await retargetFirstPayload(archive, null)

    // The control for the case below: unpack/repack alone must not be what a
    // rejection is measuring.
    activeUserData = targetUserData
    await expect(prepareRestore({ archivePath: repacked })).resolves.toBeDefined()
  })

  it('refuses a payload redirected inside a managed root but outside the database closure', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-redirected')
    const unrelated = join(targetUserData, 'Data', 'Files', 'unrelated.pdf')
    mkdirSync(join(unrelated, '..'), { recursive: true })
    writeFileSync(unrelated, 'TARGET-ONLY')
    const tampered = await retargetFirstPayload(archive, 'Data/Files/unrelated.pdf', true)

    activeUserData = targetUserData
    await expect(prepareRestore({ archivePath: tampered })).rejects.toThrow(/requirement-set/)

    expect(readRestoreJournalV2().kind).toBe('none')
    expect(readFileSync(unrelated, 'utf8')).toBe('TARGET-ONLY')
  })

  it('refuses an archive whose manifest aims a payload outside userData', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-tampered')
    const tampered = await retargetFirstPayload(archive, '../../evil')

    activeUserData = targetUserData
    const error = await prepareRestore({ archivePath: tampered }).catch((e) => e)

    // Rejected for the reason claimed, not because a repacked archive happens to
    // be unreadable — a vacuous pass here would prove nothing.
    expect(error).toBeInstanceOf(ArchiveAdmissionError)
    expect((error as ArchiveAdmissionError).reason).toBe('manifest-invalid')
    // Refused before anything was staged, so there is nothing to clean up and
    // nothing to promote.
    expect(readRestoreJournalV2().kind).toBe('none')
    expect(existsSync(join(workDir, 'evil'))).toBe(false)
    expect(query(liveDbPath(), 'SELECT key FROM app_state WHERE key = ?', TARGET_MARKER)).toBeDefined()
  })
})

describe('a crash before the commit boundary', () => {
  it('rolls a Full restore back to the database and files this device already had', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-crash')
    activeUserData = targetUserData
    mkdirSync(join(targetUserData, 'Data', 'KnowledgeBase', 'kb-1'), { recursive: true })
    writeFileSync(join(targetUserData, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'TARGET-KB')
    const preview = await prepareRestore({ archivePath: archive })
    armPreparedRestore(preview.restoreId)

    // The crash: the marker claims the installs completed while the filesystem
    // still shows them pending. Pre-commit, the filesystem wins and the whole
    // attempt rolls back.
    const armed = readRestoreJournalV2()
    if (armed.kind !== 'ok' || armed.journal.state !== 'armed') throw new Error('expected an armed journal')
    writeRestoreJournalV2({ ...armed.journal, state: 'promoting', step: 'resources-installed' })

    await runRestorePromotionV2()

    const read = readRestoreJournalV2()
    if (read.kind !== 'ok') throw new Error('expected a terminal journal')
    expect(read.journal.state).toBe('failed')
    // The two states the design allows: this is the "old database intact" one.
    expect(query(liveDbPath(), 'SELECT key FROM app_state WHERE key = ?', TARGET_MARKER)).toBeDefined()
    expect(readFileSync(join(targetUserData, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'utf8')).toBe('TARGET-KB')
    expect(existsSync(join(targetUserData, 'Data', 'Skills', 'skill-1'))).toBe(false)

    // A failed restore owns nothing, so acknowledgement just clears the record.
    expect(acknowledgeRestore()).toMatchObject({ acknowledged: true })
    expect(readRestoreJournalV2().kind).toBe('none')
  })
})

describe('relocated userData', () => {
  it('acknowledges a completed restore after the whole profile moved', async () => {
    seedSourceResources()
    const archive = await exportFrom('full-relocate')

    await restoreOnTarget(archive)
    const read = readRestoreJournalV2()
    if (read.kind !== 'ok') throw new Error('expected a terminal journal')
    markKnowledgeRebuildComplete()

    // Everything the journal names is userData-relative (§6.6), so moving the
    // profile must not strand a single artifact.
    const moved = join(workDir, 'relocated')
    renameSync(targetUserData, moved)
    targetUserData = moved
    activeUserData = moved

    expect(acknowledgeRestore()).toMatchObject({ acknowledged: true })
    expect(existsSync(join(moved, read.journal.db.aside))).toBe(false)
    expect(readRestoreJournalV2().kind).toBe('none')
    // The restored data itself came along with the move.
    expect(readFileSync(join(moved, 'Data', 'KnowledgeBase', 'kb-1', 'doc.txt'), 'utf8')).toBe('SOURCE-KB')
  })
})
