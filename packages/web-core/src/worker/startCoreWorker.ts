import '../runtime/zodJitless'
import { readFile } from 'node:fs/promises'

import { seeders } from '@data/db/seeding/seederRegistry'
import { CherryAssistantSeeder } from '@data/db/seeding/seeders/cherryAssistantSeeder'
import { CherrySupportSeeder } from '@data/db/seeding/seeders/cherrySupportSeeder'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { AgentLifecycleService } from '@main/ai/agents/AgentLifecycleService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager'
import { CacheService } from '@main/data/CacheService'
import { DataApiService } from '@main/data/DataApiService'
import { PreferenceService } from '@main/data/PreferenceService'
import { IpcApiService } from '@main/ipc/IpcApiService'
import { DirectoryTreeManager } from '@main/services/file/tree/DirectoryTreeManager'
import { PythonService } from '@main/services/PythonService'
import { TrashService } from '@main/services/trash'
import { IpcChannel } from '@shared/IpcChannel'

import { mountBuiltinAgentTemplates } from '../agent/builtinAgentTemplates'
import { addLocalFolder, allowLocalFolder, mountLocalFolders, unmountLocalFolders } from '../agent/localFolders'
import { mountAccountFiles, unmountAccountFiles } from '../database/accountFiles'
import { type OpenedDatabase, openDatabase } from '../database/openDatabase'
import { WebCherryAssistantSeeder } from '../database/WebCherryAssistantSeeder'
import { fixedWebPreferences, WebPreferenceDefaultsSeeder } from '../database/WebPreferenceDefaultsSeeder'
import { unsupportedService } from '../disabled/unsupported'
import { application } from '../runtime/application'
import { connectPage, ipcMain } from '../runtime/electron'
import { installNodeGlobals } from '../runtime/nodeGlobals'
import { WebWindowManager } from '../services/WebWindowManager'
import type { CommandMessage, CoreCommands, SerializedError, WorkerMessage } from './protocol'

export interface CommandContext {
  /** The open database; throws if `open` has not completed. */
  database(): OpenedDatabase
}

export type CommandHandler = (payload: any, context: CommandContext) => unknown

/** The part of a dedicated Worker's global scope the host uses. */
export type WorkerScope = Pick<Worker, 'postMessage' | 'addEventListener'>

/** How an edition's Web app extends the core start-up. */
export interface CoreWorkerHooks {
  /** Builds the IpcApi service; an edition passes a subclass that serves its own routes too. */
  createIpcApiService?(): IpcApiService
  /** Builds the DataApi service; an edition passes one with its own middleware. */
  createDataApiService?(): DataApiService
  /** Runs at the end of `open`, after the account's services have started. */
  afterOpen?(opened: OpenedDatabase, account: string): Promise<void>
  /** Runs first in `close`, while the account's services still run. */
  beforeClose?(): Promise<void>
}

/** Services that need no database; their IPC handlers answer from the Worker's start. */
async function startPageServices(hooks: CoreWorkerHooks) {
  application.register('WindowManager', new WebWindowManager())
  // The desktop keeps renderer logs in its log file; the page has already written them to its console.
  ipcMain.handle(IpcChannel.App_LogToMain, () => undefined)
  // The file preview's text; the desktop also detects encodings other than UTF-8.
  ipcMain.handle(IpcChannel.Fs_ReadText, (_event, path) => readFile(String(path), 'utf-8'))
  for (const [name, service] of [
    ['CacheService', new CacheService()],
    ['DataApiService', hooks.createDataApiService?.() ?? new DataApiService()],
    ['IpcApiService', hooks.createIpcApiService?.() ?? new IpcApiService()],
    ['PythonService', new PythonService()]
  ] as const) {
    await service._doInit()
    application.register(name, service)
  }
  application.markReady()
}

/**
 * Services that read the account's database at start-up. AiService's `onInit` is skipped: it
 * installs built-in tools, skills and Electron hooks, none of which the Web edition has.
 * AiStreamManager's `onInit` only settles replies a closed tab left pending, so it runs.
 */
async function startAccountServices(opened: OpenedDatabase) {
  application.register('DbService', opened.service)
  // The desktop seeds on every start (`DbService.onInit`); PreferenceService only updates existing rows.
  // Its built-in agents run on Claude Code, which the browser cannot run; the Web seeds a Pi assistant.
  const desktopSeeders = seeders.filter(
    (seeder) => !(seeder instanceof CherryAssistantSeeder || seeder instanceof CherrySupportSeeder)
  )
  new SeedRunner(opened.service.getDb()).runAll([
    new WebPreferenceDefaultsSeeder(),
    ...desktopSeeders,
    new WebCherryAssistantSeeder()
  ])
  const preferences = new PreferenceService()
  await preferences._doInit()
  await preferences.setMultiple(fixedWebPreferences)
  application.register('PreferenceService', preferences)
  // The desktop keeps the system awake while a reply or agent turn runs; a tab cannot.
  application.register('RuntimeActivityService', { begin: () => ({ dispose() {} }) })
  const streamManager = new AiStreamManager()
  await streamManager._doInit()
  application.register('AiStreamManager', streamManager)
  application.register('AiService', new AiService())
  // Traces feed the desktop's developer trace window, which the Web edition does not have.
  application.register('TraceStorageService', {
    setTopicId() {},
    saveEntity() {},
    addSpanEvent() {},
    saveSpans: async () => {}
  })
  // MCP servers are desktop-only; a tool-calling model's turn still asks which of them are connected.
  application.register('McpRuntimeService', {
    getConnectedServerCapabilities: () => undefined,
    getConnectedServerInstructions: () => undefined
  })
  // The agent host releases Claude Code's warm queries for every session; the browser runtime keeps none.
  application.register('ClaudeCodeWarmQueryManager', { close: async () => {}, closeAgentSessionWarm() {} })
  // Agents run no heartbeats here (`agentRuntimeCapabilities`), so a new agent has none to wait for.
  application.register('AgentJobsService', { waitForHeartbeat: async () => undefined })
  const agentSessions = new AgentSessionRuntimeService()
  await agentSessions._doInit()
  application.register('AgentSessionRuntimeService', agentSessions)
  const directoryTrees = new DirectoryTreeManager()
  await directoryTrees._doInit()
  application.register('DirectoryTreeManager', directoryTrees)
  // Channels, scheduled tasks and agent-to-agent deliveries are desktop-only, so archiving and
  // deleting agents and sessions find nothing of theirs to pause, drain or resync.
  const idle = {
    pause: () => ({ dispose() {} }),
    drainInFlight: async () => ({ stragglerIds: [] }),
    listActiveWork: () => []
  }
  application.register('ChannelManager', { ...idle, reconcileAgent() {} })
  application.register('AgentSessionDeliveryService', { ...idle, kick() {}, drainSessionQueues: async () => {} })
  application.register('JobManager', { syncJobScheduleTimerById() {} })
  const agentLifecycle = new AgentLifecycleService()
  await agentLifecycle._doInit()
  application.register('AgentLifecycleService', agentLifecycle)
  // Its `onInit` only schedules the archive's purge job; `trash.purge_now` runs that job directly.
  application.register('TrashService', new TrashService())
  // Emptying the archive sweeps file storage for unreferenced files; the Web edition stores none.
  application.register(
    'FileManager',
    Object.assign(Object.create(unsupportedService('File storage')), {
      runSweep: async () => ({
        outcome: 'completed' as const,
        lastRunAt: Date.now(),
        orphanEntriesByOrigin: {},
        orphanEntriesTotal: 0,
        entryCleanup: { outcome: 'completed' as const, candidates: 0, deleted: 0, hasPendingWork: false }
      })
    })
  )
}

function serializeError(error: unknown): SerializedError {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error) }
  const code = (error as { code?: unknown }).code
  return { name: error.name, message: error.message, ...(typeof code === 'string' ? { code } : {}) }
}

/**
 * Turns the current dedicated Worker into a Core Worker: it owns the account's database and runs
 * the main-process services for the page, which reaches them through `ipc-invoke` / `ipc-send`
 * (the page's `ipcRenderer`) or the `request` shortcut for DataApi. `extraCommands` lets a host
 * add its own commands next to the core ones, and `hooks` extend the start-up.
 */
export function startCoreWorker(
  scope: WorkerScope,
  extraCommands: Record<string, CommandHandler> = {},
  hooks: CoreWorkerHooks = {}
) {
  installNodeGlobals()
  let opened: OpenedDatabase | undefined
  const post = (message: WorkerMessage) => scope.postMessage(message)
  const ipc = connectPage((channel, args) => post({ kind: 'broadcast', channel, args }))
  const started = startPageServices(hooks)

  const context: CommandContext = {
    database() {
      if (!opened) throw new Error('The database is not open; send "open" first')
      return opened
    }
  }

  const coreCommands: { [K in keyof CoreCommands]: (payload: CoreCommands[K]['payload']) => unknown } = {
    async open({ account, handoverTimeoutMs }) {
      if (opened) throw new Error(`The database is already open at ${opened.path}`)
      await started
      opened = await openDatabase(account, { handoverTimeoutMs })
      await mountAccountFiles(account)
      await mountLocalFolders(account)
      await mountBuiltinAgentTemplates()
      await startAccountServices(opened)
      try {
        await hooks.afterOpen?.(opened, account)
      } catch (error) {
        await coreCommands.close(undefined)
        throw error
      }
      return { path: opened.path, openMs: opened.openMs, migrateMs: opened.migrateMs }
    },
    request: (request) => application.get('DataApiService').getApiServer().handleRequest(request),
    // IPC handlers belong to the page services, which start asynchronously with the Worker.
    'ipc-invoke': async ({ channel, args }) => {
      await started
      return ipc.invoke(channel, args)
    },
    'ipc-send': async ({ channel, args }) => {
      await started
      ipc.send(channel, args)
    },
    async close() {
      if (!opened) return
      await hooks.beforeClose?.()
      await application.get('AgentLifecycleService')._doStop()
      // Let live replies persist their partial text before the database goes away.
      await application.get('AgentSessionRuntimeService')._doStop()
      await application.get('AiStreamManager')._doStop()
      await application.get('PreferenceService')._doStop()
      await application.get('DirectoryTreeManager')._doStop()
      opened.close()
      unmountLocalFolders()
      unmountAccountFiles()
      opened = undefined
    },
    'local-folder.add': ({ handle }) => addLocalFolder(handle),
    'local-folder.allow': ({ id }) => allowLocalFolder(id)
  }
  const commands: Record<string, CommandHandler> = { ...extraCommands, ...coreCommands }

  scope.addEventListener('message', async (event: MessageEvent<CommandMessage>) => {
    const { id, command, payload } = event.data
    try {
      const handler = commands[command]
      if (!handler) throw new Error(`Unknown Core Worker command "${command}"`)
      post({ kind: 'reply', id, ok: true, result: await handler(payload, context) })
    } catch (error) {
      post({ kind: 'reply', id, ok: false, error: serializeError(error) })
    }
  })
  // An edition that switches accounts in place opens and closes directly.
  return { open: coreCommands.open, close: coreCommands.close }
}
