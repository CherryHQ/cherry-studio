import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type {
  UtilityProcessLogger,
  UtilityProcessStreamContext
} from '../../../core/utilityProcess/runtime/serveUtilityProcess'
import type { UtilityProcessStreamFrame } from '../../../core/utilityProcess/types'
import {
  terminalLaunch,
  type TerminalActor,
  type TerminalContext,
  type TerminalHostIdentity,
  type TerminalHostInit,
  type TerminalMutation,
  type TerminalOperation,
  type TerminalOperationId,
  type TerminalReceipt,
  type TerminalResourceId,
  type TerminalResourceState,
  type TerminalStopReason
} from '../contracts'
import { GhosttyRuntime } from '../ghostty/GhosttyRuntime'
import { GhosttyTerminalCore } from '../ghostty/GhosttyTerminalCore'
import { TerminalCapture } from '../TerminalCapture'
import { ManagedProcess } from './ManagedProcess'

interface Resource {
  state: TerminalResourceState
  backend: ManagedProcess
  capture: TerminalCapture
  core?: GhosttyTerminalCore
  deadline?: ReturnType<typeof setTimeout>
  writes: number
  writeBytes: number
  replies: string
}
interface Operation {
  signature: string
  promise: Promise<TerminalReceipt>
  receipt?: TerminalReceipt
}
const sameContext = (a: TerminalContext, b: TerminalContext) =>
  a.contextId === b.contextId && a.bindingId === b.bindingId && a.revision === b.revision
const rejected = (reason: Extract<TerminalReceipt, { kind: 'rejected' }>['reason']): TerminalReceipt => ({
  kind: 'rejected',
  reason
})

export class TerminalHost {
  private readonly resources = new Map<TerminalResourceId, Resource>()
  private readonly contexts = new Map<string, TerminalContext>()
  private readonly operations = new Map<TerminalOperationId, Operation>()
  private readonly waiters = new Set<() => void>()
  private sequence = 0
  private admissionRevision = 0
  private sealed = false
  private version = 0
  private runtime?: Promise<GhosttyRuntime>

  constructor(
    readonly init: TerminalHostInit,
    private readonly logger: UtilityProcessLogger
  ) {}

  matches(host: TerminalHostIdentity): boolean {
    return host.conversationId === this.init.host.conversationId && host.generation === this.init.host.generation
  }

  private changed(resource: Resource): void {
    resource.state.revision++
    resource.state.outputCursor = resource.capture.cursor
    this.version++
    for (const wake of this.waiters) wake()
    this.waiters.clear()
  }

  private result(resource: Resource): TerminalReceipt {
    return { kind: 'resource', resource: structuredClone(resource.state) }
  }
  private current(context: TerminalContext): boolean {
    const active = this.contexts.get(context.contextId)
    return active !== undefined && sameContext(active, context)
  }

  mutate(input: TerminalMutation): Promise<TerminalReceipt> {
    if (!this.matches(input.host)) return Promise.resolve(rejected('stale_generation'))
    const { operation } = input
    if (
      !Number.isSafeInteger(operation.sequence) ||
      operation.sequence <= 0 ||
      operation.id !== `${this.init.host.generation}:${operation.sequence}`
    )
      return Promise.resolve(rejected('identity_conflict'))
    const command =
      input.command.kind === 'start'
        ? { ...input.command, launch: terminalLaunch.parse(input.command.launch) }
        : input.command
    const signature = createHash('sha256')
      .update(JSON.stringify({ admissionRevision: input.admissionRevision, command }))
      .digest('hex')
    const known = this.operations.get(operation.id)
    if (known) return known.signature === signature ? known.promise : Promise.resolve(rejected('identity_conflict'))
    if (operation.sequence <= this.sequence) return Promise.resolve(rejected('outcome_unknown'))
    if (this.operations.size >= 1024) {
      const settled = [...this.operations].find(([, value]) => value.receipt !== undefined)
      if (!settled) return Promise.resolve(rejected('capacity_exceeded'))
      this.operations.delete(settled[0])
    }
    this.sequence = operation.sequence
    const completion = Promise.withResolvers<TerminalReceipt>()
    const entry: Operation = { signature, promise: completion.promise }
    this.operations.set(operation.id, entry)
    void this.apply({ ...input, command }).then(
      (receipt) => {
        entry.receipt = receipt
        completion.resolve(receipt)
      },
      (error: unknown) => {
        this.logger.warn('Terminal operation outcome is uncertain', { error, operationId: operation.id })
        entry.receipt = rejected('outcome_unknown')
        completion.resolve(entry.receipt)
      }
    )
    return completion.promise
  }

  operation(host: TerminalHostIdentity, id: TerminalOperationId): TerminalOperation {
    if (!this.matches(host)) return { kind: 'outcome_unknown' }
    const known = this.operations.get(id)
    return known
      ? known.receipt
        ? { kind: 'settled', receipt: known.receipt }
        : { kind: 'pending' }
      : { kind: 'outcome_unknown' }
  }

  private async apply(input: TerminalMutation): Promise<TerminalReceipt> {
    const command = input.command
    if (command.kind === 'bind') {
      if (this.sealed || input.admissionRevision !== this.admissionRevision) return rejected('closing')
      const previous = this.contexts.get(command.context.contextId)
      if (previous && command.context.revision <= previous.revision && !sameContext(previous, command.context))
        return rejected('stale_context')
      this.contexts.set(command.context.contextId, structuredClone(command.context))
      if (previous && !sameContext(previous, command.context)) {
        await Promise.all(
          [...this.resources.values()].map(async (resource) => {
            if (!sameContext(resource.state.context, previous)) return
            if (resource.state.control.kind === 'user') return
            if (resource.state.control.kind === 'agent') {
              resource.state.control = { kind: 'unassigned' }
              resource.state.controlRevision++
              this.changed(resource)
            }
            if (resource.state.kind === 'pipe' && resource.state.retention.kind === 'turn')
              await this.stop(resource, 'runtime_released')
          })
        )
      }
      return { kind: 'context', context: command.context }
    }
    if (command.kind === 'release-context') {
      if (!this.current(command.context)) return rejected('stale_context')
      this.contexts.set(command.context.contextId, { ...command.context, revision: command.nextRevision })
      await Promise.all(
        [...this.resources.values()].map(async (resource) => {
          if (!sameContext(resource.state.context, command.context)) return
          if (resource.state.control.kind === 'user') return
          if (resource.state.control.kind === 'agent') {
            resource.state.control = { kind: 'unassigned' }
            resource.state.controlRevision++
            this.changed(resource)
          }
          if (resource.state.kind === 'pipe' && resource.state.retention.kind === 'turn')
            await this.stop(resource, 'runtime_released')
        })
      )
      return { kind: 'context', context: { ...command.context, revision: command.nextRevision } }
    }
    if (command.kind === 'start') {
      if (this.sealed || input.admissionRevision !== this.admissionRevision) return rejected('closing')
      if (!this.current(command.context)) return rejected('stale_context')
      if (this.resources.has(command.id)) return rejected('identity_conflict')
      if ([...this.resources.values()].filter((item) => item.state.kind === command.launch.kind).length >= 4)
        return rejected('capacity_exceeded')
      if (command.launch.kind === 'pty' && command.retention.kind !== 'session') return rejected('unsupported')
      return this.start(command)
    }
    const resource = this.resources.get(command.id)
    if (!resource) return rejected('outcome_unknown')
    if (command.kind === 'promote') {
      if (!this.current(command.context) || !sameContext(resource.state.context, command.context))
        return rejected('stale_context')
      if (resource.state.kind !== 'pipe' || resource.state.shell !== 'bash') return rejected('unsupported')
      if (command.cancelRevision !== resource.state.cancelRevision) return rejected('stale_control')
      if (resource.state.process.kind !== 'running' && resource.state.process.kind !== 'starting')
        return rejected('closing')
      resource.state.retention = { kind: 'session' }
      resource.state.cancelRevision++
      this.changed(resource)
      return this.result(resource)
    }
    if (!this.authorized(resource, command.actor, command.controlRevision)) return rejected('stale_control')
    if (command.kind === 'stop') {
      if (command.actor.kind === 'agent') {
        if (command.cancelRevision !== resource.state.cancelRevision) return rejected('stale_control')
        const turnStop =
          command.reason === 'agent_stop' && resource.state.kind === 'pipe' && resource.state.retention.kind === 'turn'
        const taskStop = command.reason === 'task_stop' && resource.state.kind === 'pipe'
        const terminalClose = command.reason === 'terminal_close' && resource.state.kind === 'pty'
        if (!turnStop && !taskStop && !terminalClose) return rejected('stale_control')
      }
      await this.stop(resource, command.reason)
      return this.result(resource)
    }
    if (command.kind === 'control') {
      if (resource.writes) return rejected('busy')
      if (command.target.kind === 'agent' && !this.current(command.target.context)) return rejected('stale_context')
      resource.state.control = structuredClone(command.target)
      resource.state.controlRevision++
      this.changed(resource)
      return this.result(resource)
    }
    if (resource.state.kind !== 'pty' || resource.state.process.kind !== 'running') return rejected('closing')
    if (command.kind === 'resize') {
      if (
        !Number.isInteger(command.cols) ||
        command.cols < 2 ||
        command.cols > 512 ||
        !Number.isInteger(command.rows) ||
        command.rows < 2 ||
        command.rows > 128
      )
        return rejected('unsupported')
      resource.backend.resize(command.cols, command.rows)
      resource.core?.resize(command.cols, command.rows, 8, 16)
    } else {
      // Agent input requires a verified prompt; shell integration is a separate adapter.
      if (command.actor.kind !== 'user') return rejected('unsupported')
      if (resource.state.control.kind !== 'user') return rejected('stale_control')
      if (!(await this.write(resource, command.data))) return rejected('busy')
    }
    this.changed(resource)
    return this.result(resource)
  }

  private authorized(resource: Resource, actor: TerminalActor, revision: number): boolean {
    if (resource.state.controlRevision !== revision) return false
    if (actor.kind === 'user') return true
    return (
      this.current(actor.context) &&
      resource.state.control.kind === 'agent' &&
      sameContext(resource.state.control.context, actor.context)
    )
  }

  private async engine(): Promise<GhosttyRuntime> {
    return (this.runtime ??= (async () => {
      const directory = this.init.ghosttyDirectory
      const [wasm, trampoline, manifest] = await Promise.all([
        readFile(path.join(directory, 'ghostty-vt.wasm')),
        readFile(path.join(directory, 'ghostty-write-pty.wasm')),
        readFile(path.join(directory, 'manifest.json'), 'utf8')
      ])
      const { ghosttyRevision } = JSON.parse(manifest) as { ghosttyRevision: string }
      return GhosttyRuntime.create({
        wasm: Uint8Array.from(wasm),
        writePtyWasm: Uint8Array.from(trampoline),
        revision: ghosttyRevision,
        onLog: (message) => this.logger.debug(message)
      })
    })())
  }

  private async start(command: Extract<TerminalMutation['command'], { kind: 'start' }>): Promise<TerminalReceipt> {
    const { launch } = command
    const capture = new TerminalCapture()
    const resource: Resource = {
      state: {
        id: command.id,
        host: this.init.host,
        kind: launch.kind,
        shell: launch.shell,
        context: command.context,
        process: { kind: 'starting' },
        cleanup: 'none',
        retention: command.retention,
        cancelRevision: 0,
        control: { kind: 'agent', context: command.context },
        controlRevision: 0,
        revision: 0,
        outputCursor: 0
      },
      capture,
      writes: 0,
      writeBytes: 0,
      replies: '',
      backend: new ManagedProcess({
        id: command.id,
        helperFile: this.init.helperFile,
        launch,
        onOutput: (data) => {
          capture.append(data)
          resource.core?.write(data)
          this.changed(resource)
        },
        onExit: (exitCode, signal) => {
          resource.state.process = { kind: 'exited', exitCode, signal }
          this.changed(resource)
          void this.stop(resource, 'root_exited')
        },
        onClosed: (cleanup) => {
          resource.state.cleanup = cleanup
          if (
            cleanup === 'confirmed' &&
            (resource.state.process.kind === 'starting' || resource.state.process.kind === 'closing')
          )
            resource.state.process = { kind: 'not_started' }
          if (resource.deadline) clearTimeout(resource.deadline)
          resource.core?.dispose()
          this.changed(resource)
        },
        onFault: (error) => {
          if (resource.state.process.kind !== 'exited')
            resource.state.process = { kind: 'lost', message: error.message }
          this.changed(resource)
        }
      })
    }
    this.resources.set(command.id, resource)
    this.changed(resource)
    try {
      if (launch.kind === 'pty') {
        const runtime = await this.engine()
        if (resource.state.cleanup !== 'none' || this.sealed) {
          await this.stop(resource, 'conversation_closed')
          return this.result(resource)
        }
        resource.core = GhosttyTerminalCore.create({
          runtime,
          cols: launch.cols,
          rows: launch.rows,
          cellWidth: 8,
          cellHeight: 16,
          scrollbackBytes: 1024 * 1024,
          theme: {
            foreground: { r: 255, g: 255, b: 255 },
            background: { r: 0, g: 0, b: 0 },
            cursor: { r: 255, g: 255, b: 255 }
          },
          onPtyData: (data) => {
            if (Buffer.byteLength(resource.replies) + Buffer.byteLength(data) > 64 * 1024) {
              void this.stop(resource, 'host_stopped')
              return
            }
            resource.replies += data
            queueMicrotask(() => this.flushReplies(resource))
          }
        })
      }
      if (launch.kind === 'pipe' && launch.deadlineAt !== undefined) {
        const remaining = launch.deadlineAt - Date.now()
        if (remaining <= 0) {
          await this.stop(resource, 'deadline')
          return this.result(resource)
        }
        const arm = () => {
          const remaining = launch.deadlineAt! - Date.now()
          if (remaining <= 0) {
            void this.stop(resource, 'deadline')
            return
          }
          resource.deadline = setTimeout(arm, Math.min(remaining, 2_147_483_647))
          resource.deadline.unref()
        }
        arm()
      }
      await resource.backend.start()
      if (resource.state.process.kind === 'starting') resource.state.process = { kind: 'running' }
    } catch (error) {
      if (resource.state.process.kind !== 'exited')
        resource.state.process = { kind: 'lost', message: error instanceof Error ? error.message : String(error) }
      await this.stop(resource, 'host_stopped')
    }
    this.changed(resource)
    return this.result(resource)
  }

  private flushReplies(resource: Resource): void {
    if (!resource.replies || resource.writes >= 2 || resource.state.cleanup !== 'none') return
    const data = resource.replies
    resource.replies = ''
    void this.write(resource, data).catch(() => this.stop(resource, 'host_stopped'))
  }

  private async write(resource: Resource, data: string): Promise<boolean> {
    const bytes = Buffer.byteLength(data)
    if (bytes > 64 * 1024 || resource.writes >= 2 || resource.writeBytes + bytes > 128 * 1024) return false
    resource.writes++
    resource.writeBytes += bytes
    try {
      await resource.backend.write(data)
      return true
    } finally {
      resource.writes--
      resource.writeBytes -= bytes
      this.flushReplies(resource)
    }
  }

  private async stop(resource: Resource, reason: TerminalStopReason): Promise<void> {
    if (resource.state.cleanup === 'confirmed') return
    resource.state.stopReason ??= reason
    resource.state.cleanup = 'pending'
    if (resource.state.process.kind === 'running' || resource.state.process.kind === 'starting')
      resource.state.process = { kind: 'closing' }
    this.changed(resource)
    const cleanup = await resource.backend.close()
    resource.state.cleanup = cleanup
    this.changed(resource)
  }

  read(host: TerminalHostIdentity, id: TerminalResourceId, cursor: number, limit: number) {
    if (!this.matches(host)) throw new Error('Stale terminal generation')
    const resource = this.resources.get(id)
    if (!resource) throw new Error('Unknown terminal resource')
    return resource.capture.read(cursor, limit)
  }

  release(host: TerminalHostIdentity, id: TerminalResourceId): boolean {
    if (!this.matches(host)) return false
    const resource = this.resources.get(id)
    if (!resource || resource.state.cleanup !== 'confirmed' || resource.writes) return false
    this.resources.delete(id)
    this.version++
    return true
  }

  async seal(host: TerminalHostIdentity, admissionRevision: number): Promise<TerminalResourceState[]> {
    if (!this.matches(host)) throw new Error('Stale terminal generation')
    this.sealed = true
    this.admissionRevision = Math.max(this.admissionRevision, admissionRevision)
    await Promise.all([...this.resources.values()].map((resource) => this.stop(resource, 'conversation_closed')))
    return [...this.resources.values()].map((resource) => structuredClone(resource.state))
  }

  async observe(
    host: TerminalHostIdentity,
    context: UtilityProcessStreamContext<never, UtilityProcessStreamFrame>
  ): Promise<void> {
    if (!this.matches(host)) throw new Error('Stale terminal generation')
    const observed = new Map<TerminalResourceId, { cursor: number; revision: number }>()
    while (!context.signal.aborted) {
      const version = this.version
      let backlog = false
      for (const resource of this.resources.values()) {
        const previous = observed.get(resource.state.id) ?? { cursor: 0, revision: -1 }
        if (previous.cursor < resource.capture.cursor) {
          const output = resource.capture.read(previous.cursor, 60 * 1024)
          await context.write({
            metadata: {
              kind: 'output',
              id: resource.state.id,
              start: output.start,
              next: output.next,
              end: output.end,
              truncated: output.truncated
            },
            payload: output.data
          })
          previous.cursor = output.next
        }
        backlog ||= previous.cursor < resource.capture.cursor
        const snapshot = structuredClone(resource.state)
        if (previous.cursor === resource.capture.cursor && previous.revision !== snapshot.revision) {
          await context.write({
            metadata: { kind: 'state', id: snapshot.id },
            payload: Buffer.from(JSON.stringify(snapshot))
          })
          previous.revision = snapshot.revision
        }
        observed.set(resource.state.id, previous)
      }
      if (backlog || version !== this.version) continue
      await new Promise<void>((resolve) => {
        const wake = () => {
          context.signal.removeEventListener('abort', wake)
          this.waiters.delete(wake)
          resolve()
        }
        this.waiters.add(wake)
        context.signal.addEventListener('abort', wake, { once: true })
        if (context.signal.aborted) wake()
      })
    }
  }
}
