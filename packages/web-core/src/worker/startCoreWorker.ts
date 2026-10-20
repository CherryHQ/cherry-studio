import { seeders } from '@data/db/seeding/seederRegistry'
import { SeedRunner } from '@data/db/seeding/SeedRunner'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager'
import { CacheService } from '@main/data/CacheService'
import { DataApiService } from '@main/data/DataApiService'
import { PreferenceService } from '@main/data/PreferenceService'
import { IpcApiService } from '@main/ipc/IpcApiService'
import { IpcChannel } from '@shared/IpcChannel'

import { type OpenedDatabase, openDatabase } from '../database/openDatabase'
import { WebPreferenceDefaultsSeeder } from '../database/WebPreferenceDefaultsSeeder'
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

/** Services that need no database; their IPC handlers answer from the Worker's start. */
async function startPageServices() {
  application.register('WindowManager', new WebWindowManager())
  // The desktop keeps renderer logs in its log file; the page has already written them to its console.
  ipcMain.handle(IpcChannel.App_LogToMain, () => undefined)
  for (const [name, service] of [
    ['CacheService', new CacheService()],
    ['DataApiService', new DataApiService()],
    ['IpcApiService', new IpcApiService()]
  ] as const) {
    await service._doInit()
    application.register(name, service)
  }
}

/**
 * Services that read the account's database at start-up. AiService's `onInit` is skipped: it
 * installs built-in tools, skills and Electron hooks, none of which the Web edition has.
 * AiStreamManager's `onInit` only settles replies a closed tab left pending, so it runs.
 */
async function startAccountServices(opened: OpenedDatabase) {
  application.register('DbService', opened.service)
  // The desktop seeds on every start (`DbService.onInit`); PreferenceService only updates existing rows.
  new SeedRunner(opened.service.getDb()).runAll([new WebPreferenceDefaultsSeeder(), ...seeders])
  const preferences = new PreferenceService()
  await preferences._doInit()
  application.register('PreferenceService', preferences)
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
 * add its own commands next to the core ones.
 */
export function startCoreWorker(scope: WorkerScope, extraCommands: Record<string, CommandHandler> = {}) {
  installNodeGlobals()
  let opened: OpenedDatabase | undefined
  const post = (message: WorkerMessage) => scope.postMessage(message)
  const ipc = connectPage((channel, args) => post({ kind: 'broadcast', channel, args }))
  const started = startPageServices()

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
      await startAccountServices(opened)
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
      // Let live replies persist their partial text before the database goes away.
      await application.get('AiStreamManager')._doStop()
      await application.get('PreferenceService')._doStop()
      opened.close()
      opened = undefined
    }
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
}
