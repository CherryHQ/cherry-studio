import type { BackendLease } from '../backends/types.js'
import type { RawSandboxInstance, SandboxCompletion, SandboxInstance, SandboxSpec } from '../types.js'
import { deferred } from './deferred.js'
import { SandboxError } from './SandboxError.js'

export function createInstance(
  id: string,
  spec: SandboxSpec,
  lease: BackendLease,
  backendId: string,
  signal?: AbortSignal
): RawSandboxInstance {
  const ready = deferred<Awaited<SandboxInstance['ready']>>()
  const completion = deferred<SandboxCompletion>()
  let state: ReturnType<SandboxInstance['snapshot']>['state'] = 'starting'
  let lastCompletion: SandboxCompletion | undefined
  let stopping: Promise<SandboxCompletion> | undefined
  let target: SandboxCompletion['target'] = { status: 'not-started' }
  let reason: SandboxCompletion['reason'] | undefined
  let lifetime: ReturnType<typeof setTimeout> | undefined
  const issues: SandboxCompletion['issues'][number][] = []
  const stop = (requestedReason: SandboxCompletion['reason']) => {
    if (stopping) return stopping
    if (state === 'stopped') return Promise.resolve(lastCompletion!)
    reason ??= requestedReason
    state = 'stopping'
    clearTimeout(lifetime)
    signal?.removeEventListener('abort', onAbort)
    ready.reject(new SandboxError('CANCELLED', 'Instance stopped before ready'))
    stopping = (async () => {
      let tree: SandboxCompletion['tree'] = 'unknown'
      let cleanup: Awaited<ReturnType<BackendLease['cleanup']>> = { status: 'incomplete', issues: [] }
      try {
        tree = await lease.terminate({ graceMs: spec.limits.stopGraceMs, timeoutMs: spec.limits.stopTimeoutMs })
        cleanup = await lease.cleanup({ timeoutMs: spec.limits.cleanupTimeoutMs })
      } catch {
        issues.push({ code: 'CLEANUP_FAILED', message: 'Backend stop or cleanup failed' })
      }
      lastCompletion = {
        reason: reason,
        target,
        tree,
        cleanup: cleanup.status,
        issues: [...issues, ...cleanup.issues]
      }
      state = tree !== 'unknown' && cleanup.status === 'complete' ? 'stopped' : 'failed'
      completion.resolve(lastCompletion)
      return lastCompletion
    })().finally(() => {
      stopping = undefined
    })
    return stopping
  }
  const onAbort = () => {
    void stop('cancelled')
  }
  void lease.targetExit.then((value) => {
    target = value
    if (value.status === 'exited') void stop('exited')
  })
  void lease.failure.then((error) => {
    ready.reject(error)
    issues.push({ code: error.code, message: error.message })
    void stop(error.code === 'LIMIT_EXCEEDED' ? 'limit' : 'startup-error')
  })
  lease.started.then(
    (value) => {
      if (state !== 'starting') return
      state = 'running'
      ready.resolve({ backendId, ...value })
      if (spec.limits.lifetimeMs !== undefined)
        lifetime = setTimeout(() => {
          void stop('limit')
        }, spec.limits.lifetimeMs)
    },
    (error: unknown) => {
      ready.reject(error)
      void stop(error instanceof SandboxError && error.code === 'LIMIT_EXCEEDED' ? 'limit' : 'startup-error')
    }
  )
  if (signal?.aborted) onAbort()
  else signal?.addEventListener('abort', onAbort, { once: true })
  return {
    id,
    ownerId: spec.ownerId,
    channel: 'none',
    rpc: null,
    ready: ready.promise,
    completion: completion.promise,
    stdin: lease.stdin,
    stdout: lease.stdout,
    stderr: lease.stderr,
    snapshot: () => ({ state, lastCompletion }),
    stop: () => stop('stopped')
  }
}

export function rejectedInstance(id: string, ownerId: string, error: unknown): RawSandboxInstance {
  const ready = deferred<Awaited<SandboxInstance['ready']>>()
  ready.reject(error)
  const result: SandboxCompletion = {
    reason: error instanceof SandboxError && error.code === 'CANCELLED' ? 'cancelled' : 'startup-error',
    target: { status: 'not-started' },
    tree: 'gone',
    cleanup: 'complete',
    issues: [
      {
        code: error instanceof SandboxError ? error.code : 'INVALID_SPEC',
        message: error instanceof SandboxError ? error.message : 'Invalid sandbox specification'
      }
    ]
  }
  const completion = Promise.resolve(result)
  const empty = { async *[Symbol.asyncIterator]() {} }
  return {
    id,
    ownerId,
    channel: 'none',
    rpc: null,
    ready: ready.promise,
    completion,
    stdout: empty,
    stderr: empty,
    stdin: {
      write: async () => {
        throw error
      },
      end: async () => undefined
    },
    snapshot: () => ({ state: 'stopped', lastCompletion: result }),
    stop: () => completion
  }
}
