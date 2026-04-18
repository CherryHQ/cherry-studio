import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { FileProcessingMarkdownTaskResult } from '@shared/data/types/fileProcessing'

const logger = loggerService.withContext('Doc2xRuntimeService')

interface Doc2xInFlightQuery {
  controller: AbortController
  promise: Promise<FileProcessingMarkdownTaskResult>
}

@Injectable('Doc2xRuntimeService')
@ServicePhase(Phase.BeforeReady)
@DependsOn(['FileProcessingRuntimeService'])
export class Doc2xRuntimeService extends BaseService {
  private readonly inFlightQueries = new Map<string, Doc2xInFlightQuery>()
  private acceptingTasks = false

  protected async onInit(): Promise<void> {
    this.acceptingTasks = true
  }

  protected async onStop(): Promise<void> {
    this.acceptingTasks = false

    const inFlightQueries = Array.from(this.inFlightQueries.values())

    for (const query of inFlightQueries) {
      query.controller.abort(this.createAbortError('Doc2x runtime is stopping'))
    }

    await Promise.allSettled(inFlightQueries.map((query) => query.promise))
    this.inFlightQueries.clear()

    logger.debug('Doc2x runtime cleanup completed', {
      abortedQueryCount: inFlightQueries.length
    })
  }

  runDedupedQuery(
    providerTaskId: string,
    runner: (signal: AbortSignal) => Promise<FileProcessingMarkdownTaskResult>,
    callerSignal?: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    if (!this.acceptingTasks) {
      throw new Error('Doc2xRuntimeService is not initialized')
    }

    callerSignal?.throwIfAborted()

    const existingQuery = this.inFlightQueries.get(providerTaskId)

    if (existingQuery) {
      return this.withCallerAbort(existingQuery.promise, callerSignal)
    }

    const controller = new AbortController()
    const promise = this.runQuery(runner, controller.signal).finally(() => {
      const current = this.inFlightQueries.get(providerTaskId)

      if (current?.promise === promise) {
        this.inFlightQueries.delete(providerTaskId)
      }
    })

    this.inFlightQueries.set(providerTaskId, {
      controller,
      promise
    })

    return this.withCallerAbort(promise, callerSignal)
  }

  private runQuery(
    runner: (signal: AbortSignal) => Promise<FileProcessingMarkdownTaskResult>,
    signal: AbortSignal
  ): Promise<FileProcessingMarkdownTaskResult> {
    try {
      return runner(signal)
    } catch (error) {
      return Promise.reject(error)
    }
  }

  private withCallerAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) {
      return promise
    }

    if (signal.aborted) {
      return Promise.reject(this.createAbortError(signal.reason))
    }

    return new Promise<T>((resolve, reject) => {
      const abortHandler = () => reject(this.createAbortError(signal.reason))

      signal.addEventListener('abort', abortHandler, { once: true })

      void promise.then(
        (value) => {
          signal.removeEventListener('abort', abortHandler)
          resolve(value)
        },
        (error) => {
          signal.removeEventListener('abort', abortHandler)
          reject(error)
        }
      )
    })
  }

  private createAbortError(reason: unknown): Error {
    if (reason instanceof Error && reason.name === 'AbortError') {
      return reason
    }

    if (reason instanceof Error) {
      const error = new Error(reason.message)
      error.name = 'AbortError'
      return error
    }

    const error = new Error(typeof reason === 'string' ? reason : 'The operation was aborted')
    error.name = 'AbortError'
    return error
  }
}
