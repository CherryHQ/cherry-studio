import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'

import { dialog } from 'electron'

import { application } from '@application'
import { loggerService } from '@logger'
import type {
  IntegrationOperation,
  IntegrationOperationEvent,
  IntegrationOperationEventPage,
  IntegrationOperationLogExport,
  IntegrationOperationLogPage
} from '@shared/types/prometheusIntegration'

const logger = loggerService.withContext('PrometheusOperationStore')
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

type PersistedOperation = { schemaVersion: 1; operation: IntegrationOperation }
type EventInput = Omit<IntegrationOperationEvent, 'operationId' | 'sequence' | 'at'>

const isOperationId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)

export class IntegrationOperationStore {
  private readonly operations = new Map<string, IntegrationOperation>()
  private readonly cursors = new Map<string, number>()
  private readonly writes = new Map<string, Promise<void>>()

  private root(): string {
    return application.getPath('feature.prometheus.state', 'operations')
  }

  private operationDirectory(id: string): string {
    if (!isOperationId(id) || !this.operations.has(id)) throw new Error('prometheus.error.operationNotFound')
    return path.join(this.root(), id)
  }

  async initialize(): Promise<IntegrationOperation[]> {
    await fs.mkdir(this.root(), { recursive: true, mode: 0o700 })
    const entries = await fs.readdir(this.root(), { withFileTypes: true })
    const now = Date.now()
    for (const entry of entries) {
      if (!entry.isDirectory() || !isOperationId(entry.name)) continue
      try {
        const persisted = JSON.parse(
          await fs.readFile(path.join(this.root(), entry.name, 'state.json'), 'utf8')
        ) as PersistedOperation
        if (persisted.schemaVersion !== 1 || persisted.operation.id !== entry.name) {
          throw new Error('Operation state identity mismatch')
        }
        const operation = persisted.operation
        const completedAt = operation.completedAt
        if (completedAt && completedAt < now - RETENTION_MS) {
          await fs.rm(path.join(this.root(), entry.name), { recursive: true, force: true })
          continue
        }
        this.operations.set(operation.id, operation)
        this.cursors.set(operation.id, operation.cursor)
        if (operation.status === 'queued' || operation.status === 'running') {
          operation.status = 'interrupted'
          operation.stage = 'completed'
          operation.updatedAt = now
          operation.completedAt = now
          operation.error = 'prometheus.error.operationInterrupted'
          operation.recoveryAction = 'retry'
          const { committed } = this.record(operation, {
            kind: 'status',
            status: operation.status,
            stage: operation.stage,
            error: operation.error,
            recoveryAction: operation.recoveryAction
          })
          await committed
        }
      } catch (error) {
        logger.warn('Unable to restore operation receipt', { operationId: entry.name, error })
      }
    }
    return this.list()
  }

  list(): IntegrationOperation[] {
    return [...this.operations.values()].sort((left, right) => right.startedAt - left.startedAt)
  }

  get(id: string): IntegrationOperation {
    const operation = this.operations.get(id)
    if (!operation) throw new Error('prometheus.error.operationNotFound')
    return operation
  }

  create(operation: IntegrationOperation): { event: IntegrationOperationEvent; committed: Promise<void> } {
    if (this.operations.has(operation.id)) throw new Error('prometheus.error.operationIdentityConflict')
    this.operations.set(operation.id, operation)
    this.cursors.set(operation.id, 0)
    return this.record(operation, { kind: 'status', status: operation.status, stage: operation.stage })
  }

  record(
    operation: IntegrationOperation,
    input: EventInput,
    logText?: string
  ): { event: IntegrationOperationEvent; committed: Promise<void> } {
    const sequence = (this.cursors.get(operation.id) ?? 0) + 1
    this.cursors.set(operation.id, sequence)
    operation.cursor = sequence
    const event: IntegrationOperationEvent = {
      operationId: operation.id,
      sequence,
      at: operation.updatedAt,
      ...input
    }
    const snapshot = JSON.parse(JSON.stringify(operation)) as IntegrationOperation
    const committed = this.enqueue(operation.id, async () => {
      const directory = this.operationDirectory(operation.id)
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      if (logText)
        await fs.appendFile(path.join(directory, 'operation.log'), logText, { encoding: 'utf8', mode: 0o600 })
      await fs.appendFile(path.join(directory, 'events.jsonl'), `${JSON.stringify(event)}\n`, {
        encoding: 'utf8',
        mode: 0o600
      })
      const filename = path.join(directory, 'state.json')
      const temporary = `${filename}.${randomUUID()}.tmp`
      await fs.writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, operation: snapshot }, null, 2)}\n`, {
        mode: 0o600
      })
      await fs.rename(temporary, filename)
    })
    return { event, committed }
  }

  async events(id: string, after = 0, limit = 200): Promise<IntegrationOperationEventPage> {
    const operation = this.get(id)
    await this.flush(id)
    const filename = path.join(this.operationDirectory(id), 'events.jsonl')
    const text = await fs.readFile(filename, 'utf8')
    const events = text
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as IntegrationOperationEvent)
      .filter((event) => event.sequence > after)
      .slice(0, limit)
    const cursor = events.at(-1)?.sequence ?? after
    return { operation, events, cursor }
  }

  async log(id: string, offset = 0, limit = 65_536): Promise<IntegrationOperationLogPage> {
    this.get(id)
    await this.flush(id)
    const filename = path.join(this.operationDirectory(id), 'operation.log')
    let handle: FileHandle | undefined
    try {
      handle = await fs.open(filename, 'r')
      const stat = await handle.stat()
      const start = Math.min(offset, stat.size)
      const buffer = Buffer.alloc(Math.min(limit, stat.size - start))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, start)
      const text = buffer.subarray(0, bytesRead).toString('utf8')
      const nextOffset = start + bytesRead
      return { operationId: id, offset: start, nextOffset, totalBytes: stat.size, text, eof: nextOffset >= stat.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { operationId: id, offset: 0, nextOffset: 0, totalBytes: 0, text: '', eof: true }
    } finally {
      await handle?.close()
    }
  }

  async exportLog(id: string): Promise<IntegrationOperationLogExport> {
    this.get(id)
    await this.flush(id)
    const source = path.join(this.operationDirectory(id), 'operation.log')
    const result = await dialog.showSaveDialog({
      defaultPath: `the-boss-operation-${id}.log`,
      properties: ['createDirectory', 'showOverwriteConfirmation']
    })
    if (result.canceled || !result.filePath) return { operationId: id, cancelled: true }
    try {
      await fs.copyFile(source, result.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      await fs.writeFile(result.filePath, '')
    }
    const stat = await fs.stat(result.filePath)
    return { operationId: id, cancelled: false, path: result.filePath, size: stat.size }
  }

  flush(id: string): Promise<void> {
    return this.writes.get(id) ?? Promise.resolve()
  }

  private enqueue(id: string, write: () => Promise<void>): Promise<void> {
    const committed = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(write)
    const tracked = committed.finally(() => {
      if (this.writes.get(id) === tracked) this.writes.delete(id)
    })
    this.writes.set(id, tracked)
    return tracked
  }
}
