import { createHash } from 'node:crypto'
import { access, link, mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { ZipArchive } from 'archiver'
import StreamZip from 'node-stream-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { messageService } from '@data/services/MessageService'
import { topicService } from '@data/services/TopicService'
import { diagnosticsErrorCodes } from '@shared/ipc/errors/diagnostics'

import type {
  ChatArchiveName,
  ChatRecordCandidate,
  ChatRecordCollection,
  ChatRecordReference
} from '../chatRecordCollector'
import * as chatRecordCollector from '../chatRecordCollector'
import * as sourceCollector from '../sourceCollector'
import * as sourceSelection from '../sourceSelection'

const electronMocks = vi.hoisted(() => ({
  getLocale: vi.fn(),
  getVersion: vi.fn(),
  showSaveDialog: vi.fn()
}))

const uploadMocks = vi.hoisted(() => ({
  upload: vi.fn()
}))

vi.mock('electron', () => ({
  app: {
    getLocale: electronMocks.getLocale,
    getName: () => 'Cherry Studio',
    getVersion: electronMocks.getVersion,
    isPackaged: true
  },
  dialog: { showSaveDialog: electronMocks.showSaveDialog }
}))

vi.mock('../CherryDiagnosticUploadClient', () => ({
  cherryDiagnosticUploadClient: uploadMocks
}))
vi.mock('@data/services/AgentSessionMessageService', () => ({
  agentSessionMessageService: { getSessionMessage: vi.fn() }
}))
vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { getById: vi.fn() }
}))
vi.mock('@data/services/MessageService', () => ({
  messageService: { getById: vi.fn() }
}))
vi.mock('@data/services/TopicService', () => ({
  topicService: { getById: vi.fn() }
}))

import { DiagnosticBundleService } from '../DiagnosticBundleService'

function chatRecordReference(
  archiveName: ChatArchiveName,
  key: string,
  entity: unknown,
  bytes?: number
): ChatRecordReference {
  return { archiveName, bytes: bytes ?? Buffer.byteLength(`${JSON.stringify(entity)}\n`, 'utf8'), key }
}

function chatCandidate(
  id: string,
  latestAt: number,
  [messageRecord, contextRecord]: [ChatRecordReference, ChatRecordReference]
): ChatRecordCandidate {
  const source = id.startsWith('agent-session-message:') ? 'agent-session' : 'normal-chat'
  return {
    contextId: contextRecord.key.slice(contextRecord.key.indexOf(':') + 1),
    contextRecord,
    id,
    kind: 'chatRecords',
    latestAt,
    messageId: id.slice(id.indexOf(':') + 1),
    messageRecord,
    source
  }
}

function chatCollection(
  candidates: ChatRecordCandidate[],
  warnings: ChatRecordCollection['warnings'] = new Set()
): ChatRecordCollection {
  return {
    candidates: (async function* () {
      yield* candidates
    })(),
    warnings
  }
}

function jsonlBytes(...entities: unknown[]): number {
  return entities.reduce<number>((bytes, entity) => bytes + Buffer.byteLength(`${JSON.stringify(entity)}\n`, 'utf8'), 0)
}

const REPORT_ID = 'opaque-report-id'
const RETRY_REPORT_ID = 'opaque-retry-report-id'
const UPLOAD_INPUT = {
  description: '  Line one\nLine two  ',
  includeChatRecords: false,
  includeLogs: false,
  includeTraces: false,
  range: '24h' as const
}

function formatLogDate(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

describe('DiagnosticBundleService', () => {
  let workDir: string
  let logsDir: string
  let tracesDir: string
  let crashDumpsDir: string
  let appTempDir: string
  let userDataDir: string
  let downloadsDir: string
  let destination: string
  const parentWindow = {}
  const preferenceService = { get: vi.fn(() => 'en-US') }

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(agentSessionMessageService.getSessionMessage).mockReset()
    vi.mocked(agentSessionService.getById).mockReset()
    vi.mocked(messageService.getById).mockReset()
    vi.mocked(topicService.getById).mockReset()
    workDir = await mkdtemp(path.join(tmpdir(), 'diagnostic-service-'))
    logsDir = path.join(workDir, 'logs')
    tracesDir = path.join(workDir, 'traces')
    crashDumpsDir = path.join(workDir, 'crashes')
    appTempDir = path.join(workDir, 'temp')
    userDataDir = path.join(workDir, 'user-data')
    downloadsDir = path.join(workDir, 'downloads')
    destination = path.join(workDir, 'bundle.zip')
    await Promise.all([
      mkdir(logsDir),
      mkdir(tracesDir),
      mkdir(crashDumpsDir),
      mkdir(appTempDir),
      mkdir(userDataDir),
      mkdir(downloadsDir)
    ])

    vi.mocked(application.getPath).mockImplementation((key: string, fileName?: string) => {
      const roots: Record<string, string> = {
        'app.crash_dumps': crashDumpsDir,
        'app.logs': logsDir,
        'app.temp': appTempDir,
        'app.userdata': userDataDir,
        'feature.trace': tracesDir,
        'sys.downloads': downloadsDir
      }
      const root = roots[key] ?? workDir
      return fileName ? path.join(root, fileName) : root
    })
    vi.mocked(application.get).mockImplementation((name: string) => {
      if (name === 'PreferenceService') return preferenceService as never
      if (name === 'WindowManager') return { getWindow: () => parentWindow } as never
      throw new Error(`Unexpected service: ${name}`)
    })

    electronMocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath: destination })
    electronMocks.getLocale.mockReturnValue('en-US')
    electronMocks.getVersion.mockReturnValue('2.0.0-test')
    uploadMocks.upload.mockResolvedValue({ reportId: REPORT_ID, status: 'uploaded' })
  })

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true })
  })

  async function readZip(zipPath: string) {
    const zip = new StreamZip.async({ file: zipPath })
    try {
      const entries = Object.keys(await zip.entries()).sort()
      const contents: Record<string, Buffer> = {}
      for (const entry of entries) contents[entry] = await zip.entryData(entry)
      return { contents, entries }
    } finally {
      await zip.close()
    }
  }

  async function sha256(filePath: string): Promise<string> {
    return createHash('sha256')
      .update(await readFile(filePath))
      .digest('hex')
  }

  async function getRetainedUploadPath(): Promise<string> {
    const tempEntries = await readdir(appTempDir)
    expect(tempEntries).toHaveLength(1)
    const uploadRoot = path.join(appTempDir, tempEntries[0])
    const uploadEntries = await readdir(uploadRoot)
    expect(uploadEntries).toHaveLength(1)
    return path.join(uploadRoot, uploadEntries[0])
  }

  it('exports filtered logs, persisted traces, whitelisted system data, and crash inventory', async () => {
    const now = Date.now()
    const logFileName = `app.${formatLogDate(now)}.log`
    const recentLog = `${JSON.stringify({ message: 'recent', timestamp: new Date(now - 1_000).toISOString() })}\n`
    const oldLog = `${JSON.stringify({ message: 'old', timestamp: new Date(now - 2 * 86_400_000).toISOString() })}\n`
    await writeFile(path.join(logsDir, logFileName), `${oldLog}${recentLog}`)

    // `:` and `*` exercise archive-name sanitisation but are unwriteable on Windows.
    const isWin = process.platform === 'win32'
    const topicDir = path.join(tracesDir, isWin ? 'topic-private' : 'topic:private')
    await mkdir(topicDir)
    const traceLine = `${JSON.stringify({ id: 'span', startTime: now - 2_000, value: 'raw trace' })}\n`
    await writeFile(path.join(topicDir, isWin ? 'trace-one' : 'trace*one'), traceLine)
    // The inventory filters by mtime against a range the service closes at its own Date.now(),
    // which Windows can read a few ms behind the clock the filesystem stamped the file with.
    const crashDumpPath = path.join(crashDumpsDir, 'private-crash-name.dmp')
    await writeFile(crashDumpPath, 'dump')
    await utimes(crashDumpPath, new Date(now - 1_000), new Date(now - 1_000))

    const service = new DiagnosticBundleService()
    const result = await service.exportBundle(
      { includeChatRecords: false, includeLogs: true, includeTraces: true, range: '24h' },
      'main-window'
    )

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.fileName).toBe('bundle.zip')
    expect(result.filePath).toBe(destination)
    expect(result.hasWarnings).toBe(false)
    expect(result.includedFileCount).toBe(2)
    expect(result.omittedFileCount).toBe(0)

    const zip = await readZip(destination)
    expect(zip.entries).toHaveLength(4)
    expect(zip.entries).toContain('diagnostics.json')
    expect(zip.entries).toContain('scan/findings.json')
    expect(zip.entries).toContain(`logs/${logFileName}`)
    expect(zip.entries.some((entry) => /^traces\/[0-9a-f]+\/[0-9a-f]+\.jsonl$/.test(entry))).toBe(true)
    expect(zip.entries.some((entry) => entry.endsWith('.dmp'))).toBe(false)
    expect(zip.contents[`logs/${logFileName}`].toString()).toBe(recentLog)

    const manifestText = zip.contents['diagnostics.json'].toString()
    const manifest = JSON.parse(manifestText)
    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.privacy).toEqual({
      containsUnredactedData: true,
      publiclyShareable: false,
      uploadedAutomatically: false
    })
    expect(manifest.crashDumps.files).toHaveLength(1)
    expect(manifest.system.application).toEqual({
      isPackaged: true,
      name: 'Cherry Studio',
      version: '2.0.0-test'
    })
    expect(manifest.system.operatingSystem).toMatchObject({ locale: 'en-US' })
    expect(manifest.sources.chatRecords).toEqual({
      included: { bytes: 0, messageCount: 0, recordCount: 0 },
      omitted: { bytes: 0, messageCount: 0, recordCount: 0 }
    })
    expect(manifestText).not.toContain('private-crash-name')
    expect(manifestText).not.toContain(userDataDir)
  })

  it('exports canonical normal-chat and agent-session records with manifest v2 statistics', async () => {
    const topic = { id: 'topic-1', name: 'Topic' }
    const message = {
      id: 'message-1',
      topicId: topic.id,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'hello' }] },
      createdAt: '2026-08-25T00:02:00.000Z'
    }
    const session = { id: 'session-1', agentId: 'agent-1', name: 'Agent session' }
    const agentMessage = {
      id: 'agent-message-1',
      sessionId: session.id,
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'agent reply' }] },
      createdAt: '2026-08-25T00:01:00.000Z'
    }
    const candidates = [
      chatCandidate('message:message-1', Date.parse(message.createdAt), [
        chatRecordReference('chats/messages.jsonl', 'message:message-1', message),
        chatRecordReference('chats/topics.jsonl', 'topic:topic-1', topic)
      ]),
      chatCandidate('agent-session-message:agent-message-1', Date.parse(agentMessage.createdAt), [
        chatRecordReference(
          'chats/agent-session-messages.jsonl',
          'agent-session-message:agent-message-1',
          agentMessage
        ),
        chatRecordReference('chats/agent-sessions.jsonl', 'agent-session:session-1', session)
      ])
    ]
    vi.mocked(messageService.getById).mockReturnValue(message as never)
    vi.mocked(topicService.getById).mockReturnValue(topic as never)
    vi.mocked(agentSessionMessageService.getSessionMessage).mockReturnValue(agentMessage as never)
    vi.mocked(agentSessionService.getById).mockReturnValue(session as never)
    const collection = chatCollection(candidates)
    const collectSpy = vi.spyOn(chatRecordCollector, 'collectChatRecords').mockReturnValue(collection)
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: true, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', includedFileCount: 4, omittedFileCount: 0 })
      const zip = await readZip(destination)
      expect(zip.entries).toEqual([
        'chats/agent-session-messages.jsonl',
        'chats/agent-sessions.jsonl',
        'chats/messages.jsonl',
        'chats/topics.jsonl',
        'diagnostics.json'
      ])
      expect(JSON.parse(zip.contents['chats/topics.jsonl'].toString('utf8'))).toEqual(topic)
      expect(JSON.parse(zip.contents['chats/messages.jsonl'].toString('utf8'))).toEqual(message)
      expect(JSON.parse(zip.contents['chats/agent-sessions.jsonl'].toString('utf8'))).toEqual(session)
      expect(JSON.parse(zip.contents['chats/agent-session-messages.jsonl'].toString('utf8'))).toEqual(agentMessage)

      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      const expectedBytes = jsonlBytes(topic, message, session, agentMessage)
      expect(manifest).toMatchObject({
        schemaVersion: 2,
        privacy: { containsUnredactedData: true },
        selection: { includeChatRecords: true },
        sources: {
          chatRecords: {
            included: { bytes: expectedBytes, messageCount: 2, recordCount: 4 },
            omitted: { bytes: 0, messageCount: 0, recordCount: 0 }
          }
        }
      })
    } finally {
      collectSpy.mockRestore()
    }
  })

  it('omits older whole chat messages when chat records exceed the shared source budget', async () => {
    const mib = 1024 * 1024
    const topicEntity = { id: 'topic-1' }
    const newerEntity = { id: 'newer' }
    const topic = chatRecordReference('chats/topics.jsonl', 'topic:1', topicEntity, mib)
    const newer = chatCandidate('message:newer', 2, [
      chatRecordReference('chats/messages.jsonl', 'message:newer', newerEntity, 40 * mib),
      topic
    ])
    const older = chatCandidate('message:older', 1, [
      chatRecordReference('chats/messages.jsonl', 'message:older', { id: 'older' }, 20 * mib),
      topic
    ])
    vi.mocked(messageService.getById).mockReturnValue(newerEntity as never)
    vi.mocked(topicService.getById).mockReturnValue(topicEntity as never)
    const collectSpy = vi
      .spyOn(chatRecordCollector, 'collectChatRecords')
      .mockReturnValue(chatCollection([newer, older]))
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: true, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', hasWarnings: true, includedFileCount: 2, omittedFileCount: 0 })
      const zip = await readZip(destination)
      const messageLines = zip.contents['chats/messages.jsonl'].toString('utf8').trim().split('\n')
      expect(messageLines.map((line) => JSON.parse(line))).toEqual([{ id: 'newer' }])
      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      const actualIncludedBytes =
        Buffer.byteLength(`${JSON.stringify(newerEntity)}\n`, 'utf8') +
        Buffer.byteLength(`${JSON.stringify(topicEntity)}\n`, 'utf8')
      expect(manifest.sources.chatRecords).toEqual({
        included: { bytes: actualIncludedBytes, messageCount: 1, recordCount: 2 },
        omitted: { bytes: 20 * mib, messageCount: 1, recordCount: 1 }
      })
      expect(manifest.warnings).toContain('size_limit_reached')
      expect(manifest.warnings).toContain('source_changed')
    } finally {
      collectSpy.mockRestore()
    }
  })

  it('keeps one representative from logs, traces, and chat records before spending the remaining source budget', async () => {
    const now = Date.now()
    const logFileName = `app.${formatLogDate(now)}.log`
    const olderLogFileName = `app-error.${formatLogDate(now)}.log`
    const newerLog = `${JSON.stringify({
      details: 'l'.repeat(100),
      message: 'newer-log',
      timestamp: new Date(now - 1_000).toISOString()
    })}\n`
    const olderLog = `${JSON.stringify({
      details: 'l'.repeat(100),
      message: 'older-log',
      timestamp: new Date(now - 2_000).toISOString()
    })}\n`
    const trace = `${JSON.stringify({ payload: 't'.repeat(200), startTime: now - 3_000 })}\n`
    await Promise.all([
      writeFile(path.join(logsDir, logFileName), newerLog),
      writeFile(path.join(logsDir, olderLogFileName), olderLog),
      mkdir(path.join(tracesDir, 'topic-private'))
    ])
    await writeFile(path.join(tracesDir, 'topic-private', 'trace-one'), trace)

    const message = { id: 'chat-1', text: 'message' }
    const topic = { id: 'topic-1', name: 'Topic' }
    const candidate = chatCandidate('message:chat-1', now - 4_000, [
      chatRecordReference('chats/messages.jsonl', 'message:chat-1', message),
      chatRecordReference('chats/topics.jsonl', 'topic:topic-1', topic)
    ])
    const budgetBytes =
      Buffer.byteLength(newerLog, 'utf8') + Buffer.byteLength(trace, 'utf8') + jsonlBytes(message, topic)
    vi.mocked(messageService.getById).mockReturnValue(message as never)
    vi.mocked(topicService.getById).mockReturnValue(topic as never)
    const collectSpy = vi.spyOn(chatRecordCollector, 'collectChatRecords').mockReturnValue(chatCollection([candidate]))
    const createSelector = sourceSelection.createDiagnosticBudgetSelector
    const selectorSpy = vi
      .spyOn(sourceSelection, 'createDiagnosticBudgetSelector')
      .mockImplementation(() => createSelector(budgetBytes))
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: true, includeLogs: true, includeTraces: true, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', hasWarnings: true, includedFileCount: 4, omittedFileCount: 1 })
      const zip = await readZip(destination)
      expect(zip.entries).toContain(`logs/${logFileName}`)
      expect(zip.entries).not.toContain(`logs/${olderLogFileName}`)
      expect(zip.entries.some((entry) => entry.startsWith('traces/'))).toBe(true)
      expect(zip.entries).toContain('chats/messages.jsonl')
      expect(zip.entries).toContain('chats/topics.jsonl')
      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(manifest.sources.logs).toMatchObject({ included: { fileCount: 1 }, omitted: { fileCount: 1 } })
      expect(manifest.sources.traces).toMatchObject({ included: { fileCount: 1 }, omitted: { fileCount: 0 } })
      expect(manifest.sources.chatRecords).toMatchObject({
        included: { messageCount: 1, recordCount: 2 },
        omitted: { messageCount: 0, recordCount: 0 }
      })
      expect(manifest.warnings).toContain('size_limit_reached')
    } finally {
      selectorSpy.mockRestore()
      collectSpy.mockRestore()
    }
  })

  it('uses the lexicographically earlier archive key when equal log candidates compete for the final budget', async () => {
    const now = Date.now()
    const logFileNames = [`app-error.${formatLogDate(now)}.log`, `app.${formatLogDate(now)}.log`]
    const logLine = `${JSON.stringify({ message: 'same-size', timestamp: new Date(now - 1_000).toISOString() })}\n`
    await Promise.all(logFileNames.map((fileName) => writeFile(path.join(logsDir, fileName), logLine)))

    const archiveNames = logFileNames.map((fileName) => `logs/${fileName}`).sort()
    const collectSources = sourceCollector.collectDiagnosticSources
    const collectionSpy = vi.spyOn(sourceCollector, 'collectDiagnosticSources').mockImplementation(async (...args) => {
      const collection = await collectSources(...args)
      return {
        ...collection,
        logs: [...collection.logs].sort((a, b) =>
          a.archiveName < b.archiveName ? 1 : a.archiveName > b.archiveName ? -1 : 0
        )
      }
    })
    const createSelector = sourceSelection.createDiagnosticBudgetSelector
    const selectorSpy = vi
      .spyOn(sourceSelection, 'createDiagnosticBudgetSelector')
      .mockImplementation(() => createSelector(Buffer.byteLength(logLine, 'utf8')))
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', hasWarnings: true, includedFileCount: 1, omittedFileCount: 1 })
      const zip = await readZip(destination)
      expect(zip.entries).toContain(archiveNames[0])
      expect(zip.entries).not.toContain(archiveNames[1])
      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(manifest.sources.logs).toMatchObject({ included: { fileCount: 1 }, omitted: { fileCount: 1 } })
      expect(manifest.warnings).toContain('size_limit_reached')
    } finally {
      collectionSpy.mockRestore()
      selectorSpy.mockRestore()
    }
  })

  it('counts chat archive families omitted entirely by the shared source budget', async () => {
    const mib = 1024 * 1024
    const candidate = chatCandidate('message:oversized', 1, [
      chatRecordReference('chats/messages.jsonl', 'message:oversized', { id: 'oversized' }, 51 * mib),
      chatRecordReference('chats/topics.jsonl', 'topic:1', { id: 'topic-1' })
    ])
    const collectSpy = vi.spyOn(chatRecordCollector, 'collectChatRecords').mockReturnValue(chatCollection([candidate]))
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: true, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', hasWarnings: true, includedFileCount: 0, omittedFileCount: 2 })
      const zip = await readZip(destination)
      expect(zip.entries).toEqual(['diagnostics.json'])
      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(manifest.sources.chatRecords).toMatchObject({
        included: { messageCount: 0, recordCount: 0 },
        omitted: { messageCount: 1, recordCount: 2 }
      })
      expect(manifest.warnings).toContain('size_limit_reached')
    } finally {
      collectSpy.mockRestore()
    }
  })

  it('keeps readable file sources when selected chat records cannot be staged', async () => {
    const now = Date.now()
    const logFileName = `app.${formatLogDate(now)}.log`
    await writeFile(
      path.join(logsDir, logFileName),
      `${JSON.stringify({ message: 'recent', timestamp: new Date(now - 1_000).toISOString() })}\n`
    )
    const message = { id: 'message-1' }
    const topic = { id: 'topic-1' }
    const candidate = chatCandidate('message:1', now - 2_000, [
      chatRecordReference('chats/messages.jsonl', 'message:1', message),
      chatRecordReference('chats/topics.jsonl', 'topic:1', topic)
    ])
    const collection = chatCollection([candidate])
    const collectSpy = vi.spyOn(chatRecordCollector, 'collectChatRecords').mockReturnValue(collection)
    const stageSpy = vi.spyOn(chatRecordCollector, 'stageChatRecords').mockRejectedValueOnce(new Error('disk failed'))
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: true, includeLogs: true, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', hasWarnings: true, includedFileCount: 1, omittedFileCount: 2 })
      const zip = await readZip(destination)
      expect(zip.entries).toContain(`logs/${logFileName}`)
      expect(zip.entries.some((entry) => entry.startsWith('chats/'))).toBe(false)
      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(manifest.sources.chatRecords).toEqual({
        included: { bytes: 0, messageCount: 0, recordCount: 0 },
        omitted: {
          bytes: jsonlBytes(message, topic),
          messageCount: 1,
          recordCount: 2
        }
      })
      expect(manifest.warnings).toContain('source_unreadable')
    } finally {
      collectSpy.mockRestore()
      stageSpy.mockRestore()
    }
  })

  it('counts only missing chat archives when one chat family cannot be hydrated', async () => {
    const topic = { id: 'topic-1', name: 'Topic' }
    const message = {
      id: 'message-1',
      topicId: topic.id,
      role: 'user',
      data: { parts: [{ type: 'text', text: 'hello' }] },
      createdAt: '2026-08-25T00:01:00.000Z'
    }
    const session = { id: 'session-1', agentId: 'agent-1', name: 'Agent session' }
    const agentMessage = {
      id: 'agent-message-1',
      sessionId: session.id,
      role: 'assistant',
      data: { parts: [{ type: 'text', text: 'agent reply' }] },
      createdAt: '2026-08-25T00:02:00.000Z'
    }
    const candidates = [
      chatCandidate('agent-session-message:agent-message-1', Date.parse(agentMessage.createdAt), [
        chatRecordReference(
          'chats/agent-session-messages.jsonl',
          'agent-session-message:agent-message-1',
          agentMessage
        ),
        chatRecordReference('chats/agent-sessions.jsonl', 'agent-session:session-1', session)
      ]),
      chatCandidate('message:message-1', Date.parse(message.createdAt), [
        chatRecordReference('chats/messages.jsonl', 'message:message-1', message),
        chatRecordReference('chats/topics.jsonl', 'topic:topic-1', topic)
      ])
    ]
    vi.mocked(agentSessionMessageService.getSessionMessage).mockImplementation(() => {
      throw new Error('agent chat unavailable')
    })
    vi.mocked(messageService.getById).mockReturnValue(message as never)
    vi.mocked(topicService.getById).mockReturnValue(topic as never)
    const collectSpy = vi.spyOn(chatRecordCollector, 'collectChatRecords').mockReturnValue(chatCollection(candidates))
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: true, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result).toMatchObject({ status: 'saved', hasWarnings: true, includedFileCount: 2, omittedFileCount: 2 })
      const zip = await readZip(destination)
      expect(zip.entries).toContain('chats/messages.jsonl')
      expect(zip.entries).toContain('chats/topics.jsonl')
      expect(zip.entries).not.toContain('chats/agent-session-messages.jsonl')
      expect(zip.entries).not.toContain('chats/agent-sessions.jsonl')
    } finally {
      collectSpy.mockRestore()
    }
  })

  it('returns canceled without scanning or writing when the save dialog is canceled', async () => {
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: true, includeTraces: true, range: '24h' },
        'main-window'
      )
    ).resolves.toEqual({ status: 'canceled' })
  })

  it('exports only the manifest when logs and traces are disabled', async () => {
    await Promise.all([rm(logsDir, { recursive: true }), rm(tracesDir, { recursive: true })])
    await Promise.all([writeFile(logsDir, 'not a directory'), writeFile(tracesDir, 'not a directory')])
    const collectSpy = vi.spyOn(chatRecordCollector, 'collectChatRecords')
    const service = new DiagnosticBundleService()

    try {
      const result = await service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )

      expect(result.status).toBe('saved')
      if (result.status !== 'saved') throw new Error('Expected saved result')
      expect(result.hasWarnings).toBe(false)
      const zip = await readZip(destination)
      expect(zip.entries).toEqual(['diagnostics.json'])
      expect(zip.entries.some((entry) => entry.startsWith('chats/'))).toBe(false)
      const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(manifest.selection).toMatchObject({
        includeChatRecords: false,
        includeLogs: false,
        includeSystemInformation: true,
        includeTraces: false
      })
      expect(manifest.privacy.containsUnredactedData).toBe(false)
      expect(collectSpy).not.toHaveBeenCalled()
    } finally {
      collectSpy.mockRestore()
    }
  })

  it('uses the main-process clock after the save dialog closes', async () => {
    const exportStartedAt = new Date('2026-07-30T00:15:00.000Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(exportStartedAt.getTime())
    const service = new DiagnosticBundleService()

    try {
      await service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )
    } finally {
      clock.mockRestore()
    }

    const zip = await readZip(destination)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.createdAt).toBe(exportStartedAt.toISOString())
    expect(manifest.range.to).toBe(exportStartedAt.toISOString())
  })

  it('continues when application metadata collection fails', async () => {
    electronMocks.getVersion.mockImplementation(() => {
      throw new Error('version unavailable')
    })
    const service = new DiagnosticBundleService()

    const result = await service.exportBundle(
      { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
      'main-window'
    )

    expect(result.status).toBe('saved')
    if (result.status !== 'saved') throw new Error('Expected saved result')
    expect(result.hasWarnings).toBe(true)
    const zip = await readZip(destination)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.system.application).toBeUndefined()
    expect(manifest.system.operatingSystem.locale).toBe('en-US')
  })

  it('returns busy while another save dialog is open', async () => {
    let resolveDialog: (value: { canceled: boolean; filePath: string }) => void = () => undefined
    electronMocks.showSaveDialog.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveDialog = resolve
        })
    )
    const service = new DiagnosticBundleService()
    const first = service.exportBundle(
      { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
      'main-window'
    )

    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )
    ).resolves.toEqual({ status: 'busy' })
    resolveDialog({ canceled: true, filePath: '' })
    await expect(first).resolves.toEqual({ status: 'canceled' })
  })

  it('uploads a bundle with the normalized description and returns the opaque report id unchanged', async () => {
    let uploadedManifest: Record<string, unknown> | undefined
    uploadMocks.upload.mockImplementationOnce(async ({ description, fileName, filePath: uploadPath }) => {
      const zip = await readZip(uploadPath)
      uploadedManifest = JSON.parse(zip.contents['diagnostics.json'].toString())
      expect(description).toBe('Line one\r\nLine two')
      expect(fileName).toBe(path.basename(uploadPath))
      return { reportId: REPORT_ID, status: 'uploaded' }
    })
    const service = new DiagnosticBundleService()

    const result = await service.uploadBundle(UPLOAD_INPUT)

    expect(result).toEqual({ reportId: REPORT_ID, status: 'uploaded' })
    expect(uploadedManifest?.privacy).toMatchObject({ uploadedAutomatically: true })
    expect(await readdir(appTempDir)).toEqual([])
    expect(await readdir(downloadsDir)).toEqual([])
  })

  it('retains a failed upload in app temp without writing to Downloads', async () => {
    uploadMocks.upload.mockResolvedValueOnce({
      fileSha256: 'a'.repeat(64),
      reason: 'rate_limited',
      status: 'rejected'
    })
    const service = new DiagnosticBundleService()

    const result = await service.uploadBundle(UPLOAD_INPUT)

    if (result.status !== 'submission_failed') throw new Error('Expected preserved failed submission')
    expect(result).toEqual({
      bundleId: expect.any(String),
      fileName: expect.any(String),
      reason: 'rate_limited',
      status: 'submission_failed'
    })
    expect(result.fileName).toMatch(
      /^cherry-studio-diagnostics-\d{8}-\d{6}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.zip$/
    )
    const retainedPath = await getRetainedUploadPath()
    expect(path.basename(retainedPath)).toBe(result.fileName)
    const zip = await readZip(retainedPath)
    const manifest = JSON.parse(zip.contents['diagnostics.json'].toString())
    expect(manifest.privacy.uploadedAutomatically).toBe(true)
    expect(await readdir(downloadsDir)).toEqual([])
  })

  it('retains the bundle without retrying when submission status is unknown', async () => {
    uploadMocks.upload.mockResolvedValueOnce({ fileSha256: 'a'.repeat(64), status: 'submission_unknown' })
    const service = new DiagnosticBundleService()

    const result = await service.uploadBundle(UPLOAD_INPUT)

    if (result.status !== 'submission_unknown') throw new Error('Expected unknown submission status')
    expect(result).toEqual({
      bundleId: expect.any(String),
      fileName: expect.any(String),
      status: 'submission_unknown'
    })
    await expect(access(await getRetainedUploadPath())).resolves.toBeUndefined()
    expect(await readdir(downloadsDir)).toEqual([])
    expect(uploadMocks.upload).toHaveBeenCalledOnce()
  })

  it('retries the same temporary archive and removes it after success', async () => {
    const fileSha256 = 'a'.repeat(64)
    uploadMocks.upload
      .mockResolvedValueOnce({ fileSha256, reason: 'service_unavailable', status: 'rejected' })
      .mockResolvedValueOnce({ reason: 'rate_limited', status: 'rejected' })
      .mockResolvedValueOnce({ reportId: RETRY_REPORT_ID, status: 'uploaded' })
    const service = new DiagnosticBundleService()

    const first = await service.uploadBundle(UPLOAD_INPUT)
    if (first.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    const retainedPath = await getRetainedUploadPath()
    const originalArchive = await readFile(retainedPath)

    const retryFailed = await service.retryUpload({ bundleId: first.bundleId })
    const retried = await service.retryUpload({ bundleId: first.bundleId })

    expect(retryFailed).toEqual({
      bundleId: first.bundleId,
      fileName: first.fileName,
      reason: 'rate_limited',
      status: 'submission_failed'
    })
    expect(retried).toEqual({ reportId: RETRY_REPORT_ID, status: 'uploaded' })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(1, {
      description: 'Line one\r\nLine two',
      fileName: first.fileName,
      filePath: expect.stringContaining(`${path.sep}temp${path.sep}`)
    })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(2, {
      description: 'Line one\r\nLine two',
      expectedFileSha256: fileSha256,
      fileName: first.fileName,
      filePath: retainedPath
    })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(3, {
      description: 'Line one\r\nLine two',
      expectedFileSha256: fileSha256,
      fileName: first.fileName,
      filePath: retainedPath
    })
    expect(originalArchive.byteLength).toBeGreaterThan(0)
    await expect(access(retainedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(appTempDir)).toEqual([])
    await expect(service.retryUpload({ bundleId: first.bundleId })).rejects.toMatchObject({
      code: diagnosticsErrorCodes.RETRY_NOT_AVAILABLE
    })
  })

  it('rejects a retry when the retained archive no longer matches the initially uploaded content', async () => {
    uploadMocks.upload.mockImplementation(async (input: { expectedFileSha256?: string; filePath: string }) => {
      const fileSha256 = await sha256(input.filePath)
      if (!input.expectedFileSha256) {
        return { fileSha256, reason: 'service_unavailable', status: 'rejected' }
      }
      if (fileSha256 !== input.expectedFileSha256) {
        return { reason: 'invalid_archive', status: 'rejected' }
      }
      return { reportId: RETRY_REPORT_ID, status: 'uploaded' }
    })
    const service = new DiagnosticBundleService()

    const first = await service.uploadBundle(UPLOAD_INPUT)
    if (first.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    await writeFile(await getRetainedUploadPath(), 'replacement archive')

    await expect(service.retryUpload({ bundleId: first.bundleId })).resolves.toEqual({
      bundleId: first.bundleId,
      fileName: first.fileName,
      reason: 'invalid_archive',
      status: 'submission_failed'
    })
  })

  it('keeps a temporary upload available when saving is canceled', async () => {
    const fileSha256 = 'a'.repeat(64)
    uploadMocks.upload.mockResolvedValueOnce({ fileSha256, reason: 'service_unavailable', status: 'rejected' })
    const service = new DiagnosticBundleService()

    const failed = await service.uploadBundle(UPLOAD_INPUT)
    if (failed.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    const retainedPath = await getRetainedUploadPath()
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: '' })

    await expect(service.saveUploadBundle({ bundleId: failed.bundleId }, 'main-window')).resolves.toEqual({
      status: 'canceled'
    })
    await expect(access(retainedPath)).resolves.toBeUndefined()
  })

  it('moves a temporary upload to the selected path and never deletes the saved file after retry success', async () => {
    const fileSha256 = 'a'.repeat(64)
    const savedPath = path.join(workDir, 'saved-diagnostics.zip')
    uploadMocks.upload
      .mockResolvedValueOnce({ fileSha256, reason: 'service_unavailable', status: 'rejected' })
      .mockResolvedValueOnce({ reportId: RETRY_REPORT_ID, status: 'uploaded' })
    const service = new DiagnosticBundleService()

    const failed = await service.uploadBundle(UPLOAD_INPUT)
    if (failed.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    const retainedPath = await getRetainedUploadPath()
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: savedPath })

    await expect(service.saveUploadBundle({ bundleId: failed.bundleId }, 'main-window')).resolves.toEqual({
      bundleId: failed.bundleId,
      fileName: path.basename(savedPath),
      filePath: savedPath,
      status: 'saved'
    })
    await expect(access(retainedPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(appTempDir)).toEqual([])

    await expect(service.retryUpload({ bundleId: failed.bundleId })).resolves.toEqual({
      reportId: RETRY_REPORT_ID,
      status: 'uploaded'
    })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(2, {
      description: 'Line one\r\nLine two',
      expectedFileSha256: fileSha256,
      fileName: failed.fileName,
      filePath: savedPath
    })
    await expect(access(savedPath)).resolves.toBeUndefined()
  })

  it('keeps the logical ZIP file name when retrying from an extensionless saved path', async () => {
    const fileSha256 = 'a'.repeat(64)
    const savedPath = path.join(workDir, 'saved-diagnostics')
    uploadMocks.upload
      .mockResolvedValueOnce({ fileSha256, reason: 'service_unavailable', status: 'rejected' })
      .mockImplementationOnce(async ({ fileName }: { fileName: string }) =>
        fileName.endsWith('.zip')
          ? { reportId: RETRY_REPORT_ID, status: 'uploaded' }
          : { reason: 'invalid_archive', status: 'rejected' }
      )
    const service = new DiagnosticBundleService()

    const failed = await service.uploadBundle(UPLOAD_INPUT)
    if (failed.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: savedPath })

    await expect(service.saveUploadBundle({ bundleId: failed.bundleId }, 'main-window')).resolves.toEqual({
      bundleId: failed.bundleId,
      fileName: path.basename(savedPath),
      filePath: savedPath,
      status: 'saved'
    })
    await expect(service.retryUpload({ bundleId: failed.bundleId })).resolves.toEqual({
      reportId: RETRY_REPORT_ID,
      status: 'uploaded'
    })
    expect(uploadMocks.upload).toHaveBeenNthCalledWith(2, {
      description: 'Line one\r\nLine two',
      expectedFileSha256: fileSha256,
      fileName: failed.fileName,
      filePath: savedPath
    })
    await expect(access(savedPath)).resolves.toBeUndefined()
  })

  it('discards an unsaved temporary upload but preserves a user-saved upload', async () => {
    const fileSha256 = 'a'.repeat(64)
    const savedPath = path.join(workDir, 'saved-diagnostics.zip')
    uploadMocks.upload.mockResolvedValue({ fileSha256, reason: 'service_unavailable', status: 'rejected' })
    const service = new DiagnosticBundleService()

    const unsaved = await service.uploadBundle(UPLOAD_INPUT)
    if (unsaved.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    const retainedPath = await getRetainedUploadPath()
    await expect(service.discardUpload({ bundleId: unsaved.bundleId })).resolves.toEqual({ status: 'discarded' })
    await expect(access(retainedPath)).rejects.toMatchObject({ code: 'ENOENT' })

    const toSave = await service.uploadBundle(UPLOAD_INPUT)
    if (toSave.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: savedPath })
    await service.saveUploadBundle({ bundleId: toSave.bundleId }, 'main-window')

    await expect(service.discardUpload({ bundleId: toSave.bundleId })).resolves.toEqual({ status: 'discarded' })
    await expect(access(savedPath)).resolves.toBeUndefined()
    await expect(service.retryUpload({ bundleId: toSave.bundleId })).rejects.toMatchObject({
      code: diagnosticsErrorCodes.RETRY_NOT_AVAILABLE
    })
  })

  it('rejects a retry id that is not owned by this process', async () => {
    const service = new DiagnosticBundleService()

    await expect(service.retryUpload({ bundleId: '323e4567-e89b-42d3-a456-426614174000' })).rejects.toMatchObject({
      code: diagnosticsErrorCodes.RETRY_NOT_AVAILABLE
    })
    expect(uploadMocks.upload).not.toHaveBeenCalled()
  })

  it('serializes export, initial upload, and retry through one in-flight operation', async () => {
    let resolveUpload: (value: { reportId: string; status: 'uploaded' }) => void = () => undefined
    uploadMocks.upload.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveUpload = resolve
        })
    )
    const service = new DiagnosticBundleService()
    const first = service.uploadBundle(UPLOAD_INPUT)

    await vi.waitFor(() => expect(uploadMocks.upload).toHaveBeenCalledOnce())
    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )
    ).resolves.toEqual({ status: 'busy' })
    await expect(service.retryUpload({ bundleId: '423e4567-e89b-42d3-a456-426614174000' })).resolves.toEqual({
      status: 'busy'
    })
    await expect(
      service.saveUploadBundle({ bundleId: '423e4567-e89b-42d3-a456-426614174000' }, 'main-window')
    ).resolves.toEqual({ status: 'busy' })
    await expect(service.discardUpload({ bundleId: '423e4567-e89b-42d3-a456-426614174000' })).resolves.toEqual({
      status: 'busy'
    })
    resolveUpload({ reportId: REPORT_ID, status: 'uploaded' })
    await expect(first).resolves.toMatchObject({ status: 'uploaded' })
  })

  it('uses a stable diagnostics error when upload bundle construction fails', async () => {
    await rm(appTempDir, { recursive: true })
    await writeFile(appTempDir, 'not a directory')
    const service = new DiagnosticBundleService()

    await expect(service.uploadBundle(UPLOAD_INPUT)).rejects.toMatchObject({
      code: diagnosticsErrorCodes.BUNDLE_BUILD_FAILED
    })
    expect(uploadMocks.upload).not.toHaveBeenCalled()
  })

  it('uses a stable diagnostics error when a temporary upload cannot be saved to the selected path', async () => {
    uploadMocks.upload.mockResolvedValueOnce({
      fileSha256: 'a'.repeat(64),
      reason: 'service_unavailable',
      status: 'rejected'
    })
    const service = new DiagnosticBundleService()

    const failed = await service.uploadBundle(UPLOAD_INPUT)
    if (failed.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    const retainedPath = await getRetainedUploadPath()
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(workDir, 'missing-parent', 'diagnostics.zip')
    })

    await expect(service.saveUploadBundle({ bundleId: failed.bundleId }, 'main-window')).rejects.toMatchObject({
      code: diagnosticsErrorCodes.FALLBACK_SAVE_FAILED
    })
    await expect(access(retainedPath)).resolves.toBeUndefined()
  })

  it('refuses to save a retained upload inside its temporary directory', async () => {
    uploadMocks.upload.mockResolvedValueOnce({
      fileSha256: 'a'.repeat(64),
      reason: 'service_unavailable',
      status: 'rejected'
    })
    const service = new DiagnosticBundleService()

    const failed = await service.uploadBundle(UPLOAD_INPUT)
    if (failed.status !== 'submission_failed') throw new Error('Expected retained failed submission')
    const retainedPath = await getRetainedUploadPath()
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(path.dirname(retainedPath), 'saved-diagnostics.zip')
    })

    await expect(service.saveUploadBundle({ bundleId: failed.bundleId }, 'main-window')).rejects.toMatchObject({
      code: diagnosticsErrorCodes.FALLBACK_SAVE_FAILED
    })
    await expect(access(retainedPath)).resolves.toBeUndefined()
  })

  it('refuses to save a bundle inside a diagnostic source directory', async () => {
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(logsDir, 'diagnostics.zip')
    })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )
    ).rejects.toMatchObject({ code: diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE })
  })

  it('refuses to save through a directory symlink into a diagnostic source directory', async () => {
    const linkedCrashDumps = path.join(workDir, 'linked-crashes')
    await symlink(crashDumpsDir, linkedCrashDumps, process.platform === 'win32' ? 'junction' : 'dir')
    electronMocks.showSaveDialog.mockResolvedValueOnce({
      canceled: false,
      filePath: path.join(linkedCrashDumps, 'diagnostics.zip')
    })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )
    ).rejects.toMatchObject({ code: diagnosticsErrorCodes.DESTINATION_INSIDE_SOURCE })
    await expect(access(path.join(crashDumpsDir, 'diagnostics.zip'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses to overwrite a destination that is the same physical file as a selected source', async () => {
    const now = Date.now()
    const source = path.join(logsDir, `app.${formatLogDate(now)}.log`)
    await writeFile(source, `${JSON.stringify({ timestamp: new Date(now - 1_000).toISOString() })}\n`)
    await link(source, destination)
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: true, includeTraces: false, range: '24h' },
        'main-window'
      )
    ).rejects.toMatchObject({ code: diagnosticsErrorCodes.DESTINATION_IS_SOURCE })
  })

  it('cleans staged and atomic temporary files when the destination cannot be written', async () => {
    destination = path.join(workDir, 'missing-parent', 'bundle.zip')
    electronMocks.showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: destination })
    const service = new DiagnosticBundleService()

    await expect(
      service.exportBundle(
        { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
        'main-window'
      )
    ).rejects.toThrow()

    expect(await readdir(appTempDir)).toEqual([])
    await expect(access(destination)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves a destination created while the bundle archive is finalizing', async () => {
    const originalFinalize = ZipArchive.prototype.finalize
    const finalizeSpy = vi
      .spyOn(ZipArchive.prototype, 'finalize')
      .mockImplementation(async function (this: ZipArchive) {
        const finalized = originalFinalize.call(this)
        await writeFile(destination, 'external file')
        return finalized
      })
    const service = new DiagnosticBundleService()

    try {
      await expect(
        service.exportBundle(
          { includeChatRecords: false, includeLogs: false, includeTraces: false, range: '24h' },
          'main-window'
        )
      ).rejects.toThrow('destination changed')
    } finally {
      finalizeSpy.mockRestore()
    }

    expect(await readFile(destination, 'utf8')).toBe('external file')
    expect((await readdir(workDir)).filter((name) => name.startsWith('.cherry-studio-diagnostics-'))).toEqual([])
    expect(await readdir(appTempDir)).toEqual([])
  })
})
