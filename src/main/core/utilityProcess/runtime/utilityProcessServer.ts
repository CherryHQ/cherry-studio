/**
 * Child-side runtime core. Owns the connect handshake, request dispatch, cancellation,
 * error serialization, structured logging, and shutdown ordering. Child-safe: imports nothing
 * from main-only singletons. `serveUtilityProcess()` binds it to the real process; tests bind it
 * to an in-memory parent port.
 */

import {
  CHILD_EXIT_CODES,
  CHILD_SELF_EXIT_DELAY_MS,
  PROTOCOL,
  PROTOCOL_VERSION,
  REQUEST_CANCELLED_CODE,
  SHUTDOWN_CODE
} from '../protocol/constants'
import type {
  ChildFrame,
  ErrorFrame,
  FrameIdentity,
  LogFrame,
  LogLevel,
  ResultFrame,
  Unstamped
} from '../protocol/frames'
import { isConnectFrame, isMainFrame, matchesIdentity } from '../protocol/guards'
import { toRemoteError } from '../protocol/remoteError'
import type { UtilityProcessContract } from '../types'

export interface UtilityProcessLogger {
  debug(message: string, fields?: Record<string, unknown>): void
  info(message: string, fields?: Record<string, unknown>): void
  warn(message: string, fields?: Record<string, unknown>): void
  error(message: string, fields?: Record<string, unknown>): void
}

export interface UtilityProcessHandlerContext<Event> {
  /** Aborted with an AbortError whose `code` is REQUEST_CANCELLED_CODE or SHUTDOWN_CODE. */
  signal: AbortSignal
  /** Streams a typed event to the caller's `onEvent`; ignored once the request has settled. */
  emit: (event: Event) => void
  logger: UtilityProcessLogger
}

export type UtilityProcessHandlers<Contract extends UtilityProcessContract> = {
  [M in keyof Contract['methods']]: (
    input: Contract['methods'][M]['input'],
    context: UtilityProcessHandlerContext<Contract['methods'][M]['event']>
  ) => Contract['methods'][M]['output'] | Promise<Contract['methods'][M]['output']>
}

export interface ServeUtilityProcessOptions<Contract extends UtilityProcessContract, InitData = void> {
  /** Must equal the definition's id; the connect frame is rejected otherwise. */
  id: string
  /** Wiring only (paths, bindings). `ready` is sent after it completes; heavy work belongs in handlers. */
  initialize?: (initData: InitData, context: { logger: UtilityProcessLogger }) => void | Promise<void>
  handlers: UtilityProcessHandlers<Contract>
  /** Graceful-shutdown hook, run once after all handlers have settled. */
  dispose?: (context: { logger: UtilityProcessLogger }) => void | Promise<void>
}

/** Structural subset of Electron's MessagePortMain used by the runtime. */
export interface PortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void
  on(event: 'close', listener: () => void): void
  postMessage(message: unknown): void
  start(): void
  close(): void
}

/** Structural subset of Electron's ParentPort used by the runtime. */
export interface ParentPortLike {
  once(event: 'message', listener: (event: { data: unknown; ports: PortLike[] }) => void): void
}

export interface UtilityProcessServerIo {
  parentPort: ParentPortLike
  exit(code: number): void
  /** Registers the handler for uncaught exceptions and unhandled rejections. */
  onFatal(handler: (error: unknown) => void): void
}

interface ActiveRequest {
  controller: AbortController
  settled: boolean
  done: Promise<void>
}

type Handler = (input: unknown, context: UtilityProcessHandlerContext<unknown>) => unknown

const abortError = (code: string, message: string): Error => {
  const error = new Error(message) as Error & { code: string }
  error.name = 'AbortError'
  error.code = code
  return error
}

export function createUtilityProcessServer<Contract extends UtilityProcessContract, InitData = void>(
  options: ServeUtilityProcessOptions<Contract, InitData>,
  io: UtilityProcessServerIo
): void {
  const handlers = options.handlers as Record<string, Handler>
  const active = new Map<number, ActiveRequest>()
  const tombstones = new Set<number>()
  let port: PortLike | null = null
  let identity: FrameIdentity | null = null
  let portClosed = false
  let lastRequestId = 0
  let shuttingDown = false
  let failed = false
  let exitScheduled = false
  let shutdownPromise: Promise<void> | null = null

  const post = (frame: Unstamped<ChildFrame>): void => {
    if (port === null || identity === null || portClosed) return
    port.postMessage({ ...identity, ...frame })
  }

  const closePort = (): void => {
    if (port === null || portClosed) return
    portClosed = true
    port.close()
  }

  const scheduleExit = (code: number, delayMs: number): void => {
    if (exitScheduled) return
    exitScheduled = true
    setTimeout(() => io.exit(code), delayMs)
  }

  const abortAll = (reason: Error): void => {
    for (const request of active.values()) {
      if (!request.settled) request.controller.abort(reason)
    }
  }

  const createLogger = (requestId?: number): UtilityProcessLogger => {
    const send = (level: LogLevel, message: string, fields?: Record<string, unknown>): void => {
      const base: Unstamped<LogFrame> = { kind: 'log', level, message }
      if (requestId !== undefined) base.requestId = requestId
      if (fields === undefined) {
        post(base)
        return
      }
      try {
        post({ ...base, fields })
      } catch {
        post({ ...base, message: `${message} (log fields dropped: not structured-cloneable)` })
      }
    }
    return {
      debug: (message, fields) => send('debug', message, fields),
      info: (message, fields) => send('info', message, fields),
      warn: (message, fields) => send('warn', message, fields),
      error: (message, fields) => send('error', message, fields)
    }
  }
  const logger = createLogger()

  const serializationFailure = (error: unknown) => ({ ...toRemoteError(error), code: 'PROCESS_SERIALIZATION_FAILED' })

  const sendTerminal = (
    requestId: number,
    request: ActiveRequest,
    frame: Unstamped<ResultFrame> | Unstamped<ErrorFrame>
  ): void => {
    if (request.settled) return
    request.settled = true
    tombstones.delete(requestId)
    // After a fatal error the exit is the only truthful signal; a terminal would read as a healthy dispatch.
    if (failed) return
    try {
      post(frame)
    } catch (error) {
      post({ kind: 'error', requestId, error: serializationFailure(error) })
    }
  }

  const dispatch = (requestId: number, method: string, input: unknown): void => {
    const controller = new AbortController()
    const request: ActiveRequest = { controller, settled: false, done: Promise.resolve() }
    active.set(requestId, request)
    const emit = (event: unknown): void => {
      if (request.settled || tombstones.has(requestId)) return
      try {
        post({ kind: 'event', requestId, event })
      } catch (error) {
        sendTerminal(requestId, request, { kind: 'error', requestId, error: serializationFailure(error) })
        controller.abort(abortError(REQUEST_CANCELLED_CODE, 'event was not structured-cloneable'))
      }
    }
    request.done = (async () => {
      try {
        const output = await handlers[method](input, {
          signal: controller.signal,
          emit,
          logger: createLogger(requestId)
        })
        sendTerminal(requestId, request, { kind: 'result', requestId, output })
      } catch (error) {
        sendTerminal(requestId, request, { kind: 'error', requestId, error: toRemoteError(error) })
      } finally {
        // Tracked until the handler settles, so shutdown waits for it even after an early terminal.
        active.delete(requestId)
      }
    })()
  }

  const violation = (message: string, requestId?: number): void => {
    failed = true
    const frame: Unstamped<ChildFrame> = { kind: 'protocol-error', message }
    if (requestId !== undefined) frame.requestId = requestId
    post(frame)
    abortAll(abortError(SHUTDOWN_CODE, `protocol violation: ${message}`))
    scheduleExit(CHILD_EXIT_CODES.protocolViolation, CHILD_SELF_EXIT_DELAY_MS)
  }

  const beginShutdown = (): Promise<void> => {
    if (shutdownPromise !== null) return shutdownPromise
    shuttingDown = true
    shutdownPromise = (async () => {
      abortAll(abortError(SHUTDOWN_CODE, 'utility process is shutting down'))
      await Promise.allSettled([...active.values()].map((request) => request.done))
      try {
        await options.dispose?.({ logger })
      } catch (error) {
        logger.error('dispose failed', { error: toRemoteError(error) })
      }
      closePort()
      io.exit(0)
    })()
    return shutdownPromise
  }

  const onFrame = ({ data }: { data: unknown }): void => {
    if (failed || identity === null) return
    if (!isMainFrame(data) || !matchesIdentity(data, identity)) {
      violation('malformed or foreign frame')
      return
    }
    switch (data.kind) {
      case 'request': {
        if (shuttingDown) {
          violation('request after shutdown', data.requestId)
          return
        }
        if (data.requestId <= lastRequestId) {
          violation(`non-monotonic requestId ${data.requestId}`, data.requestId)
          return
        }
        if (!Object.hasOwn(handlers, data.method) || typeof handlers[data.method] !== 'function') {
          violation(`unknown method '${data.method}'`, data.requestId)
          return
        }
        lastRequestId = data.requestId
        dispatch(data.requestId, data.method, data.input)
        return
      }
      case 'cancel': {
        const request = active.get(data.requestId)
        if (request !== undefined && !request.settled) {
          tombstones.add(data.requestId)
          request.controller.abort(abortError(REQUEST_CANCELLED_CODE, 'request cancelled by caller'))
        }
        return
      }
      case 'shutdown':
        void beginShutdown()
        return
    }
  }

  const start = async (initData: unknown): Promise<void> => {
    try {
      await options.initialize?.(initData as InitData, { logger })
    } catch (error) {
      failed = true
      post({ kind: 'startup-error', error: toRemoteError(error) })
      scheduleExit(CHILD_EXIT_CODES.startupFailed, CHILD_SELF_EXIT_DELAY_MS)
      return
    }
    post({ kind: 'ready' })
    port?.start()
  }

  io.parentPort.once('message', (event) => {
    const data = event.data
    const transferred = event.ports?.[0]
    if (transferred === undefined || !isConnectFrame(data) || data.processId !== options.id) {
      io.exit(CHILD_EXIT_CODES.badConnect)
      return
    }
    identity = { protocol: PROTOCOL, version: PROTOCOL_VERSION, processId: data.processId, generation: data.generation }
    port = transferred
    port.on('message', onFrame)
    port.on('close', () => {
      void beginShutdown()
    })
    void start(data.initData)
  })

  io.onFatal((error) => {
    if (exitScheduled) return
    failed = true
    logger.error('uncaught error in utility process', { error: toRemoteError(error) })
    abortAll(abortError(SHUTDOWN_CODE, 'utility process crashed'))
    scheduleExit(CHILD_EXIT_CODES.uncaught, 0)
  })
}
