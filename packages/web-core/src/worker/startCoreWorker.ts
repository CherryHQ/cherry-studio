import { ApiServer } from '@data/api/core/ApiServer'
import { messageHandlers } from '@data/api/handlers/messages'
import { topicHandlers } from '@data/api/handlers/topics'
import type { ApiImplementation } from '@shared/data/api/types'

import { type OpenedDatabase, openDatabase } from '../database/openDatabase'
import { application } from '../runtime/application'
import type { CommandMessage, CoreCommands, SerializedError, WorkerMessage } from './protocol'

export interface CommandContext {
  /** The open database; throws if `open` has not completed. */
  database(): OpenedDatabase
}

export type CommandHandler = (payload: any, context: CommandContext) => unknown

/** The part of a dedicated Worker's global scope the host uses. */
export type WorkerScope = Pick<Worker, 'postMessage' | 'addEventListener'>

/** DataApi routes served from the Worker; only the ones whose services run in the browser. */
const webHandlers = { ...topicHandlers, ...messageHandlers } as unknown as ApiImplementation

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
      return { path: opened.path, openMs: opened.openMs, migrateMs: opened.migrateMs }
    },
    request: (request) => server.handleRequest(request),
    close() {
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
