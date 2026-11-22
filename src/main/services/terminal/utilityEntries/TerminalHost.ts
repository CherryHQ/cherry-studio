import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import { GHOSTTY_KEY_CODES } from '@shared/types/terminal'
import type {
  GhosttySnapshot,
  TerminalViewFrame,
  GhosttyRow,
  TerminalBlockSummary,
  TerminalSearchProjection
} from '@shared/types/terminal'
import { encodeTerminalRows } from '@shared/utils/terminalFrame'

import type {
  UtilityProcessLogger,
  UtilityProcessStreamContext
} from '../../../core/utilityProcess/runtime/serveUtilityProcess'
import type { UtilityProcessStreamFrame } from '../../../core/utilityProcess/types'
import {
  terminalLaunch,
  type TerminalHostContract,
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
import { ShellIntegration, type ShellIntegrationEvent } from './ShellIntegration'
import { TerminalBlockIndex } from './TerminalBlockIndex'
import { TerminalSearch } from './TerminalSearch'

interface Resource {
  state: TerminalResourceState
  backend: ManagedProcess
  capture: TerminalCapture
  core?: GhosttyTerminalCore
  blocks?: TerminalBlockIndex
  mutationRevision: number
  boundary: 'initial' | 'prompt' | 'program' | 'unknown'
  searches: Map<string, TerminalSearch>
  searchRevisions: Map<string, number>
  themeSignature?: string
  integration?: ShellIntegration
  programRevision: number
  views: Map<
    string,
    {
      revision: number
      snapshot: GhosttySnapshot
      geometryEpoch: number
      baseRevision: number | null
      offset: number
      historyTotal: number
      sourceContentEnd: number
      sourceOrigin: number
      sourceRows?: number[]
      layoutRevision?: number
      nativeRevision: number
      alternate: boolean
      blocks: TerminalBlockSummary[]
      blockIndexRevision: number
      search?: TerminalSearchProjection
    }
  >
  deadline?: ReturnType<typeof setTimeout>
  writes: number
  writeBytes: number
  replies: string
  sources: { start: number; end: number; source: 'stdout' | 'stderr' | 'terminal' }[]
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
  private searchPump?: ReturnType<typeof setImmediate>
  private searchTurn = 0

  private scheduleSearch(): void {
    if (this.searchPump) return
    this.searchPump = setImmediate(() => {
      this.searchPump = undefined
      const queries = [...this.resources.values()].flatMap((resource) =>
        [...resource.searches.values()].map((query) => ({ resource, query }))
      )
      const deadline = performance.now() + 2
      for (let index = 0; index < queries.length && performance.now() < deadline; index++) {
        const { resource, query } = queries[(this.searchTurn + index) % queries.length]
        if (resource.writes || resource.replies || resource.state.cleanup !== 'none') continue
        query.step(resource.mutationRevision)
      }
      this.searchTurn++
      if (
        queries.some(
          ({ query, resource }) => query.projection.status === 'searching' && !resource.writes && !resource.replies
        )
      )
        this.scheduleSearch()
    })
    this.searchPump.unref()
  }

  constructor(
    readonly init: TerminalHostInit,
    private readonly logger: UtilityProcessLogger
  ) {
    this.admissionRevision = init.admissionRevision ?? 0
  }

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

  private result(resource: Resource): Extract<TerminalReceipt, { kind: 'resource' }> {
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
    const unassigned =
      command.actor.kind === 'agent' &&
      this.current(command.actor.context) &&
      resource.state.control.kind === 'unassigned' &&
      resource.state.controlRevision === command.controlRevision
    const retainedStop =
      unassigned &&
      command.kind === 'stop' &&
      resource.state.context.contextId === (command.actor.kind === 'agent' ? command.actor.context.contextId : '')
    if (
      !retainedStop &&
      !(unassigned && (command.kind === 'shell-command' || command.kind === 'input' || command.kind === 'interrupt')) &&
      !this.authorized(resource, command.actor, command.controlRevision)
    )
      return rejected('stale_control')
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
    if (
      (command.kind === 'key' || command.kind === 'paste') &&
      command.geometryEpoch !== undefined &&
      command.geometryEpoch !== resource.state.geometryEpoch
    )
      return rejected('stale_control')
    if (resource.state.kind !== 'pty' || resource.state.process.kind !== 'running') return rejected('closing')
    if (unassigned && resource.writes) return rejected('busy')
    const claim = () => {
      if (unassigned && command.actor.kind === 'agent') {
        resource.state.context = structuredClone(command.actor.context)
        resource.state.control = { kind: 'agent', context: structuredClone(command.actor.context) }
        resource.state.controlRevision++
      }
    }
    if (command.kind === 'shell-command' || command.kind === 'rerun') {
      if (resource.state.shellFacts?.kind !== 'prompt') return rejected('busy')
      if (resource.state.shellFacts.revision !== command.promptRevision) return rejected('stale_control')
      if (
        resource.state.editor?.kind !== 'empty' ||
        resource.state.editor.revision !== command.draftRevision ||
        resource.writes
      )
        return rejected('busy')
      if (command.kind === 'rerun' && (command.actor.kind !== 'user' || resource.state.control.kind !== 'user'))
        return rejected('stale_control')
      const submitted =
        command.kind === 'rerun' ? resource.blocks?.command(command.blockId, command.contentRevision) : command.data
      if (submitted === null || submitted === undefined) return rejected('outcome_unknown')
      if (Buffer.byteLength(submitted) > 32 * 1024 || !submitted || submitted.includes('\0'))
        return rejected('unsupported')
      const quoted =
        resource.state.shell === 'bash'
          ? Array.from(Buffer.from(submitted), (byte) => {
              if (byte < 0x20 || byte > 0x7e) return `\\x${byte.toString(16).padStart(2, '0')}`
              const character = String.fromCharCode(byte)
              return character === "'" || character === '\\' ? `\\${character}` : character
            }).join('')
          : submitted.replaceAll("'", "'\\''")
      const powershellScript = `${submitted}\n; $global:__CherryCommandResult = if ($?) { 0 } elseif ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }`
      const data =
        resource.state.shell === 'powershell'
          ? `Invoke-Expression ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(powershellScript).toString('base64')}')))\r`
          : `builtin eval -- ${resource.state.shell === 'bash' ? '$' : ''}'${quoted}'\r`
      if (Buffer.byteLength(data) > 64 * 1024) return rejected('capacity_exceeded')
      if (resource.writes) return rejected('busy')
      resource.state.editor = { kind: 'dirty', revision: resource.state.editor.revision + 1 }
      resource.blocks?.submitted(submitted)
      claim()
      resource.state.command = {
        id: command.kind === 'rerun' ? `repeat:${input.operation.id}` : command.commandId,
        start: resource.capture.cursor,
        status: 'running'
      }
      resource.state.shellFacts = { kind: 'unknown' }
      this.changed(resource)
      if (!(await this.write(resource, data))) {
        resource.state.shellFacts = { kind: 'unknown' }
        return rejected('busy')
      }
    } else if (command.kind === 'resize') {
      if (command.actor.kind === 'user' && resource.state.control.kind !== 'user') return rejected('stale_control')
      if (command.geometryEpoch !== undefined && command.geometryEpoch !== resource.state.geometryEpoch)
        return rejected('stale_control')
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
      resource.core?.resize(command.cols, command.rows, command.cellWidth ?? 8, command.cellHeight ?? 16)
      resource.mutationRevision++
      this.scheduleSearch()
      resource.state.geometryEpoch = (resource.state.geometryEpoch ?? 0) + 1
    } else {
      let data: string
      if (command.actor.kind === 'agent') {
        const facts = resource.state.shellFacts
        if ((command.kind !== 'input' && command.kind !== 'interrupt') || facts?.kind !== 'program')
          return rejected('unsupported')
        if (command.commandId !== facts.commandId || command.programRevision !== facts.programRevision)
          return rejected('stale_control')
        claim()
        data = command.kind === 'interrupt' ? '\x03' : command.data
      } else {
        if (resource.state.control.kind !== 'user') return rejected('stale_control')
        if (command.kind === 'key') data = resource.core!.encodeKey(command.event)
        else if (command.kind === 'paste') data = resource.core!.encodePaste(command.data)
        else if (command.kind === 'wheel') {
          if (
            command.geometryEpoch !== resource.state.geometryEpoch ||
            !Number.isInteger(command.rows) ||
            Math.abs(command.rows) > 30
          )
            return rejected('stale_control')
          data = resource.core!.encodeMouse({ ...command.event, action: 'press', button: command.rows < 0 ? 4 : 5 })
          if (!data && resource.core!.isAlternateScreen())
            data = resource.core!.encodeKey({
              key: GHOSTTY_KEY_CODES.indexOf(command.rows < 0 ? 'ArrowUp' : 'ArrowDown'),
              mods: 0,
              consumedMods: 0,
              composing: false,
              unshiftedCodepoint: 0,
              text: '',
              repeat: false
            })
          if (!data) return { ...this.result(resource), inputHandled: false }
          data = data.repeat(Math.abs(command.rows))
        } else if (command.kind === 'mouse') {
          if (command.geometryEpoch !== resource.state.geometryEpoch) return rejected('stale_control')
          data = resource.core!.encodeMouse(command.event)
          if (!data) return { ...this.result(resource), inputHandled: false }
        } else if (command.kind === 'input') data = command.data
        else return rejected('unsupported')
      }
      if (data && command.actor.kind === 'user' && resource.state.editor) {
        resource.state.editor = { kind: 'dirty', revision: resource.state.editor.revision + 1 }
      }
      if (
        ((command.actor.kind === 'user' &&
          (resource.state.shellFacts?.kind !== 'program' ||
            [3, 4, 26].some((code) => data.includes(String.fromCharCode(code))))) ||
          command.kind === 'interrupt') &&
        data
      )
        resource.state.shellFacts = { kind: 'unknown' }
      if (!(await this.write(resource, data))) return rejected('busy')
    }
    this.changed(resource)
    return command.kind === 'mouse' || command.kind === 'wheel'
      ? { ...this.result(resource), inputHandled: true }
      : this.result(resource)
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
    let { launch } = command
    const token = randomUUID()
    if (launch.kind === 'pty' && this.init.integrationDirectory && launch.shell !== 'other') {
      const directory = this.init.integrationDirectory
      launch = {
        ...launch,
        env: {
          ...launch.env,
          CHERRY_TERMINAL_TOKEN: token,
          ...(launch.shell === 'zsh'
            ? {
                ...('ZDOTDIR' in launch.env ? { CHERRY_TERMINAL_ZDOTDIR: launch.env.ZDOTDIR } : {}),
                CHERRY_TERMINAL_ZSH_INTEGRATION: path.join(directory, 'zsh'),
                ZDOTDIR: path.join(directory, 'zsh')
              }
            : {})
        },
        args:
          launch.shell === 'bash'
            ? ['--noprofile', '--rcfile', path.join(directory, 'bash.bash'), '-i']
            : launch.shell === 'zsh'
              ? ['-il']
              : ['-NoLogo', '-NoExit', '-File', path.join(directory, 'powershell.ps1')]
      }
    }
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
        outputCursor: 0,
        geometryEpoch: 0,
        shellFacts: { kind: 'unknown' }
      },
      capture,
      programRevision: 0,
      mutationRevision: 0,
      boundary: 'initial',
      searches: new Map(),
      searchRevisions: new Map(),
      views: new Map(),
      writes: 0,
      writeBytes: 0,
      replies: '',
      sources: [],
      backend: new ManagedProcess({
        id: command.id,
        helperFile: this.init.helperFile,
        launch,
        onOutput: (data, source) => {
          const output = (chunk: Uint8Array) => {
            const start = capture.cursor
            capture.append(chunk)
            const last = resource.sources.at(-1)
            if (last?.source === source) last.end = capture.cursor
            else resource.sources.push({ start, end: capture.cursor, source })
            while (
              resource.sources.length > 4096 ||
              (resource.sources.length > 1 && resource.sources[1].start <= capture.cursor - 2 * 1024 * 1024)
            )
              resource.sources.shift()
            if (resource.core) {
              const alternate = resource.core.isAlternateScreen()
              resource.core.write(chunk)
              resource.mutationRevision++
              resource.blocks?.written()
              this.scheduleSearch()
              if (alternate !== resource.core.isAlternateScreen())
                resource.state.geometryEpoch = (resource.state.geometryEpoch ?? 0) + 1
            }
          }
          if (resource.integration) resource.integration.push(data, output)
          else output(data)
          this.changed(resource)
        },
        onExit: (exitCode, signal) => {
          resource.integration?.finish((data) => {
            capture.append(data)
            resource.core?.write(data)
          })
          if (resource.state.command?.status === 'running')
            resource.state.command = { ...resource.state.command, status: 'unknown' }
          resource.state.shellFacts = { kind: 'unknown' }
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
          this.changed(resource)
        },
        onFault: (error) => {
          if (resource.state.process.kind !== 'exited')
            resource.state.process = { kind: 'lost', message: error.message }
          this.changed(resource)
        }
      })
    }
    if (launch.kind === 'pty' && this.init.integrationDirectory && launch.shell !== 'other')
      resource.integration = new ShellIntegration(token, (event) => this.shellEvent(resource, event))
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
      if (resource.core) resource.blocks = new TerminalBlockIndex(resource.core, resource.state.id)
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

  private shellEvent(resource: Resource, event: ShellIntegrationEvent): void {
    if (event.kind === 'ready') {
      if (
        resource.state.shell === 'powershell' &&
        resource.state.shellFacts?.kind === 'prompt' &&
        resource.state.shellFacts.revision === event.promptRevision &&
        resource.state.editor?.kind === 'unknown'
      ) {
        resource.state.editor = { kind: 'empty', revision: resource.state.editor.revision + 1 }
        this.changed(resource)
      }
      return
    }
    resource.blocks?.boundary(event)
    if (event.kind === 'unknown') {
      resource.state.shellFacts = { kind: 'unknown' }
      resource.state.editor = { kind: 'unknown', revision: (resource.state.editor?.revision ?? 0) + 1 }
      resource.boundary = 'unknown'
    } else if (event.kind === 'program') {
      resource.boundary = 'program'
      resource.state.editor = { kind: 'unknown', revision: (resource.state.editor?.revision ?? 0) + 1 }
      const id = resource.state.command?.status === 'running' ? resource.state.command.id : `user:${event.revision}`
      resource.state.shellFacts = { kind: 'program', commandId: id, programRevision: ++resource.programRevision }
    } else {
      if (resource.state.command?.status === 'running')
        resource.state.command = {
          ...resource.state.command,
          status: 'completed',
          exitCode: event.exitCode,
          end: resource.capture.cursor
        }
      if (resource.boundary === 'initial' || resource.boundary === 'program')
        resource.state.editor = {
          kind: resource.state.shell === 'powershell' ? 'unknown' : 'empty',
          revision: (resource.state.editor?.revision ?? 0) + 1
        }
      resource.boundary = 'prompt'
      resource.state.shellFacts = { kind: 'prompt', revision: event.revision, cwd: event.cwd }
    }
    this.changed(resource)
  }

  view(input: TerminalHostContract['methods']['view']['input']): TerminalViewFrame {
    if (!this.matches(input.host)) throw new Error('Stale terminal generation')
    const resource = this.resources.get(input.id)
    if (!resource?.core) throw new Error('Terminal screen unavailable')
    try {
      if (input.theme && JSON.stringify(input.theme) !== resource.themeSignature) {
        resource.core.setTheme(input.theme)
        resource.themeSignature = JSON.stringify(input.theme)
        this.changed(resource)
      }
      let view = resource.views.get(input.viewId)
      if (input.rowStart === 0 || !view || input.revision !== view.revision) {
        if (
          !view &&
          resource.views.size >= 4 &&
          !(input.viewId === 'retained-final' && resource.state.cleanup === 'confirmed')
        )
          throw new Error('Terminal view capacity exceeded')
        resource.core.scrollToBottom()
        const summaries = resource.blocks?.summaries() ?? []
        const historyTotal = resource.core.scrollbarState()?.total ?? 0
        const scrollOffset = Math.min(
          5000,
          Math.max(
            0,
            input.offset +
              (input.offset > 0 && view?.offset === input.offset ? Math.max(0, historyTotal - view.historyTotal) : 0)
          )
        )
        let snapshot = resource.core.snapshot()
        const lastContent = snapshot.rowData.findLastIndex(
          (row) =>
            row.text.trimEnd() ||
            row.cells.some(
              (cell) =>
                cell.background.r !== snapshot.background.r ||
                cell.background.g !== snapshot.background.g ||
                cell.background.b !== snapshot.background.b ||
                cell.underline ||
                cell.overline ||
                cell.strikethrough
            )
        )
        const sourceContentEnd = historyTotal - snapshot.rows + Math.max(lastContent, snapshot.cursorY) + 1
        if (scrollOffset) {
          resource.core.scroll(-scrollOffset)
          snapshot = resource.core.snapshot()
        }
        const sourceOrigin = resource.core.scrollbarState()?.offset ?? 0
        const layout = input.layout
        let sourceRows: number[] | undefined
        let layoutRevision: number | undefined
        if (
          layout &&
          layout.sourceRevision === resource.mutationRevision &&
          layout.geometryEpoch === resource.state.geometryEpoch &&
          !resource.core.isAlternateScreen()
        ) {
          sourceRows = Array.from({ length: snapshot.rows }, () => -1)
          const blank = snapshot.rowData[0] && {
            ...snapshot.rowData[0],
            text: '',
            cells: snapshot.rowData[0].cells.map((cell) => ({ ...cell, text: '', background: snapshot.background }))
          }
          const rows: GhosttyRow[] = Array.from({ length: snapshot.rows }, () => blank)
          let lastTarget = 0
          for (const span of layout.spans) {
            if (
              span.targetStart < lastTarget ||
              span.targetStart + span.count > snapshot.rows ||
              span.sourceStart + span.count > historyTotal
            )
              throw new Error('Invalid terminal layout')
            const values = resource.core.sourceRows(span.sourceStart, span.count)
            if (values.length !== span.count) throw new Error('Stale terminal layout')
            values.forEach((row, index) => {
              rows[span.targetStart + index] = row
              sourceRows![span.targetStart + index] = span.sourceStart + index
            })
            lastTarget = span.targetStart + span.count
          }
          const liveOrigin = historyTotal - snapshot.rows
          const cursorY = sourceRows.indexOf(liveOrigin + snapshot.cursorY)
          snapshot = { ...snapshot, rowData: rows, cursorY, cursorVisible: snapshot.cursorVisible && cursorY >= 0 }
          layoutRevision = layout.revision
        }
        const baseRevision =
          view &&
          input.revision === view.revision &&
          view.geometryEpoch === resource.state.geometryEpoch &&
          view.offset === input.offset &&
          view.layoutRevision === layoutRevision
            ? view.revision
            : null
        const dirtyRows = new Set<number>()
        for (let i = 0; i < snapshot.rows; i++)
          if (
            baseRevision === null ||
            JSON.stringify(view!.snapshot.rowData[i]) !== JSON.stringify(snapshot.rowData[i])
          )
            dirtyRows.add(i)
        const search = resource.searches.get(input.viewId)
        let searchProjection: TerminalSearchProjection | undefined
        const visibleRows = new Set(
          sourceRows ?? Array.from({ length: snapshot.rows }, (_, index) => sourceOrigin + index)
        )
        const visibleBlocks = summaries
          .filter((block) => [block.prompt, block.output, block.end].some((point) => point && visibleRows.has(point.y)))
          .slice(-32)
        while (Buffer.byteLength(JSON.stringify(visibleBlocks)) > 8000) visibleBlocks.shift()
        if (search) {
          try {
            const spans =
              layoutRevision !== undefined
                ? layout!.spans
                : [{ sourceStart: sourceOrigin, count: snapshot.rows, targetStart: 0 }]
            const matches: TerminalSearchProjection['matches'] = []
            const deadline = performance.now() + 2
            let limited = false
            for (const span of spans) {
              if (searchProjection && performance.now() > deadline) {
                limited = true
                break
              }
              resource.core.scrollToBottom()
              resource.core.scroll(span.sourceStart - (resource.core.scrollbarState()?.offset ?? 0))
              searchProjection = structuredClone(search.step(resource.mutationRevision, true))
              matches.push(
                ...searchProjection.matches.filter(
                  (match) => match.start.y < span.sourceStart + span.count && match.end.y >= span.sourceStart
                )
              )
            }
            if (searchProjection) {
              searchProjection.matches = matches
              searchProjection.highlightsLimited ||= limited
              if (Buffer.byteLength(JSON.stringify(searchProjection)) > 24 * 1024) {
                searchProjection.matches = []
                searchProjection.highlightsLimited = true
              }
            }
          } finally {
            resource.core.scrollToBottom()
          }
        }
        view = {
          revision: resource.state.revision,
          snapshot: { ...snapshot, dirtyRows, rowData: [...snapshot.rowData] },
          geometryEpoch: resource.state.geometryEpoch ?? 0,
          baseRevision,
          offset: scrollOffset,
          historyTotal,
          sourceContentEnd,
          sourceOrigin,
          sourceRows,
          layoutRevision,
          nativeRevision: resource.mutationRevision,
          alternate: resource.core.isAlternateScreen(),
          blocks: visibleBlocks,
          blockIndexRevision: resource.blocks?.revision ?? 0,
          search: searchProjection
        }
        resource.core.scrollToBottom()
        resource.views.set(input.viewId, view)
      }
      const rows: GhosttyRow[] = []
      const indices = [...view.snapshot.dirtyRows]
      for (let row = input.rowStart; row < indices.length; row++) {
        const value = view.snapshot.rowData[indices[row]]
        const candidate = [...rows, value]
        if (Buffer.byteLength(JSON.stringify(encodeTerminalRows(candidate))) > 24 * 1024) {
          if (!rows.length) throw new Error('Terminal row exceeds frame capacity')
          break
        }
        rows.push(value)
      }
      const encoded = encodeTerminalRows(rows)
      return {
        nativeRevision: view.nativeRevision,
        sourceOrigin: view.sourceOrigin,
        sourceTotal: view.historyTotal,
        sourceContentEnd: view.sourceContentEnd,
        alternate: view.alternate,
        blockIndexRevision: view.blockIndexRevision,
        blocks: view.blocks,
        search: view.search,
        layoutRevision: view.layoutRevision,
        controlling: false,
        agentConnected: false,
        scrollOffset: view.offset,
        viewId: input.viewId,
        resource: structuredClone(resource.state),
        geometryEpoch: view.geometryEpoch,
        revision: view.revision,
        baseRevision: view.baseRevision,
        rowStart: input.rowStart,
        rowIndices: indices.slice(input.rowStart, input.rowStart + rows.length),
        complete: input.rowStart + rows.length === indices.length,
        styles: encoded.styles,
        snapshot: { ...view.snapshot, rowData: encoded.rowData, dirtyRows: indices }
      }
    } finally {
      resource.core.scrollToBottom()
    }
  }

  private queryResource(input: { host: TerminalHostIdentity; id: TerminalResourceId; viewId: string }): Resource {
    if (!this.matches(input.host)) throw new Error('Stale terminal generation')
    const resource = this.resources.get(input.id)
    if (!resource?.core || !resource.blocks || !resource.views.has(input.viewId))
      throw new Error('Terminal view unavailable')
    return resource
  }

  listBlocks(
    input: TerminalHostContract['methods']['listBlocks']['input']
  ): TerminalHostContract['methods']['listBlocks']['output'] {
    const resource = this.queryResource(input)
    const blocks = resource.blocks!.summaries()
    const revision = resource.blocks!.revision
    const prefix = `${input.host.generation}:${revision}:`
    if (
      (input.expectedIndexRevision !== null && input.expectedIndexRevision !== revision) ||
      (input.cursor && !input.cursor.startsWith(prefix))
    )
      return { kind: 'stale' }
    const start = input.cursor ? Number(input.cursor.slice(prefix.length)) : 0
    if (!Number.isSafeInteger(start) || start < 0 || start > blocks.length) return { kind: 'stale' }
    const page = blocks.slice(start, start + Math.min(32, input.limit))
    while (Buffer.byteLength(JSON.stringify(page)) > 48 * 1024) page.pop()
    return {
      kind: 'blocks',
      indexRevision: revision,
      blocks: page,
      cursor: start + page.length < blocks.length ? `${prefix}${start + page.length}` : null
    }
  }

  readBlock(input: TerminalHostContract['methods']['readBlock']['input']) {
    return this.queryResource(input).blocks!.read(
      input.blockId,
      input.part,
      input.consistency.kind === 'exact' ? input.consistency.contentRevision : undefined
    )
  }

  setSearch(input: TerminalHostContract['methods']['setSearch']['input']) {
    const resource = this.queryResource(input)
    const previous = resource.searches.get(input.viewId)
    const revision = resource.searchRevisions.get(input.viewId) ?? -1
    if (
      input.queryRevision < revision ||
      (input.queryRevision === revision &&
        previous?.signature !== JSON.stringify({ scope: input.scope, needle: input.needle }))
    )
      throw new Error('Stale terminal search')
    if (previous && input.queryRevision === revision) return structuredClone(previous.projection)
    previous?.close()
    resource.searches.delete(input.viewId)
    resource.searchRevisions.set(input.viewId, input.queryRevision)
    const query = new TerminalSearch(
      input.viewId,
      input.queryRevision,
      input.scope,
      input.needle,
      resource.core!,
      resource.blocks!
    )
    if (!input.needle || resource.state.cleanup !== 'none') {
      query.close()
    } else {
      this.scheduleSearch()
    }
    resource.searches.set(input.viewId, query)
    return structuredClone(query.projection)
  }

  navigateSearch(input: TerminalHostContract['methods']['navigateSearch']['input']) {
    const resource = this.queryResource(input)
    const query = resource.searches.get(input.viewId)
    if (query?.queryRevision !== input.queryRevision) return null
    const projection = query.navigate(input.resultRevision, input.direction, resource.mutationRevision)
    return projection && structuredClone(projection)
  }

  closeSearch(input: TerminalHostContract['methods']['closeSearch']['input']): void {
    const resource = this.queryResource(input)
    const query = resource.searches.get(input.viewId)
    const revision = resource.searchRevisions.get(input.viewId) ?? -1
    if (query?.queryRevision === input.queryRevision) {
      query.close()
      if (input.queryRevision < revision) resource.searches.delete(input.viewId)
    }
    if (input.queryRevision > revision) resource.searchRevisions.set(input.viewId, input.queryRevision)
  }

  detachView(host: TerminalHostIdentity, id: TerminalResourceId, viewId: string): void {
    if (this.matches(host)) {
      const resource = this.resources.get(id)
      resource?.searches.get(viewId)?.close()
      resource?.searches.delete(viewId)
      resource?.searchRevisions.delete(viewId)
      resource?.views.delete(viewId)
    }
  }

  link(input: {
    host: TerminalHostIdentity
    id: TerminalResourceId
    viewId: string
    revision: number
    geometryEpoch: number
    x: number
    y: number
  }): string | null {
    if (!this.matches(input.host)) return null
    const resource = this.resources.get(input.id)
    const view = resource?.views.get(input.viewId)
    if (
      !resource?.core ||
      !view ||
      view.revision !== input.revision ||
      resource.state.revision !== input.revision ||
      view.geometryEpoch !== input.geometryEpoch
    )
      return null
    if (
      !Number.isInteger(input.x) ||
      !Number.isInteger(input.y) ||
      input.x < 0 ||
      input.y < 0 ||
      input.x >= view.snapshot.cols ||
      input.y >= view.snapshot.rows
    )
      return null
    resource.core.scrollToBottom()
    let row = input.y
    if (view.sourceRows) {
      const source = view.sourceRows[row]
      if (source === undefined || source < 0) return null
      resource.core.scroll(source - (resource.core.scrollbarState()?.offset ?? 0))
      row = source - (resource.core.scrollbarState()?.offset ?? 0)
    } else if (view.offset) resource.core.scroll(-view.offset)
    let url: string | null
    try {
      url = resource.core.hyperlinkAt(input.x, row)
    } finally {
      resource.core.scrollToBottom()
    }
    if (!url) {
      const row = view.snapshot.rowData[input.y]
      const offset = row.cells
        .slice(0, input.x)
        .map((cell) => cell.text || ' ')
        .join('').length
      for (const match of row.text.matchAll(/https?:\/\/[^\s<>"']+/g))
        if (offset >= match.index && offset < match.index + match[0].length) url = match[0].replace(/[),.;]+$/, '')
    }
    if (!url || url.length > 2048) return null
    try {
      return ['http:', 'https:'].includes(new URL(url).protocol) ? url : null
    } catch {
      return null
    }
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
      this.scheduleSearch()
    }
  }

  private async stop(resource: Resource, reason: TerminalStopReason): Promise<void> {
    if (resource.state.cleanup === 'confirmed') return
    for (const query of resource.searches.values()) query.close()
    resource.searches.clear()
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
    resource.blocks?.dispose()
    resource.core?.dispose()
    this.resources.delete(id)
    this.version++
    return true
  }

  advanceAdmission(host: TerminalHostIdentity, admissionRevision: number): void {
    if (!this.matches(host) || this.sealed) throw new Error('Terminal admission is unavailable')
    this.admissionRevision = Math.max(this.admissionRevision, admissionRevision)
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
          let output = resource.capture.read(previous.cursor, 60 * 1024)
          const source = resource.sources.find((item) => item.end > output.start)
          if (source) {
            const start = Math.max(output.start, source.start)
            output = resource.capture.read(start, Math.min(60 * 1024, source.end - start))
            output.truncated ||= start > previous.cursor
          }
          await context.write({
            metadata: {
              kind: 'output',
              id: resource.state.id,
              start: output.start,
              next: output.next,
              end: output.end,
              truncated: output.truncated,
              source: source?.source ?? 'terminal'
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
