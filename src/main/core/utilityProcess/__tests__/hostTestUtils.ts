/**
 * Shared fixtures for ProcessHost tests: an echo child contract, a recording logger, and a
 * `createHost` helper wiring the in-memory adapter.
 */

import { vi } from 'vitest'

import { defineUtilityProcess } from '../defineUtilityProcess'
import { ProcessHost, type ProcessHostDeps, type UtilityProcessHostLogger } from '../host/ProcessHost'
import type { ServeUtilityProcessOptions } from '../runtime/utilityProcessServer'
import type { UtilityProcessDefinition, UtilityProcessMethod } from '../types'
import { createMemoryProcessAdapter, type MemoryChildScript, type MemoryProcessAdapter } from './memoryProcessAdapter'

export type EchoContract = {
  methods: {
    ping: UtilityProcessMethod<void, 'pong'>
    echo: UtilityProcessMethod<unknown, unknown>
    /** Resolves only when cancelled (rejects with the abort reason) or when `release()` is called. */
    wait: UtilityProcessMethod<void, string>
    stream: UtilityProcessMethod<number, 'done', number>
    fail: UtilityProcessMethod<void, never>
    crash: UtilityProcessMethod<void, never>
    /** Logs its input through the per-request child logger. */
    log: UtilityProcessMethod<string, 'logged'>
  }
}

export const ECHO_ID = 'test.echo'

export interface EchoChildState {
  /** Abort signals seen by `wait` handlers, in order. */
  waitSignals: AbortSignal[]
  /** Resolves every in-flight `wait` handler. */
  release: () => void
  disposeCalls: number
}

/** Builds the real child runtime options for the echo contract. */
export function echoServeOptions(
  onFatal: (error: unknown) => void,
  overrides: Partial<ServeUtilityProcessOptions<EchoContract, unknown>> = {}
): { options: ServeUtilityProcessOptions<EchoContract, unknown>; state: EchoChildState } {
  const releasers: Array<() => void> = []
  const state: EchoChildState = {
    waitSignals: [],
    release: () => {
      for (const release of releasers.splice(0)) release()
    },
    disposeCalls: 0
  }
  const options: ServeUtilityProcessOptions<EchoContract, unknown> = {
    id: ECHO_ID,
    handlers: {
      ping: () => 'pong',
      echo: (input) => input,
      wait: (_input, { signal }) =>
        new Promise<string>((resolve, reject) => {
          state.waitSignals.push(signal)
          releasers.push(() => resolve('released'))
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
        }),
      stream: (count, { emit }) => {
        for (let i = 1; i <= count; i += 1) emit(i)
        return 'done'
      },
      fail: () => {
        throw Object.assign(new Error('handler failed'), { code: 'E_HANDLER' })
      },
      crash: () => {
        onFatal(new Error('simulated native crash'))
        return new Promise<never>(() => {})
      },
      log: (message, { logger }) => {
        logger.info(message, { extra: 1 })
        return 'logged'
      }
    },
    dispose: () => {
      state.disposeCalls += 1
    },
    ...overrides
  }
  return { options, state }
}

/** Script that serves the echo contract with the real runtime on every spawn. */
export function echoScript(overrides: Partial<ServeUtilityProcessOptions<EchoContract, unknown>> = {}): {
  script: MemoryChildScript
  states: EchoChildState[]
} {
  const states: EchoChildState[] = []
  const script: MemoryChildScript = (child) => {
    const { options, state } = echoServeOptions((error) => child.triggerFatal(error), overrides)
    states.push(state)
    child.serve(options)
  }
  return { script, states }
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  data: unknown[]
}

export function createRecordingLogger(): UtilityProcessHostLogger & { entries: LogEntry[] } {
  const entries: LogEntry[] = []
  const record =
    (level: LogEntry['level']) =>
    (message: string, ...data: unknown[]) => {
      entries.push({ level, message, data })
    }
  return { entries, debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') }
}

export function echoDefinition(
  overrides: Partial<Omit<UtilityProcessDefinition<EchoContract, unknown>, '__contract'>> = {}
): UtilityProcessDefinition<EchoContract, unknown> {
  return defineUtilityProcess<EchoContract, unknown>({
    id: ECHO_ID,
    entry: 'test-echo',
    cancellation: 'cooperative',
    ...overrides
  })
}

export interface HostFixture {
  host: ProcessHost<EchoContract, unknown>
  adapter: MemoryProcessAdapter
  logger: ReturnType<typeof createRecordingLogger>
  definition: UtilityProcessDefinition<EchoContract, unknown>
}

export function createHost(
  options: {
    definition?: Partial<Omit<UtilityProcessDefinition<EchoContract, unknown>, '__contract'>>
    script?: MemoryChildScript
    adapter?: MemoryProcessAdapter
    deps?: Partial<ProcessHostDeps>
  } = {}
): HostFixture {
  const definition = echoDefinition(options.definition)
  const adapter = options.adapter ?? createMemoryProcessAdapter(options.script ?? echoScript().script)
  const logger = createRecordingLogger()
  const host = new ProcessHost(definition, {
    adapter,
    logger,
    resolveEntry: vi.fn((entry: string) => `/out/utility-process/${entry}.js`),
    getTempDir: () => '/tmp/cherry-test',
    ...options.deps
  })
  return { host, adapter, logger, definition }
}

/** Resolves to the rejection of `promise`; fails loudly if it resolves instead. */
export async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  let value: unknown
  try {
    value = await promise
  } catch (error) {
    return error
  }
  throw new Error(`expected rejection, got ${JSON.stringify(value)}`)
}
