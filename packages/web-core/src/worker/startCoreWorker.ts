import { ApiServer } from '@data/api/core/ApiServer'
import { assistantHandlers } from '@data/api/handlers/assistants'
import { messageHandlers } from '@data/api/handlers/messages'
import { modelHandlers } from '@data/api/handlers/models'
import { providerHandlers } from '@data/api/handlers/providers'
import { topicHandlers } from '@data/api/handlers/topics'
import { AiService } from '@main/ai/AiService'
import { AiStreamManager } from '@main/ai/streamManager'
import type { ApiImplementation } from '@shared/data/api/types'

import { type OpenedDatabase, openDatabase } from '../database/openDatabase'
import { application } from '../runtime/application'
import { installNodeGlobals } from '../runtime/nodeGlobals'
import { WebCacheService } from '../services/WebCacheService'
import { WebPreferenceService } from '../services/WebPreferenceService'
import type { CommandMessage, CoreCommands, SerializedError, WorkerMessage } from './protocol'

export interface CommandContext {
  /** The open database; throws if `open` has not completed. */
  database(): OpenedDatabase
}

export type CommandHandler = (payload: any, context: CommandContext) => unknown

/** The part of a dedicated Worker's global scope the host uses. */
export type WorkerScope = Pick<Worker, 'postMessage' | 'addEventListener'>

/** DataApi routes served from the Worker; only the ones whose services run in the browser. */
const webHandlers = {
  ...topicHandlers,
  ...messageHandlers,
  ...providerHandlers,
  ...modelHandlers,
  ...assistantHandlers
} as unknown as ApiImplementation

/**
 * The chat services, minus their desktop start-up work: AiService's `onInit` installs built-in
 * tools, skills and Electron hooks, none of which the Web edition has. AiStreamManager's
 * `onInit` only settles replies a closed tab left pending, so it runs.
 */
async function startAiServices(opened: OpenedDatabase) {
  application.register('PreferenceService', new WebPreferenceService(opened.service))
  application.register('CacheService', new WebCacheService())
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
 * Turns the current dedicated Worker into a Core Worker: it owns the account's
 * database and serves DataApi requests over `postMessage`. `extraCommands` lets
 * a host add its own commands next to `open` / `request` / `close`.
 */
export function startCoreWorker(scope: WorkerScope, extraCommands: Record<string, CommandHandler> = {}) {
  installNodeGlobals()
  const server = ApiServer.initialize(webHandlers)
  let opened: OpenedDatabase | undefined
  const post = (message: WorkerMessage) => scope.postMessage(message)

  application.register('WindowManager', {
    broadcast: (channel, payload) => post({ kind: 'broadcast', channel, payload })
  })

  const context: CommandContext = {
    database() {
      if (!opened) throw new Error('The database is not open; send "open" first')
      return opened
    }
  }

  const coreCommands: { [K in keyof CoreCommands]: (payload: CoreCommands[K]['payload']) => unknown } = {
    async open({ account, handoverTimeoutMs }) {
      if (opened) throw new Error(`The database is already open at ${opened.path}`)
      opened = await openDatabase(account, { handoverTimeoutMs })
      application.register('DbService', opened.service)
      await startAiServices(opened)
      return { path: opened.path, openMs: opened.openMs, migrateMs: opened.migrateMs }
    },
    request: (request) => server.handleRequest(request),
    async close() {
      // Let live replies persist their partial text before the database goes away.
      if (opened) await application.get('AiStreamManager')._doStop()
      opened?.close()
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
