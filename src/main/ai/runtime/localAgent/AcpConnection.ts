import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import {
  client,
  ndJsonStream,
  type ClientConnection,
  type SessionConfigOption,
  type SessionUpdate
} from '@agentclientprotocol/sdk'

import { crossPlatformSpawn } from '@main/utils/processRunner'

import type { AgentRuntimeUserInput } from '../types'
import { CursorQuestionSchema, CursorPlanSchema, cursorQuestionInput, cursorQuestionOutcome } from './cursorExtension'
import { resolveLocalAgentLaunch } from './launch'
import { LocalConnection } from './LocalConnection'
import { localContent } from './localContent'

type Terminal = {
  child: ChildProcess
  output: string
  truncated: boolean
  exited: Promise<{ exitCode?: number; signal?: string }>
}

export class AcpConnection extends LocalConnection {
  private process?: ChildProcess
  private connection?: ClientConnection
  private nativeId?: string
  private readonly terminals = new Map<string, Terminal>()
  private loading = false
  private modelConfigId?: string
  private readonly toolInputs = new Map<string, { name: string; input: unknown }>()

  async start(cwd: string, resume?: string, probe = false): Promise<this> {
    const launch = await resolveLocalAgentLaunch(this.config, this.abort.signal)
    this.abort.signal.throwIfAborted()
    const child = crossPlatformSpawn(launch.executable, launch.args, {
      cwd,
      env: launch.env,
      detached: process.platform !== 'win32'
    })
    this.process = child
    child.stderr?.resume()
    child.on('error', (error) => this.finish(error))
    child.on('exit', () => {
      this.connection?.close(new Error('Local agent process exited'))
      this.finish(new Error('Local agent process exited'))
      this.dispose()
    })
    if (!child.stdin || !child.stdout) throw new Error('Local agent stdio is unavailable')
    const app = client({ name: 'cherry-studio' })
      .onNotification('session/update', ({ params }) => {
        if (!this.loading && params.sessionId === this.nativeId) this.update(params.update)
      })
      .onRequest('session/request_permission', async ({ params }) => {
        const id = params.toolCall.toolCallId
        const knownTool = this.tools.has(id)
        const options = params.options
        const answer = await this.approve(id, `ACP: ${params.toolCall.title ?? 'Tool'}`, {
          tool: params.toolCall,
          localPermissionOptions: options
        })
        const requested = answer.updatedInput?.localPermissionOption
        const selected = this.abort.signal.aborted
          ? undefined
          : typeof requested === 'string'
            ? options.find((o) => o.optionId === requested && o.kind.startsWith(answer.approved ? 'allow_' : 'reject_'))
            : options.find((o) => o.kind === (answer.approved ? 'allow_once' : 'reject_once'))
        const outcome = selected
          ? { outcome: 'selected' as const, optionId: selected.optionId }
          : { outcome: 'cancelled' as const }
        if (!knownTool) this.result(id, outcome)
        return { outcome }
      })
      .onRequest('cursor/ask_question', CursorQuestionSchema, async ({ params }) => {
        if (!this.active || this.abort.signal.aborted) return { outcome: { outcome: 'cancelled' } }
        const answer = await this.approve(params.toolCallId, 'AskUserQuestion', cursorQuestionInput(params))
        const outcome =
          answer.approved && !this.abort.signal.aborted
            ? cursorQuestionOutcome(params, answer.updatedInput)
            : { outcome: 'cancelled' as const }
        this.result(params.toolCallId, {
          ...cursorQuestionInput(params),
          answers:
            outcome.outcome === 'answered'
              ? Object.fromEntries(
                  outcome.answers.map((answer) => [
                    answer.questionId,
                    answer.selectedOptionIds
                      .map(
                        (id) =>
                          params.questions
                            .find((question) => question.id === answer.questionId)!
                            .options.find((option) => option.id === id)!.label
                      )
                      .join(', ')
                  ])
                )
              : {},
          cursorOutcome: outcome
        })
        return { outcome }
      })
      .onRequest('cursor/create_plan', CursorPlanSchema, async ({ params }) => {
        if (!this.active || this.abort.signal.aborted) return { outcome: { outcome: 'cancelled' } }
        this.text(`${params.plan}\n`)
        const answer = await this.approve(params.toolCallId, `ACP: ${params.name ?? 'Plan'}`, {
          plan: params.plan,
          localPermissionOptions: [
            { optionId: 'accept', name: 'Accept', label: 'allow', kind: 'allow_once' },
            { optionId: 'reject', name: 'Reject', label: 'deny', kind: 'reject_once' }
          ]
        })
        const outcome = { outcome: this.abort.signal.aborted ? 'cancelled' : answer.approved ? 'accepted' : 'rejected' }
        this.result(params.toolCallId, outcome)
        return { outcome }
      })
      .onRequest('fs/read_text_file', async ({ params }) => {
        const content = await fs.readFile(params.path, 'utf8')
        const lines = content.split('\n')
        return {
          content: lines
            .slice(
              Math.max(0, (params.line ?? 1) - 1),
              params.limit ? (params.line ?? 1) - 1 + params.limit : undefined
            )
            .join('\n')
        }
      })
      .onRequest('fs/write_text_file', async ({ params }) => {
        const id = randomUUID()
        try {
          const answer = await this.approve(id, 'ACP: Write', { path: params.path, content: params.content })
          if (!answer.approved) throw new Error('File write denied')
          await fs.writeFile(params.path, params.content)
          this.result(id, { path: params.path })
          return {}
        } catch (error) {
          this.result(id, String(error), true)
          throw error
        }
      })
      .onRequest('terminal/create', async ({ params }) => {
        const id = randomUUID()
        const answer = await this.approve(id, 'ACP: Terminal', {
          command: params.command,
          args: params.args,
          cwd: params.cwd ?? cwd
        })
        if (!answer.approved) {
          this.result(id, 'Terminal execution denied', true)
          throw new Error('Terminal execution denied')
        }
        const terminalId = randomUUID()
        const proc = crossPlatformSpawn(params.command, params.args ?? [], {
          cwd: params.cwd ?? cwd,
          env: { ...launch.env, ...Object.fromEntries((params.env ?? []).map((e) => [e.name, e.value])) },
          detached: process.platform !== 'win32'
        })
        const terminal: Terminal = {
          child: proc,
          output: '',
          truncated: false,
          exited: new Promise((resolve) => {
            proc.once('exit', (code, signal) => resolve({ exitCode: code ?? undefined, signal: signal ?? undefined }))
            proc.once('error', () => resolve({ exitCode: 1 }))
          })
        }
        const limit = Math.max(1, Math.min(params.outputByteLimit ?? 1024 * 1024, 1024 * 1024))
        const receive = (data: Buffer) => {
          terminal.output += data.toString()
          if (Buffer.byteLength(terminal.output) > limit) {
            terminal.output = Buffer.from(terminal.output).subarray(-limit).toString()
            terminal.truncated = true
          }
        }
        proc.stdout?.on('data', receive)
        proc.stderr?.on('data', receive)
        this.terminals.set(terminalId, terminal)
        this.result(id, { terminalId })
        return { terminalId }
      })
      .onRequest('terminal/output', async ({ params }) => {
        const terminal = this.terminal(params.terminalId)
        return {
          output: terminal.output,
          truncated: terminal.truncated,
          ...(terminal.child.exitCode !== null ? { exitStatus: { exitCode: terminal.child.exitCode } } : {})
        }
      })
      .onRequest('terminal/wait_for_exit', ({ params }) => this.terminal(params.terminalId).exited)
      .onRequest('terminal/kill', async ({ params }) => {
        await this.stopProcess(this.terminal(params.terminalId).child)
        return {}
      })
      .onRequest('terminal/release', async ({ params }) => {
        await this.stopProcess(this.terminal(params.terminalId).child)
        this.terminals.delete(params.terminalId)
        return {}
      })
    this.connection = app.connect(
      ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>)
    )
    const response = await this.connection.agent.request('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'cherry-studio', version: '1' },
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true }
    })
    if (response.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version')
    this.localSessionInfo.resume = response.agentCapabilities?.loadSession === true
    this.localSessionInfo.images = response.agentCapabilities?.promptCapabilities?.image === true
    if (probe) return this
    this.loading = true
    try {
      if (resume) {
        if (!response.agentCapabilities?.loadSession)
          throw new Error('This agent cannot restore the previous conversation; create a new session')
        const session = await this.connection.agent.request('session/load', { cwd, sessionId: resume, mcpServers: [] })
        this.readConfigOptions(session.configOptions)
        this.nativeId = resume
      } else {
        const session = await this.connection.agent.request('session/new', { cwd, mcpServers: [] })
        this.nativeId = session.sessionId
        this.readConfigOptions(session.configOptions)
      }
      if (this.config.nativeModel) {
        if (!this.modelConfigId) throw new Error('This agent does not support model selection')
        const updated = await this.connection.agent.request('session/set_config_option', {
          sessionId: this.nativeId,
          configId: this.modelConfigId,
          value: this.config.nativeModel
        })
        this.readConfigOptions(updated.configOptions)
      }
    } finally {
      this.loading = false
    }
    this.events.push({ type: 'resume-token', token: this.nativeId })
    return this
  }
  private readConfigOptions(options?: SessionConfigOption[] | null) {
    const model = options?.find((option) => option.category === 'model' && option.type === 'select')
    if (model?.type !== 'select') return
    this.modelConfigId = model.id
    this.localSessionInfo.activeModel = { id: model.currentValue }
    this.localSessionInfo.models = model.options
      .flatMap((option) => ('group' in option ? option.options : [option]))
      .map((option) => ({ id: option.value, name: option.name }))
  }
  private terminal(id: string): Terminal {
    const terminal = this.terminals.get(id)
    if (!terminal) throw new Error('Unknown session terminal')
    return terminal
  }
  private update(update: SessionUpdate) {
    if (update.sessionUpdate === 'config_option_update') this.readConfigOptions(update.configOptions)
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') this.text(update.content.text)
    if (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') {
      const previous = this.toolInputs.get(update.toolCallId)
      const tool = {
        name: update.title ? `ACP: ${update.title}` : (previous?.name ?? 'ACP: Tool'),
        input: update.rawInput ?? previous?.input ?? {}
      }
      this.toolInputs.set(update.toolCallId, tool)
      if (!previous || update.rawInput != null || update.title)
        this.tool(update.toolCallId, tool.name, tool.input, true)
    }
    if (
      (update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') &&
      (update.status === 'completed' || update.status === 'failed')
    ) {
      this.result(update.toolCallId, update.rawOutput ?? update.content ?? update.status, update.status === 'failed')
    }
    if (update.sessionUpdate === 'available_commands_update')
      this.events.push({
        type: 'supported-commands',
        commands: update.availableCommands.map((c) => ({
          name: c.name,
          description: c.description,
          argumentHint: c.input?.hint ?? ''
        }))
      })
  }
  async send(input: AgentRuntimeUserInput) {
    const prompt = await localContent(input, this.localSessionInfo.images)
    this.toolInputs.clear()
    this.begin()
    try {
      if (!this.connection || !this.nativeId) throw new Error('ACP session is not connected')
      await this.connection.agent.request('session/prompt', { sessionId: this.nativeId, prompt })
      this.finish()
    } catch (error) {
      this.finish(error)
    }
  }
  protected async stop() {
    if (this.active && this.nativeId) {
      await this.connection?.agent.notify('session/cancel', { sessionId: this.nativeId }).catch(() => {})
      await this.waitForTurn()
    }
    this.connection?.close()
    await Promise.all([...this.terminals.values()].map((terminal) => this.stopProcess(terminal.child)))
    this.terminals.clear()
    await this.stopProcess(this.process)
  }
}
