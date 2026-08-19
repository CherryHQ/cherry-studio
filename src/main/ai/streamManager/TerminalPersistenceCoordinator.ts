import { loggerService } from '@logger'

const logger = loggerService.withContext('TerminalPersistenceCoordinator')

/**
 * A parked terminal write. Identity and immutable payload only — never a closure (P3).
 *
 * The `reservation` variant still carries callbacks: converting it needs `failDispatchReservation`
 * to take its marker rows as data, which is a caller-facing signature change. It captures the
 * receipt and that write, not the stream graph, so it is bounded.
 */
export type TerminalRecoveryRecord =
  | {
      readonly kind: 'stream-attempt'
      readonly topicId: string
      readonly cycleId: number
      readonly attemptId: number
      /** Ports that still owe a durable write; narrows as partial retries succeed. */
      blockedPortIds: readonly string[]
    }
  | {
      readonly kind: 'reservation'
      readonly topicId: string
      retry: () => Promise<boolean>
      abandon: () => Promise<void>
    }

/** Runs one record's write. Resolves true when the record is finished and can be released. */
export type RecoveryExecutor = (record: TerminalRecoveryRecord) => Promise<boolean>

/**
 * The single owner of blocked terminal writes: which rows are parked, which retry is running, and
 * what shutdown must wait for (P2).
 *
 * Deliberately not a lifecycle service — it is owned by `AiStreamManager`, so a record cannot
 * outlive the resources its retry resolves against. Retries are single-flight per key: Stop joins
 * only its own key's run, while the in-flight registry serves drain and shutdown.
 */
export class TerminalPersistenceCoordinator {
  readonly #records = new Map<string, TerminalRecoveryRecord>()
  readonly #activeRuns = new Map<string, Promise<void>>()
  readonly #inFlight = new Map<Promise<void>, string>()

  submit(key: string, record: TerminalRecoveryRecord): void {
    this.#records.set(key, record)
  }

  get(key: string): TerminalRecoveryRecord | undefined {
    return this.#records.get(key)
  }

  /** Release only if the record is still the one submitted under this key. */
  release(key: string, expected?: TerminalRecoveryRecord): void {
    if (expected !== undefined && this.#records.get(key) !== expected) return
    this.#records.delete(key)
  }

  releaseTopic(topicId: string): void {
    for (const [key, record] of this.#records) {
      if (record.topicId === topicId) this.#records.delete(key)
    }
  }

  keysForTopic(topicId: string): string[] {
    return [...this.#records].filter(([, record]) => record.topicId === topicId).map(([key]) => key)
  }

  get size(): number {
    return this.#records.size
  }

  /** The run currently settling this key, so Stop can join it without scanning global work. */
  activeRun(key: string): Promise<void> | undefined {
    return this.#activeRuns.get(key)
  }

  inFlightRuns(): Promise<void>[] {
    return [...this.#inFlight.keys()]
  }

  listActiveWork(): Array<{ id: string; summary: string }> {
    return [...this.#records].map(([key, record]) => ({
      id: `persistence-recovery:${key}`,
      summary: `terminal persistence blocked:${record.topicId}`
    }))
  }

  drainWaitSet(): Array<[Promise<unknown>, string]> {
    return [...this.#inFlight].map(([run, id]): [Promise<unknown>, string] => [run, id])
  }

  clear(): void {
    this.#records.clear()
    this.#activeRuns.clear()
    this.#inFlight.clear()
  }

  /** Start one single-flight run for `key`, or return the run already settling it. */
  run(key: string, execute: RecoveryExecutor): Promise<void> | undefined {
    const record = this.#records.get(key)
    if (!record) return undefined
    const existing = this.#activeRuns.get(key)
    if (existing) return existing

    const run = (async () => {
      try {
        if (await execute(record)) this.release(key, record)
      } catch (error) {
        logger.error('Blocked topic persistence recovery threw', { topicId: record.topicId, error })
      } finally {
        this.#activeRuns.delete(key)
      }
    })()
    // The async body cannot reach its `finally` before these registrations: it suspends at the
    // first `await` no matter how `execute` settles.
    this.#activeRuns.set(key, run)
    this.#inFlight.set(run, `persistence-recovery:${record.topicId}`)
    void run.finally(() => this.#inFlight.delete(run))
    return run
  }

  /** Retry every parked record that is not already settling. */
  async runAll(execute: RecoveryExecutor): Promise<void> {
    const runs = [...this.#records.keys()].flatMap((key) => {
      if (this.#activeRuns.has(key)) return []
      const run = this.run(key, execute)
      return run ? [run] : []
    })
    await Promise.allSettled(runs)
  }
}
