import type { ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import { Readable, Writable } from 'node:stream'

import {
  client,
  ndJsonStream,
  type ClientConnection,
  type PromptResponse,
  type NewSessionResponse,
  type LoadSessionResponse,
  type SessionConfigOption,
  type PromptCapabilities,
  type SessionUpdate,
  type SetSessionConfigOptionResponse
} from '@agentclientprotocol/sdk'
import * as z from 'zod'

import { loggerService } from '@logger'
import { crossPlatformSpawn } from '@main/utils/processRunner'
import type { LocalAcpTool } from '@shared/ai/localAgent'

import type { AgentRuntimeUserInput, AgentSessionUsageCapture } from '../types'
import { registerCursorExtension } from './cursorExtension'
import { resolveLocalAgentLaunch } from './launch'
import { LocalConnection } from './LocalConnection'
import { acpContent } from './localContent'

const logger = loggerService.withContext('AcpConnection')
const LegacyModelsSchema = z.object({
  currentModelId: z.string(),
  availableModels: z.array(z.object({ modelId: z.string(), name: z.string() }))
})
type SessionResponse = (NewSessionResponse | LoadSessionResponse) & { models?: unknown }

type Terminal = {
  child: ChildProcess
  output: string
  truncated: boolean
  exited: Promise<{ exitCode?: number; signal?: string }>
}

export class AcpConnection extends LocalConnection {
  private promptCapabilities: PromptCapabilities = {}
  readonly usageCapture: AgentSessionUsageCapture = {
    owner: 'agent-sdk',
    credentialReceipt: { attribution: 'auth', method: 'external-cli' },
    providerId: `local-agent:${this.config.presetId ?? this.agentId}`,
    providerName: null,
    source: { type: 'agent', id: this.agentId, name: null, icon: null },
    frozenModels: []
  }
  private process?: ChildProcess
  private connection?: ClientConnection
  private nativeId?: string
  private readonly terminals = new Map<string, Terminal>()
  private loading = false
  private modelConfigId?: string
  private legacyModels = false
  private configChange?: Promise<void>
  private modeConfigId?: string
  private legacyMode?: NonNullable<NewSessionResponse['modes']>
  private planId?: string
  private pendingUpdates: Array<{ sessionId: string; update: SessionUpdate }> = []
  private readonly toolInputs = new Map<string, LocalAcpTool>()

  async authenticate(methodId: string): Promise<void> {
    if (!this.connection || !this.localSessionInfo.protocolInfo?.authMethods.some((method) => method.id === methodId)) {
      throw new Error('Unsupported authentication method')
    }
    await this.connection.agent.request('authenticate', { methodId })
  }

  async start(cwd: string, resume?: string, probe: boolean | 'models' = false): Promise<this> {
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
        if (this.loading) {
          if (
            params.update.sessionUpdate === 'available_commands_update' ||
            params.update.sessionUpdate === 'config_option_update' ||
            params.update.sessionUpdate === 'current_mode_update'
          )
            this.pendingUpdates.push(params)
        } else if (params.sessionId === this.nativeId) this.update(params.update)
      })
      .onRequest('session/request_permission', async ({ params }) => {
        const id = params.toolCall.toolCallId
        const knownTool = this.tools.has(id)
        const options = params.options
        const answer = await this.approve(id, `ACP: ${params.toolCall.title ?? 'Tool'}`, {
          localAcpTool: this.toolInputs.get(id),
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
          for (const [id, tool] of this.toolInputs) {
            if (
              tool.content?.some(
                (item) =>
                  typeof item === 'object' && item !== null && 'terminalId' in item && item.terminalId === terminalId
              )
            ) {
              tool.terminals = { ...tool.terminals, [terminalId]: terminal.output }
              this.publishTool(id, tool)
            }
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
    registerCursorExtension(app, {
      isActive: () => this.active && !this.abort.signal.aborted,
      signal: this.abort.signal,
      approve: (id, name, input) => this.approve(id, name, input),
      text: (text) => this.content(text),
      result: (id, output) => this.result(id, output)
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
    this.localSessionInfo.protocolInfo = {
      protocolVersion: response.protocolVersion,
      agent: response.agentInfo
        ? {
            name: response.agentInfo.name,
            version: response.agentInfo.version,
            ...(response.agentInfo.title ? { title: response.agentInfo.title } : {})
          }
        : undefined,
      capabilities: response.agentCapabilities ?? {},
      authMethods: (response.authMethods ?? []).map(({ id, name }) => ({ id, name })),
      verified: ['handshake']
    }
    logger.info('ACP handshake completed', {
      agentId: this.agentId,
      protocolVersion: response.protocolVersion,
      agent: this.localSessionInfo.protocolInfo.agent
    })
    this.localSessionInfo.resume = response.agentCapabilities?.loadSession === true
    this.promptCapabilities = response.agentCapabilities?.promptCapabilities ?? {}
    this.localSessionInfo.images = this.promptCapabilities.image === true
    if (probe === true) return this
    this.loading = true
    try {
      if (resume) {
        if (!response.agentCapabilities?.loadSession)
          throw new Error('This agent cannot restore the previous conversation; create a new session')
        const session = await this.connection.agent.request<SessionResponse>('session/load', {
          cwd,
          sessionId: resume,
          mcpServers: []
        })
        this.readSessionModels(session)
        this.nativeId = resume
      } else {
        const session = await this.connection.agent.request<NewSessionResponse & { models?: unknown }>('session/new', {
          cwd,
          mcpServers: []
        })
        this.nativeId = session.sessionId
        this.readSessionModels(session)
      }
      for (const pending of this.pendingUpdates.splice(0)) {
        if (pending.sessionId === this.nativeId) this.update(pending.update)
      }
      if (this.config.nativeModel && this.localSessionInfo.activeModel?.id !== this.config.nativeModel) {
        if (this.modelConfigId) {
          const updated = await this.connection.agent.request<SetSessionConfigOptionResponse>(
            'session/set_config_option',
            {
              sessionId: this.nativeId,
              configId: this.modelConfigId,
              value: this.config.nativeModel
            }
          )
          this.readConfigOptions(updated.configOptions)
        } else if (this.legacyModels) {
          await this.connection.agent.request('session/set_model', {
            sessionId: this.nativeId,
            modelId: this.config.nativeModel
          })
          this.localSessionInfo.activeModel = { id: this.config.nativeModel }
        } else throw new Error('This agent does not support model selection')
      }
      this.localSessionInfo.protocolInfo.verified.push('session')
      this.events.push({ type: 'resume-token', token: this.nativeId })
    } finally {
      this.loading = false
      for (const pending of this.pendingUpdates.splice(0)) {
        if (pending.sessionId === this.nativeId) this.update(pending.update)
      }
    }
    return this
  }
  private readSessionModels(session: SessionResponse) {
    this.legacyMode = session.modes ?? undefined
    const legacy = LegacyModelsSchema.safeParse(session.models)
    this.legacyModels = legacy.success
    if (legacy.success) {
      this.localSessionInfo.models = legacy.data.availableModels.map((model) => ({
        id: model.modelId,
        name: model.name
      }))
      this.localSessionInfo.activeModel = { id: legacy.data.currentModelId }
    }
    this.readConfigOptions(session.configOptions)
  }
  async setMode(configId: string, value: string) {
    return this.setSelection('mode', configId, value)
  }
  async setThoughtLevel(configId: string, value: string) {
    return this.setSelection('thoughtLevel', configId, value)
  }
  private async setSelection(category: 'mode' | 'thoughtLevel', configId: string, value: string) {
    if (!this.connection || !this.nativeId || this.closed || this.active || this.configChange)
      throw new Error('ACP session is unavailable or busy')
    const thought = this.localSessionInfo[category]
    if (thought?.id !== configId || !thought.options.some((option) => option.value === value))
      throw new Error('This session option is no longer available')
    this.configChange =
      category === 'mode' && !this.modeConfigId
        ? this.connection.agent.request('session/set_mode', { sessionId: this.nativeId, modeId: value }).then(() => {
            if (this.legacyMode) this.legacyMode.currentModeId = value
            if (this.localSessionInfo.mode) this.localSessionInfo.mode.currentValue = value
            this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
          })
        : this.connection.agent
            .request<SetSessionConfigOptionResponse>('session/set_config_option', {
              sessionId: this.nativeId,
              configId,
              value
            })
            .then((response) => this.readConfigOptions(response.configOptions))
    try {
      await this.configChange
      return this.localSessionInfo
    } finally {
      this.configChange = undefined
    }
  }

  private readConfigOptions(options?: SessionConfigOption[] | null) {
    const mode = options?.find((option) => option.category === 'mode' && option.type === 'select')
    this.modeConfigId = mode?.id
    this.localSessionInfo.mode =
      mode?.type === 'select'
        ? {
            id: mode.id,
            currentValue: mode.currentValue,
            options: mode.options
              .flatMap((option) => ('group' in option ? option.options : [option]))
              .map(({ value, name, description }) => ({ value, name, description: description ?? undefined }))
          }
        : this.legacyMode
          ? {
              id: 'legacy-mode',
              currentValue: this.legacyMode.currentModeId,
              options: this.legacyMode.availableModes.map(({ id, name, description }) => ({
                value: id,
                name,
                description: description ?? undefined
              }))
            }
          : undefined
    const thought = options?.find((option) => option.category === 'thought_level' && option.type === 'select')
    this.localSessionInfo.thoughtLevel =
      thought?.type === 'select'
        ? {
            id: thought.id,
            currentValue: thought.currentValue,
            options: thought.options
              .flatMap((option) => ('group' in option ? option.options : [option]))
              .map(({ value, name }) => ({ value, name }))
          }
        : undefined
    const model = options?.find((option) => option.category === 'model' && option.type === 'select')
    if (model?.type === 'select') {
      this.modelConfigId = model.id
      this.localSessionInfo.activeModel = { id: model.currentValue }
      this.localSessionInfo.models = model.options
        .flatMap((option) => ('group' in option ? option.options : [option]))
        .map((option) => ({ id: option.value, name: option.name }))
    }
    this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
  }
  private terminal(id: string): Terminal {
    const terminal = this.terminals.get(id)
    if (!terminal) throw new Error('Unknown session terminal')
    return terminal
  }
  private update(update: SessionUpdate) {
    if (update.sessionUpdate === 'current_mode_update' && !this.modeConfigId && this.legacyMode) {
      this.legacyMode.currentModeId = update.currentModeId
      if (this.localSessionInfo.mode) this.localSessionInfo.mode.currentValue = update.currentModeId
      this.events.push({ type: 'local-session-info', info: structuredClone(this.localSessionInfo) })
    }
    if (update.sessionUpdate === 'agent_thought_chunk' && update.content.type === 'text')
      this.content(update.content.text, 'reasoning')
    if (update.sessionUpdate === 'plan' && this.active) {
      this.endContent()
      this.planId ??= randomUUID()
      this.chunk({ type: 'data-agent-plan', id: this.planId, data: { entries: update.entries } })
    }
    if (update.sessionUpdate === 'config_option_update') this.readConfigOptions(update.configOptions)
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text')
      this.content(update.content.text)
    if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && this.active) {
      this.endContent()
      const previous = this.toolInputs.get(update.toolCallId)
      const tool: LocalAcpTool = { title: 'Tool', ...previous }
      for (const key of ['title', 'kind', 'status', 'content', 'locations', 'rawInput', 'rawOutput'] as const) {
        if (update[key] != null) Object.assign(tool, { [key]: update[key] })
      }
      this.toolInputs.set(update.toolCallId, tool)
      this.publishTool(update.toolCallId, tool)
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
  private publishTool(id: string, tool: LocalAcpTool) {
    if (!this.active) return
    for (const item of tool.content ?? []) {
      if (typeof item === 'object' && item !== null && 'terminalId' in item && typeof item.terminalId === 'string') {
        const terminal = this.terminals.get(item.terminalId)
        if (terminal) tool.terminals = { ...tool.terminals, [item.terminalId]: terminal.output }
      }
    }
    this.tool(id, `ACP: ${tool.title}`, { localAcpTool: structuredClone(tool) }, true)
    if (tool.status === 'completed' || tool.status === 'failed')
      this.result(id, tool.rawOutput ?? tool.content ?? tool.status, tool.status === 'failed')
  }

  async send(input: AgentRuntimeUserInput) {
    const prompt = await acpContent(input, this.promptCapabilities)
    await this.configChange?.catch(() => {})
    this.planId = undefined
    this.toolInputs.clear()
    this.begin()
    try {
      if (!this.connection || !this.nativeId) throw new Error('ACP session is not connected')
      const model = this.localSessionInfo.activeModel?.id ?? this.config.nativeModel ?? 'unknown'
      const response = await this.connection.agent.request<PromptResponse>('session/prompt', {
        sessionId: this.nativeId,
        prompt
      })
      const usage = response.usage
      if (usage) {
        this.events.push({
          type: 'usage',
          invocation: {
            requestId: `acp:${randomUUID()}`,
            model,
            messageAssociation: 'current-turn',
            usage: {
              inputTokens: usage.inputTokens + (usage.cachedReadTokens ?? 0) + (usage.cachedWriteTokens ?? 0),
              outputTokens: usage.outputTokens + (usage.thoughtTokens ?? 0),
              totalTokens: usage.totalTokens,
              noCacheTokens: usage.inputTokens,
              ...(usage.thoughtTokens != null ? { reasoningTokens: usage.thoughtTokens } : {}),
              ...(usage.cachedReadTokens != null ? { cacheReadTokens: usage.cachedReadTokens } : {}),
              ...(usage.cachedWriteTokens != null ? { cacheWriteTokens: usage.cachedWriteTokens } : {})
            }
          }
        })
      }
      if (!this.localSessionInfo.protocolInfo?.verified.includes('prompt'))
        this.localSessionInfo.protocolInfo?.verified.push('prompt')
      this.finish(
        undefined,
        response.stopReason === 'cancelled'
          ? 'cancelled'
          : response.stopReason === 'refusal'
            ? 'content-filter'
            : response.stopReason === 'max_tokens' || response.stopReason === 'max_turn_requests'
              ? 'length'
              : response.stopReason === 'end_turn'
                ? 'stop'
                : 'other'
      )
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
