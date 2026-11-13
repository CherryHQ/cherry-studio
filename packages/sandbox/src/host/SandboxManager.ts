import { randomUUID } from 'node:crypto'
import { Readable, Writable } from 'node:stream'

import { resolveBackend } from '../backends/resolveBackend.js'
import { createRpcPeer } from '../rpc/peer.js'
import type {
  HostRpcBinding,
  RawSandboxInstance,
  RpcSandboxInstance,
  SandboxCompletion,
  SandboxInstance,
  SandboxProbe,
  SandboxSpec
} from '../types.js'
import { createInstance, rejectedInstance } from './instance.js'
import { SandboxError } from './SandboxError.js'
import { validateSpec } from './validateSpec.js'

export class SandboxManager {
  private readonly instances = new Map<string, SandboxInstance>()
  private disposed = false

  async probe(spec: SandboxSpec): Promise<SandboxProbe> {
    const frozen = validateSpec(spec)
    return resolveBackend().probe(frozen)
  }

  start(spec: SandboxSpec & { channel: 'none' }, options?: { signal?: AbortSignal; rpc?: never }): RawSandboxInstance
  start(
    spec: SandboxSpec & { channel: 'stdio' },
    options: { signal?: AbortSignal; rpc: HostRpcBinding }
  ): RpcSandboxInstance
  start(spec: SandboxSpec, options?: { signal?: AbortSignal; rpc?: HostRpcBinding }): SandboxInstance {
    const id = randomUUID()
    let instance: SandboxInstance
    try {
      if (this.disposed) throw new SandboxError('CANCELLED', 'Manager is disposed')
      const frozen = validateSpec(spec)
      if (
        (frozen.channel === 'none' && options?.rpc !== undefined) ||
        (frozen.channel === 'stdio' &&
          (typeof options?.rpc?.authorize !== 'function' || typeof options.rpc.configure !== 'function'))
      )
        throw new SandboxError('INVALID_SPEC', 'stdio requires an RPC binding; none must not have one')
      if (options?.signal?.aborted) throw new SandboxError('CANCELLED', 'Cancelled before launch')
      const backend = resolveBackend()
      const raw = createInstance(id, frozen, backend.launch(id, frozen), backend.id, options?.signal)
      instance = raw
      if (frozen.channel === 'stdio') {
        const input = Readable.from(raw.stdout, { objectMode: false })
        const output = new Writable({
          write(chunk, _encoding, callback) {
            raw.stdin.write(chunk).then(() => callback(), callback)
          }
        })
        const peer = createRpcPeer(input, output, {
          authorize: (method, params) =>
            options!.rpc!.authorize({ instanceId: id, ownerId: frozen.ownerId, method, params }),
          onError: () => {
            void raw.stop()
          }
        })
        const close = () => {
          peer.dispose()
          input.destroy()
          output.destroy()
        }
        void raw.completion.then(close)
        let ready = false
        void raw.ready.then(
          () => {
            ready = true
          },
          () => undefined
        )
        const rpc = {
          handle: peer.handle,
          request: (...args: Parameters<typeof peer.request>) =>
            ready ? peer.request(...args) : Promise.reject(new Error('Sandbox RPC is not ready'))
        }
        try {
          const configured = options!.rpc!.configure(rpc)
          if (configured !== undefined) {
            void Promise.resolve(configured).catch(() => undefined)
            throw new SandboxError('INVALID_SPEC', 'RPC configure must return undefined synchronously')
          }
        } catch (error) {
          close()
          void raw.stop()
          this.instances.set(id + ':setup', raw)
          void raw.completion.then(() => {
            if (raw.snapshot().state === 'stopped') this.instances.delete(id + ':setup')
          })
          throw error
        }
        instance = { ...raw, channel: 'stdio', stdin: null, stdout: null, rpc }
      }
    } catch (error) {
      instance = rejectedInstance(id, spec?.ownerId ?? '', error)
      if (spec?.channel === 'stdio')
        instance = {
          ...instance,
          channel: 'stdio',
          stdin: null,
          stdout: null,
          rpc: {
            request: async () => {
              throw error
            },
            handle: () => {
              throw error
            }
          }
        }
    }
    this.instances.set(id, instance)
    void instance.completion.then(() => {
      if (instance.snapshot().state === 'stopped') this.instances.delete(id)
    })
    return instance
  }

  /** Stops all owned instances; incomplete cleanup remains owned and can be retried. */
  async dispose(): Promise<SandboxCompletion[]> {
    this.disposed = true
    const results = await Promise.all(
      [...this.instances.entries()].map(async ([key, instance]) => {
        const result = await instance.stop()
        if (instance.snapshot().state === 'stopped') this.instances.delete(key)
        return result
      })
    )
    return results
  }
}
