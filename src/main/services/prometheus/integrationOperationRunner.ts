import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { loggerService } from '@logger'
import type {
  IntegrationAction,
  IntegrationDiagnostic,
  IntegrationOperation,
  IntegrationOperationEvent,
  IntegrationOperationEventPage,
  IntegrationOperationLogExport,
  IntegrationOperationLogPage,
  IntegrationOperationProgress,
  IntegrationOperationStage
} from '@shared/types/prometheusIntegration'

import { IntegrationOperationScheduler } from './integrationOperationScheduler'
import { IntegrationOperationStore } from './integrationOperationStore'
import { IntegrationProcessError, redactIntegrationText } from './integrationProcess'

const logger = loggerService.withContext('PrometheusOperationRunner')
const OUTPUT_TAIL_LIMIT = 262_144

function initialStage(action: IntegrationAction): IntegrationOperationStage {
  if (action === 'pull') return 'pulling'
  if (action === 'start') return 'starting'
  if (action === 'stop') return 'stopping'
  if (action === 'restart' || action === 'uar-restart') return 'restarting'
  if (action === 'index') return 'indexing'
  if (action === 'refresh') return 'refreshing'
  if (action === 'discover-services') return 'detecting'
  if (action === 'uar-apply') return 'authenticating'
  if (action === 'status' || action === 'logs' || action === 'diagnose' || action === 'uar-check') return 'checking'
  return 'preparing'
}

export type IntegrationOperationControls = {
  signal: AbortSignal
  operation: IntegrationOperation
  output(value: string): void
  stage(stage: IntegrationOperationStage): void
  progress(progress: IntegrationOperationProgress): void
  diagnostics(diagnostics: IntegrationDiagnostic[]): void
}

type StartInput = {
  action: IntegrationAction
  workspacePath?: string
  target: string
  resourceKeys: string[]
  secrets: string[]
  execute(controls: IntegrationOperationControls): Promise<void>
  onFailure?(error: string): void
}

export class IntegrationOperationRunner {
  private readonly store = new IntegrationOperationStore()
  private readonly scheduler = new IntegrationOperationScheduler()
  private readonly controllers = new Map<string, AbortController>()
  private readonly jobs = new Map<string, Promise<void>>()
  private readonly persistenceErrors = new Map<string, unknown>()

  async initialize(): Promise<void> {
    await this.store.initialize()
  }

  list(): IntegrationOperation[] {
    return this.store.list()
  }

  async stop(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort()
    await Promise.allSettled(this.jobs.values())
  }

  async recordInitializationFailure(error: unknown): Promise<void> {
    try {
      const { completion } = await this.start({
        action: 'repair-path',
        target: 'prometheus',
        resourceKeys: ['prometheus:commands'],
        secrets: [],
        execute: async () => {
          throw error
        }
      })
      await completion.catch(() => {})
    } catch (persistenceError) {
      logger.error('Failed to persist integration initialization failure', { error, persistenceError })
    }
  }

  cancel(id: string): void {
    this.store.get(id)
    this.controllers.get(id)?.abort()
  }

  events(id: string, after?: number, limit?: number): Promise<IntegrationOperationEventPage> {
    return this.store.events(id, after, limit)
  }

  log(id: string, offset?: number, limit?: number): Promise<IntegrationOperationLogPage> {
    return this.store.log(id, offset, limit)
  }

  exportLog(id: string): Promise<IntegrationOperationLogExport> {
    return this.store.exportLog(id)
  }

  async start(input: StartInput): Promise<{ operation: IntegrationOperation; completion: Promise<void> }> {
    const now = Date.now()
    const operation: IntegrationOperation = {
      id: randomUUID(),
      action: input.action,
      ...(input.workspacePath ? { workspacePath: input.workspacePath } : {}),
      target: input.target,
      resourceKeys: [...new Set(input.resourceKeys)].sort(),
      status: 'queued',
      stage: 'queued',
      cursor: 0,
      output: '',
      startedAt: now,
      updatedAt: now
    }
    const created = this.store.create(operation)
    await created.committed
    this.broadcast(created.event)

    const controller = new AbortController()
    this.controllers.set(operation.id, controller)
    const completion = this.scheduler
      .run(operation.resourceKeys, controller.signal, async () => {
        operation.status = 'running'
        operation.stage = initialStage(operation.action)
        operation.updatedAt = Date.now()
        await this.publish(operation, { kind: 'status', status: 'running', stage: operation.stage })
        await input.execute({
          signal: controller.signal,
          operation,
          output: (value) => this.output(operation, input.secrets, value),
          stage: (stage) => this.setStage(operation, stage),
          progress: (progress) => this.setProgress(operation, progress),
          diagnostics: (diagnostics) => this.setDiagnostics(operation, diagnostics)
        })
        await this.store.flush(operation.id)
      })
      .then(
        () => this.finish(operation, 'succeeded'),
        (cause) => {
          const persistenceError = this.persistenceErrors.get(operation.id)
          const error = persistenceError ?? cause
          if (error instanceof IntegrationProcessError && error.exitCode !== null) operation.exitCode = error.exitCode
          const message = redactIntegrationText(
            error instanceof Error ? error.message : String(error),
            input.secrets
          ).slice(-16_384)
          input.onFailure?.(message)
          return this.finish(
            operation,
            persistenceError ? 'failed' : controller.signal.aborted ? 'cancelled' : 'failed',
            message
          ).then(() => Promise.reject(error))
        }
      )
      .finally(() => {
        this.controllers.delete(operation.id)
        this.jobs.delete(operation.id)
        this.persistenceErrors.delete(operation.id)
      })
    this.jobs.set(operation.id, completion)
    void completion.catch(() => {})
    return { operation, completion }
  }

  private output(operation: IntegrationOperation, secrets: string[], value: string): void {
    const redacted = redactIntegrationText(value, secrets)
    if (!redacted) return
    operation.output = `${operation.output}${redacted}`.slice(-OUTPUT_TAIL_LIMIT)
    operation.updatedAt = Date.now()
    this.publishInBackground(operation, { kind: 'output', output: redacted }, redacted)
  }

  private setStage(operation: IntegrationOperation, stage: IntegrationOperationStage): void {
    if (operation.stage === stage) return
    operation.stage = stage
    operation.updatedAt = Date.now()
    this.publishInBackground(operation, { kind: 'stage', stage })
  }

  private setProgress(operation: IntegrationOperation, progress: IntegrationOperationProgress): void {
    operation.progress = progress
    operation.updatedAt = Date.now()
    this.publishInBackground(operation, { kind: 'progress', progress })
  }

  private setDiagnostics(operation: IntegrationOperation, diagnostics: IntegrationDiagnostic[]): void {
    operation.diagnostics = diagnostics
    operation.updatedAt = Date.now()
    this.publishInBackground(operation, { kind: 'diagnostics', diagnostics })
  }

  private async finish(
    operation: IntegrationOperation,
    status: 'succeeded' | 'failed' | 'cancelled',
    error?: string
  ): Promise<void> {
    const now = Date.now()
    operation.status = status
    operation.stage = 'completed'
    operation.updatedAt = now
    operation.completedAt = now
    operation.result = status === 'succeeded' ? 'prometheus.operation.succeeded' : undefined
    operation.error = error
    operation.errorCode = status === 'failed' ? 'prometheus.error.operationFailed' : undefined
    operation.recoveryAction = status === 'failed' ? 'retry' : undefined
    await this.publish(operation, {
      kind: 'status',
      status,
      stage: 'completed',
      ...(operation.result ? { result: operation.result } : {}),
      ...(operation.errorCode ? { errorCode: operation.errorCode } : {}),
      ...(error ? { error } : {}),
      ...(operation.recoveryAction ? { recoveryAction: operation.recoveryAction } : {})
    })
  }

  private publishInBackground(
    operation: IntegrationOperation,
    input: Omit<IntegrationOperationEvent, 'operationId' | 'sequence' | 'at'>,
    logText?: string
  ): void {
    const committed = this.publish(operation, input, logText)
    void committed.catch((error) => {
      logger.error('Failed to persist operation progress', { operationId: operation.id, error })
      this.persistenceErrors.set(operation.id, error)
      this.controllers.get(operation.id)?.abort()
    })
  }

  private publish(
    operation: IntegrationOperation,
    input: Omit<IntegrationOperationEvent, 'operationId' | 'sequence' | 'at'>,
    logText?: string
  ): Promise<void> {
    const { event, committed } = this.store.record(operation, input, logText)
    this.broadcast(event)
    return committed
  }

  private broadcast(event: IntegrationOperationEvent): void {
    application.get('IpcApiService').broadcast('prometheus.integration.operation_progress', event)
  }
}
