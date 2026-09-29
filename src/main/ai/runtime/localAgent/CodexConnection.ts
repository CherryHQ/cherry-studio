import type { ChildProcess } from 'node:child_process'
import { createInterface, type Interface } from 'node:readline'

import * as z from 'zod'

import { crossPlatformSpawn } from '@main/utils/processRunner'

import type { AgentRuntimeUserInput } from '../types'
import { resolveLocalAgentLaunch } from './launch'
import { LocalConnection } from './LocalConnection'
import { localContent } from './localContent'

const RpcSchema = z.object({
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional()
})
const ThreadSchema = z.object({ thread: z.object({ id: z.string() }) })
const ItemSchema = z.object({ id: z.string(), type: z.string() }).passthrough()

export class CodexConnection extends LocalConnection {
  private process?: ChildProcess
  private lines?: Interface
  private nextId = 0
  private threadId?: string
  private turnId?: string
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >()

  async start(cwd: string, resume?: string, probe: boolean | 'models' = false): Promise<this> {
    const launch = await resolveLocalAgentLaunch(this.config, this.abort.signal)
    this.abort.signal.throwIfAborted()
    const child = crossPlatformSpawn(launch.executable, launch.args, {
      cwd,
      env: launch.env,
      detached: process.platform !== 'win32'
    })
    this.process = child
    if (!child.stdout || !child.stdin) throw new Error('Codex stdio is unavailable')
    child.stderr?.resume()
    const failed = (error: Error) => {
      this.rejectPending(error)
      this.finish(error)
      this.dispose()
    }
    child.on('error', failed)
    child.on('exit', () => failed(new Error('Codex process exited')))
    this.lines = createInterface({ input: child.stdout })
    this.lines.on('line', (line) => {
      void this.receive(line).catch(failed)
    })
    await this.request('initialize', { clientInfo: { name: 'cherry_studio', title: 'Cherry Studio', version: '1' } })
    this.write({ method: 'initialized' })
    this.localSessionInfo.resume = true
    this.localSessionInfo.images = true
    if (probe === true) return this
    const models: Array<{ id: string; model?: string; displayName: string; inputModalities?: string[] }> = []
    let cursor: string | null = null
    do {
      const catalog = z
        .object({
          data: z.array(
            z.object({
              id: z.string(),
              model: z.string().optional(),
              displayName: z.string(),
              inputModalities: z.array(z.string()).optional()
            })
          ),
          nextCursor: z.string().nullish()
        })
        .parse(await this.request('model/list', { cursor }))
      models.push(...catalog.data)
      cursor = catalog.nextCursor ?? null
    } while (cursor)
    this.localSessionInfo.models = models.map((model) => ({ id: model.model ?? model.id, name: model.displayName }))
    if (probe === 'models') return this
    const response = await this.request(resume ? 'thread/resume' : 'thread/start', {
      ...(resume ? { threadId: resume } : {}),
      cwd,
      ...(this.config.nativeModel ? { model: this.config.nativeModel } : {})
    })
    const nativeModel = z.object({ model: z.string().optional() }).parse(response).model
    if (nativeModel) this.localSessionInfo.activeModel = { id: nativeModel }
    const selected = models.find((model) => (model.model ?? model.id) === nativeModel)
    this.localSessionInfo.images = selected ? (selected.inputModalities ?? ['text', 'image']).includes('image') : false
    this.threadId = ThreadSchema.parse(response).thread.id
    this.events.push({ type: 'resume-token', token: this.threadId })
    return this
  }
  private write(message: unknown) {
    if (!this.process?.stdin?.writable) throw new Error('Codex connection is closed')
    this.process.stdin.write(JSON.stringify(message) + '\n')
  }
  private request(method: string, params: unknown): Promise<unknown> {
    const id = ++this.nextId
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Codex request timed out: ${method}`))
      }, 30000)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.write({ id, method, params })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  private async receive(line: string) {
    const message = RpcSchema.parse(JSON.parse(line))
    if (!message.method && typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
      return
    }
    const params = message.params ?? {}
    if (message.id !== undefined && message.method) {
      if (params.threadId && params.threadId !== this.threadId) {
        this.write({ id: message.id, error: { code: -32602, message: 'Unknown thread' } })
        return
      }
      if (
        message.method === 'item/commandExecution/requestApproval' ||
        message.method === 'item/fileChange/requestApproval'
      ) {
        const decisions = z
          .array(
            z.union([
              z.enum(['accept', 'acceptForSession', 'decline', 'cancel']),
              z.object({ acceptWithExecpolicyAmendment: z.object({ execpolicy_amendment: z.array(z.string()) }) })
            ])
          )
          .parse(params.availableDecisions ?? ['accept', 'acceptForSession', 'decline', 'cancel'])
        const options = decisions.map((decision) => ({
          optionId: typeof decision === 'string' ? decision : JSON.stringify(decision),
          name: typeof decision === 'string' ? decision : JSON.stringify(decision),
          label:
            typeof decision !== 'string'
              ? undefined
              : decision === 'accept'
                ? 'allow'
                : decision === 'acceptForSession'
                  ? 'allow_session'
                  : decision === 'decline'
                    ? 'deny'
                    : 'cancel',
          kind:
            typeof decision !== 'string' || decision === 'acceptForSession'
              ? 'allow_always'
              : decision === 'accept'
                ? 'allow_once'
                : 'reject_once'
        }))
        const answer = await this.approve(
          String(params.itemId),
          message.method.includes('command') ? 'Codex: Command' : 'Codex: File change',
          { ...params, localPermissionOptions: options }
        )
        const requested = answer.updatedInput?.localPermissionOption
        const index = options.findIndex(
          (option) => option.optionId === requested && option.kind.startsWith(answer.approved ? 'allow_' : 'reject_')
        )
        const decision = this.abort.signal.aborted
          ? 'cancel'
          : index >= 0
            ? decisions[index]
            : answer.approved && decisions.includes('accept')
              ? 'accept'
              : 'decline'
        this.write({ id: message.id, result: { decision } })
      } else if (message.method === 'item/permissions/requestApproval') {
        const answer = await this.approve(String(params.itemId), 'Codex: Permissions', params)
        this.write({
          id: message.id,
          result: {
            permissions: answer.approved && !this.abort.signal.aborted ? params.permissions : {},
            scope: 'turn'
          }
        })
      } else this.write({ id: message.id, error: { code: -32601, message: 'Unsupported client request' } })
      return
    }
    if (params.threadId && params.threadId !== this.threadId) return
    if (message.method === 'item/agentMessage/delta' && typeof params.delta === 'string') this.text(params.delta)
    if (message.method === 'turn/started') {
      const turn = z.object({ id: z.string() }).parse(params.turn)
      this.turnId = turn.id
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const item = ItemSchema.parse(params.item)
      if (
        item.type === 'commandExecution' ||
        item.type === 'fileChange' ||
        item.type === 'mcpToolCall' ||
        item.type === 'webSearch'
      ) {
        this.tool(item.id, item.type, item)
        if (message.method === 'item/completed')
          this.result(item.id, item, item.status === 'failed' || item.status === 'declined')
      }
    }
    if (message.method === 'turn/completed') {
      const turn = z
        .object({ status: z.string(), error: z.object({ message: z.string() }).nullish() })
        .parse(params.turn)
      this.turnId = undefined
      this.finish(turn.status === 'failed' ? new Error(turn.error?.message ?? 'Codex turn failed') : undefined)
    }
    if (message.method === 'error' && params.willRetry !== true)
      this.finish(new Error(z.object({ message: z.string() }).parse(params.error).message))
  }
  async send(input: AgentRuntimeUserInput) {
    const content = await localContent(input, this.localSessionInfo.images)
    this.begin()
    try {
      await this.request('turn/start', {
        threadId: this.threadId,
        input: content.map((part) =>
          part.type === 'image'
            ? { type: 'image', url: `data:${part.mimeType};base64,${part.data}` }
            : { type: 'text', text: part.text, text_elements: [] }
        )
      })
    } catch (error) {
      this.finish(error)
    }
  }
  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
  }
  protected async stop() {
    if (this.turnId) {
      try {
        this.write({
          id: ++this.nextId,
          method: 'turn/interrupt',
          params: { threadId: this.threadId, turnId: this.turnId }
        })
      } catch {
        /* The process may already have exited. */
      }
    }
    if (this.active) await this.waitForTurn()
    this.rejectPending(new Error('Codex connection closed'))
    this.lines?.close()
    await this.stopProcess(this.process)
  }
}
