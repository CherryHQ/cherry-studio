import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { gzipSync, gunzipSync } from 'node:zlib'

import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { ZipArchive } from 'archiver'
import { eq } from 'drizzle-orm'
import { app } from 'electron'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { captureConfiguration, type ConfigurationPayload } from '@main/data/db/restore/configurationBackup'
import { agentTable } from '@main/data/db/schemas/agent'
import { agentSessionTable } from '@main/data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@main/data/db/schemas/agentSessionMessage'
import { agentWorkspaceTable } from '@main/data/db/schemas/agentWorkspace'
import { assistantTable } from '@main/data/db/schemas/assistant'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { messageTable } from '@main/data/db/schemas/message'
import { topicTable } from '@main/data/db/schemas/topic'
import { translateHistoryTable } from '@main/data/db/schemas/translateHistory'
import { DEFAULT_ASSISTANT_SETTINGS } from '@shared/data/types/assistant'

import BackupManager from '../LegacyBackupManager'

vi.mock('@main/utils/appEdition', () => ({ getAppEdition: () => 'global' }))
vi.mock('@main/utils/system', () => ({ getDeviceType: () => 'test-device', getHostname: () => 'test-host' }))

describe('real configuration archives', () => {
  const dbh = setupTestDatabase()
  let root: string
  let manager: BackupManager
  let holds: { dispose: ReturnType<typeof vi.fn> }[]
  const metadata = () => ({
    version: 8,
    timestamp: 0,
    appName: 'Cherry Studio',
    appVersion: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    scope: 'configuration',
    resources: { database: false, cache: false, indexedDB: false, localStorage: false, appClaude: false, data: false }
  })
  const snapshot = () =>
    Object.fromEntries(
      (
        dbh.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as {
          name: string
        }[]
      ).map(({ name }) => [name, dbh.sqlite.prepare(`SELECT * FROM "${name}"`).all()])
    )
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

  beforeEach(async () => {
    root = path.join(path.dirname(dbh.sqlite.name), 'configuration-profile')
    await fs.rm(root, { recursive: true, force: true })
    await fs.mkdir(root, { recursive: true })
    manager = new BackupManager()
    holds = []
    const pause = () => {
      const hold = { dispose: vi.fn() }
      holds.push(hold)
      return hold
    }
    const drained = async () => ({ stragglerIds: [] })
    MockApplicationUtils.setService('AgentLifecycleService', {
      pauseIngress: vi.fn(pause),
      pauseExecution: vi.fn(pause),
      drainIngress: vi.fn(drained),
      drainInFlight: vi.fn(drained),
      listActiveWork: () => []
    })
    MockApplicationUtils.setService('AiStreamManager', {
      pause: vi.fn(pause),
      drainInFlight: vi.fn(drained),
      hasLiveStreams: () => false
    })
    MockApplicationUtils.setService('AgentJobsService', {
      pause: vi.fn(pause),
      drainInFlight: async () => ({ settled: true })
    })
    MockApplicationUtils.setService('JobManager', { pause: vi.fn(pause), drainInFlight: vi.fn(drained) })
    vi.mocked(application.getPath).mockImplementation((key, fileName) => {
      const paths: Record<string, string> = {
        'app.root': process.cwd(),
        'app.userdata': root,
        'app.userdata.data': path.join(root, 'Data'),
        'app.database.file': dbh.sqlite.name,
        'app.database.migrations': path.join(process.cwd(), 'migrations/sqlite-drizzle'),
        'feature.backup.temp': path.join(root, 'backup-temp'),
        'feature.backup.restore.file': path.join(root, 'restore-journal.json'),
        'feature.backup.restore.staging': path.join(root, 'restore-staging')
      }
      const base = paths[key] ?? path.join(root, key)
      return fileName ? path.join(base, fileName) : base
    })
    vi.mocked(application.relaunch).mockClear()
    vi.mocked(application.get('DbService').withWriteTx).mockClear()
  })

  afterEach(() => {
    MockApplicationUtils.resetServices()
  })

  function seed() {
    dbh.db
      .insert(assistantTable)
      .values({
        id: 'assistant',
        name: 'Exported definition',
        emoji: '🌟',
        settings: DEFAULT_ASSISTANT_SETTINGS,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: 'agent',
        type: 'pi',
        name: 'Exported agent',
        instructions: '',
        configuration: {
          avatar: '🌟',
          scheduler_enabled: true,
          builtin_role: 'doctor',
          unknown: 'excludedagentsecret'
        },
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(topicTable)
      .values({ id: 'topic', name: 'privatetopicsentinel', assistantId: 'assistant', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(messageTable)
      .values({ id: 'root', topicId: 'topic', role: 'root', data: { parts: [] }, status: 'success' })
      .run()
    dbh.db
      .insert(messageTable)
      .values({
        id: 'message',
        parentId: 'root',
        topicId: 'topic',
        role: 'user',
        data: { parts: [{ type: 'text', text: 'privatemessagesentinel' }] },
        compactionSummary: 'privatecompactionsentinel',
        status: 'success'
      })
      .run()
    dbh.db.insert(agentWorkspaceTable).values({ id: 'workspace', name: 'Local', path: '/local', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentSessionTable)
      .values({
        id: 'session',
        agentId: 'agent',
        workspaceId: 'workspace',
        name: 'privatesessionsentinel',
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentSessionMessageTable)
      .values({
        id: 'agent-message',
        sessionId: 'session',
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'privateagentsentinel' }] }
      })
      .run()
    dbh.db
      .insert(fileEntryTable)
      .values({ id: 'file', origin: 'internal', name: 'privateattachmentsentinel', size: 10 })
      .run()
    dbh.db
      .insert(translateHistoryTable)
      .values({ sourceText: 'privatetranslationsentinel', targetText: 'private translation' })
      .run()
    dbh.db
      .insert(topicTable)
      .values({ id: 'deleted', name: 'privatedeletedsentinel'.repeat(20000), orderKey: 'a0' })
      .run()
    dbh.db.delete(topicTable).where(eq(topicTable.id, 'deleted')).run()
  }

  async function writeArchive(entries: [string, string | Buffer, number?][], store = false): Promise<string> {
    const { createWriteStream } = await import('node:fs')
    const file = path.join(root, 'candidate.zip')
    const archive = new ZipArchive({ zlib: { level: 1 }, store })
    const writing = pipeline(archive, createWriteStream(file))
    for (const [name, data, mode] of entries) archive.append(data, { name, ...(mode ? { mode } : {}) })
    await Promise.all([writing, archive.finalize()])
    return file
  }

  const candidate = (payload: unknown, meta: unknown = metadata()) =>
    writeArchive([
      ['metadata.json', JSON.stringify(meta)],
      ['Configuration/configuration.json', JSON.stringify(payload)]
    ])

  it('inflates every entry and proves history, FTS, attachments, deleted pages and runtime files are absent', async () => {
    seed()
    const privateFiles = {
      'Data/Files/attachment': Buffer.from('privatefilebytesentinel'),
      'cache.json': Buffer.from('privatecachesentinel'),
      'IndexedDB/database': Buffer.from('privatebrowsersentinel'),
      'Local Storage/database.gz': gzipSync('privategzipsentinel')
    }
    for (const [relative, bytes] of Object.entries(privateFiles)) {
      const target = path.join(root, relative)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, bytes)
    }
    expect(gunzipSync(privateFiles['Local Storage/database.gz']).toString()).toBe('privategzipsentinel')
    const output = await manager.exportConfiguration(root)
    expect(path.basename(output)).toMatch(/^cherry-studio\.configuration\.\d{17}\.test-host\.test-device\.zip$/)
    if (process.platform !== 'win32') expect((await fs.stat(output)).mode & 0o777).toBe(0o600)
    const zip = new StreamZip.async({ file: output })
    const entries: string[] = []
    zip.on('entry', ({ name }) => entries.push(name))
    try {
      await zip.entries()
      expect(entries.sort()).toEqual(['Configuration/configuration.json', 'metadata.json'])
      const inflated = await Promise.all(entries.map((name) => zip.entryData(name)))
      const bytes = Buffer.concat(inflated).toString()
      for (const sentinel of [
        'privatetopicsentinel',
        'privatemessagesentinel',
        'privatecompactionsentinel',
        'privatesessionsentinel',
        'privateagentsentinel',
        'privateattachmentsentinel',
        'privatetranslationsentinel',
        'privatedeletedsentinel',
        'privatefilebytesentinel',
        'privatecachesentinel',
        'privatebrowsersentinel',
        'privategzipsentinel',
        'excludedagentsecret'
      ])
        expect(bytes).not.toContain(sentinel)
      const payload = JSON.parse((await zip.entryData('Configuration/configuration.json')).toString())
      expect(Object.keys(payload.tables).sort()).toEqual([
        'agent',
        'assistant',
        'group',
        'preference',
        'prompt',
        'prompt_binding',
        'translate_language',
        'user_model',
        'user_provider'
      ])
      expect(JSON.parse((await zip.entryData('metadata.json')).toString())).toEqual({
        ...metadata(),
        timestamp: expect.any(Number)
      })
      expect(payload.tables.agent[0].configuration).toEqual({ avatar: '🌟' })
    } finally {
      await zip.close()
    }
    expect(holds.every((hold) => hold.dispose.mock.calls.length === 1)).toBe(true)
  })

  it('releases the backup mutex when the destination rejects the archive output', async () => {
    seed()
    const unwritable = path.join(root, 'unwritable')
    const writable = path.join(root, 'writable')
    await fs.mkdir(unwritable)
    await fs.mkdir(writable)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await fs.chmod(unwritable, 0o500)
      const deadline = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('configuration export did not settle after an output failure'))
        }, 15000)
      })
      await expect(Promise.race([manager.exportConfiguration(unwritable), deadline])).rejects.toThrow(/^EACCES:/)
      expect((await fs.readdir(root, { recursive: true })).sort()).toEqual(['unwritable', 'writable'])
      const output = await manager.exportConfiguration(writable)
      expect((await fs.stat(output)).isFile()).toBe(true)
      expect(await fs.readdir(unwritable)).toEqual([])
    } finally {
      clearTimeout(timer)
      await fs.chmod(unwritable, 0o700)
    }
  })

  it('restores into the same live DB, preserving history, search, attachment hashes and local-only definitions', async () => {
    seed()
    const output = await manager.exportConfiguration(root)
    dbh.db.update(assistantTable).set({ name: 'Destination', deletedAt: 123 }).run()
    dbh.db
      .insert(assistantTable)
      .values({ id: 'local', name: 'Keep local', emoji: '🌟', settings: DEFAULT_ASSISTANT_SETTINGS, orderKey: 'a0' })
      .run()
    const attachment = path.join(root, 'attachment')
    await fs.writeFile(attachment, 'destination attachment bytes')
    const beforeHash = hash(await fs.readFile(attachment))
    const before = snapshot()
    const beforeIdentity = await fs.stat(dbh.sqlite.name)
    const search = () =>
      ['message_fts', 'agent_session_message_fts'].map((name) =>
        dbh.sqlite.prepare(`SELECT rowid, searchable_text FROM ${name} WHERE ${name} MATCH 'sentinel'`).all()
      )
    const beforeSearch = search()
    holds.length = 0
    await manager.restore({} as Electron.IpcMainInvokeEvent, output)
    expect((await fs.stat(dbh.sqlite.name)).ino).toBe(beforeIdentity.ino)
    expect(hash(await fs.readFile(attachment))).toBe(beforeHash)
    const after = snapshot()
    for (const name of [
      'topic',
      'message',
      'message_fts',
      'agent_session',
      'agent_session_message',
      'agent_session_message_fts',
      'file_entry',
      'translate_history'
    ])
      expect(after[name], name).toEqual(before[name])
    expect(search()).toEqual(beforeSearch)
    expect(dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'assistant')).get()).toMatchObject({
      name: 'Exported definition',
      deletedAt: 123
    })
    expect(dbh.db.select().from(assistantTable).where(eq(assistantTable.id, 'local')).get()?.name).toBe('Keep local')
    const files = await fs.readdir(root, { recursive: true })
    expect(files.some((name) => /restore-journal|work\.sqlite|restore-staging|extract-/.test(name))).toBe(false)
    expect(holds).toHaveLength(5)
    expect(holds.every((hold) => hold.dispose.mock.calls.length === 0)).toBe(true)
    expect(application.relaunch).toHaveBeenCalledOnce()
  })

  it('refuses an oversized export before creating any output and releases its writer holds', async () => {
    seed()
    dbh.db
      .update(assistantTable)
      .set({ prompt: 'x'.repeat(32 * 1024 * 1024) })
      .run()
    await expect(manager.exportConfiguration(root)).rejects.toThrow('BACKUP_CONFIGURATION_INVALID')
    expect(await fs.readdir(root)).toEqual([])
    expect(holds).toHaveLength(5)
    expect(holds.every((hold) => hold.dispose.mock.calls.length === 1)).toBe(true)
    expect(application.get('DbService').withWriteTx).not.toHaveBeenCalled()
  })

  it.each([
    [
      'wrong format',
      (p: ConfigurationPayload) => {
        Object.assign(p, { formatVersion: 2 })
      },
      'INVALID'
    ],
    [
      'wrong edition',
      (p: ConfigurationPayload) => {
        p.edition = 'cn'
      },
      'INCOMPATIBLE'
    ],
    [
      'forked chain',
      (p: ConfigurationPayload) => {
        p.migrationChain[0].hash = 'fork'
      },
      'INCOMPATIBLE'
    ],
    [
      'older chain',
      (p: ConfigurationPayload) => {
        p.migrationChain.pop()
      },
      'INCOMPATIBLE'
    ],
    [
      'newer chain',
      (p: ConfigurationPayload) => {
        p.migrationChain.push({ folderMillis: Date.now() + 99999, hash: 'future' })
      },
      'INCOMPATIBLE'
    ],
    [
      'duplicate ids',
      (p: ConfigurationPayload) => {
        p.tables.agent.push(p.tables.agent[0])
      },
      'INVALID'
    ],
    [
      'unresolved reference',
      (p: ConfigurationPayload) => {
        p.tables.agent[0].model = 'missing::model'
      },
      'INVALID'
    ],
    [
      'missing preference key',
      (p: ConfigurationPayload) => {
        p.tables.preference.pop()
      },
      'INVALID'
    ]
  ])('rejects %s before any DB write', async (_name, mutate, code) => {
    seed()
    const payload = captureConfiguration(dbh.db, 'global')
    mutate(payload)
    const output = await candidate(payload)
    const before = snapshot()
    await expect(manager.restore({} as Electron.IpcMainInvokeEvent, output)).rejects.toThrow(
      `BACKUP_CONFIGURATION_${code}`
    )
    expect(snapshot()).toEqual(before)
    expect(application.get('DbService').withWriteTx).not.toHaveBeenCalled()
    expect(application.relaunch).not.toHaveBeenCalled()
  })

  it.each([
    'oversized payload',
    'oversized archive',
    'duplicate entry',
    'missing metadata',
    'extra entry',
    'directory',
    'symlink',
    'case alias',
    'Unicode alias',
    'mixed layout',
    'v8 full scope',
    'duplicate JSON member',
    'trailing content',
    'invalid UTF-8',
    'nonfinite JSON',
    'oversized metadata',
    'different app version'
  ])('rejects %s without touching the live DB', async (scenario) => {
    seed()
    const payload = captureConfiguration(dbh.db, 'global')
    const meta = metadata()
    const entries: [string, string | Buffer, number?][] = [
      ['metadata.json', JSON.stringify(meta)],
      ['Configuration/configuration.json', JSON.stringify(payload)]
    ]
    if (scenario === 'oversized payload' || scenario === 'oversized archive') {
      payload.tables.assistant[0].prompt = 'x'.repeat((scenario === 'oversized archive' ? 35 : 32) * 1024 * 1024)
      entries[1][1] = JSON.stringify(payload)
    }
    if (scenario === 'duplicate entry') entries.push(entries[1])
    if (scenario === 'missing metadata') entries.splice(0, 1)
    if (scenario === 'extra entry') entries.push(['Data/cherrystudio.sqlite', 'not permitted'])
    if (scenario === 'directory') entries.push(['Configuration/', ''])
    if (scenario === 'symlink') entries[1][2] = 0o120777
    if (scenario === 'case alias') entries.push(['configuration/configuration.json', '{}'])
    if (scenario === 'Unicode alias') entries.push(['Configuration/configuration\u200b.json', '{}'])
    if (scenario === 'mixed layout') entries[0][1] = JSON.stringify({ ...meta, version: 7 })
    if (scenario === 'v8 full scope') entries[0][1] = JSON.stringify({ ...meta, scope: 'full' })
    if (scenario === 'duplicate JSON member')
      entries[1][1] = String(entries[1][1]).replace('"formatVersion":1', '"formatVersion":2,"formatVersion":1')
    if (scenario === 'trailing content') entries[1][1] += '\n{}'
    if (scenario === 'invalid UTF-8') entries[1][1] = Buffer.from([0xff, 0x7b, 0x7d])
    if (scenario === 'nonfinite JSON')
      entries[1][1] = String(entries[1][1]).replace('"formatVersion":1', '"formatVersion":1e999')
    if (scenario === 'oversized metadata') entries[0][1] = JSON.stringify({ ...meta, platform: 'x'.repeat(16 * 1024) })
    if (scenario === 'different app version') entries[0][1] = JSON.stringify({ ...meta, appVersion: 'older' })
    const output = await writeArchive(entries, scenario === 'oversized archive')
    if (scenario === 'symlink') {
      const bytes = await fs.readFile(output)
      let offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]))
      while (offset >= 0 && bytes.readUInt32LE(offset) === 0x02014b50) {
        const length = bytes.readUInt16LE(offset + 28)
        if (bytes.subarray(offset + 46, offset + 46 + length).toString() === 'Configuration/configuration.json') {
          bytes.writeUInt32LE((0o120777 * 65536) >>> 0, offset + 38)
        }
        offset += 46 + length + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32)
      }
      await fs.writeFile(output, bytes)
    }
    const before = snapshot()
    await expect(manager.restore({} as Electron.IpcMainInvokeEvent, output)).rejects.toThrow(
      scenario === 'different app version'
        ? 'BACKUP_CONFIGURATION_INCOMPATIBLE'
        : scenario === 'oversized archive'
          ? 'Archive exceeds size limit'
          : 'BACKUP_CONFIGURATION_INVALID'
    )
    expect(snapshot()).toEqual(before)
    expect(application.get('DbService').withWriteTx).not.toHaveBeenCalled()
    expect(application.relaunch).not.toHaveBeenCalled()
  })
})
