import {
  bindCursorSteer,
  completeCursorCompaction,
  openCursorSession,
  sendCursorTurn,
  type Run,
  type SDKAgent
} from '@cherrystudio/agent-runtime-cursor'
import { CURSOR_PERMISSION_MODES, resolveCursorModelId } from '@cherrystudio/agent-runtime-cursor/cli'
import { getShellEnv } from '@main/utils/shellEnv'

import { acquireLocalAgentBrowserLease } from '../../mcp/localAgentBrowserBridge'
import type { LocalAgentBrowserLease } from '../../mcp/LocalAgentMcpBridgeService'
import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import { LocalConnection } from '../LocalConnection'
import { localContent } from '../localContent'
import type { AgentRuntimeInput, AgentRuntimeUserInput } from '../types'
import { cursorCredentialSelection } from './cursorDriver'

export class CursorConnection extends LocalConnection {
  private agent?: SDKAgent
  private modelForEffort?: NonNullable<Awaited<ReturnType<typeof openCursorSession>>['effort']>['modelFor']
  private browser?: LocalAgentBrowserLease
  private get mode() {
    const currentValue = this.localSessionInfo.mode?.currentValue
    return (
      CURSOR_PERMISSION_MODES.options.find(({ value }) => value === currentValue) ?? CURSOR_PERMISSION_MODES.options[0]
    )
  }
  private pendingRun?: Promise<Run>
  private steerInput?: NonNullable<AgentRuntimeInput['steer']>
  private hasContextUsageReading = false

  get threadInput(): AgentRuntimeInput | undefined {
    return this.steerInput && { steer: this.steerInput }
  }

  get compact() {
    const agent = this.agent
    if (!agent?.summarize || this.headless || this.closed) return
    return async () => {
      if (this.pendingRun) throw new Error('Cursor already has an active run')
      const run = (this.pendingRun = agent.summarize())
      try {
        return await completeCursorCompaction(await run)
      } finally {
        this.pendingRun = undefined
      }
    }
  }

  async start(cwd: string, resume?: string): Promise<this> {
    this.abort.signal.throwIfAborted()
    const model = resolveCursorModelId(this.config.nativeModel)
    this.localSessionInfo.activeModel = { id: model }
    this.localSessionInfo.images = true
    this.localSessionInfo.resume = true
    if (!this.headless)
      this.localSessionInfo.mode = { ...CURSOR_PERMISSION_MODES, options: [...CURSOR_PERMISSION_MODES.options] }
    this.supportedCommands = []
    this.browser = await acquireLocalAgentBrowserLease({
      sessionId: this.sessionId,
      agentId: this.agentId,
      config: this.config,
      headless: this.headless,
      signal: this.abort.signal,
      isReadOnly: () => this.mode.permissionMode === 'plan'
    })
    this.abort.signal.throwIfAborted()
    const { agent, effort } = await openCursorSession({
      cwd,
      env: this.config.env,
      readShellEnv: getShellEnv,
      credential: cursorCredentialSelection(this.config),
      model,
      agentId: resume,
      headless: this.headless,
      signal: this.abort.signal,
      browser: this.browser && { type: 'http', url: this.browser.url, headers: this.browser.headers }
    }).catch((error: unknown) => {
      if (resume && error instanceof Error && 'code' in error && error.code === 'agent_not_found')
        throw new LocalAgentSessionRestoreError(error.message, { cause: error })
      throw error
    })
    if (this.closed || (resume && agent.agentId !== resume)) {
      agent.close()
      this.abort.signal.throwIfAborted()
      throw new LocalAgentSessionRestoreError('Cursor returned a different session')
    }
    this.agent = agent
    if (agent.model) this.localSessionInfo.activeModel = { id: agent.model.id }
    this.modelForEffort = effort?.modelFor
    this.localSessionInfo.thoughtLevel = effort?.control
    this.publishResumeToken(agent.agentId)
    return this
  }

  async setMode(id: string, value: string) {
    const mode = this.localSessionInfo.mode
    const selected = CURSOR_PERMISSION_MODES.options.find((option) => option.value === value)
    if (this.headless || this.closed || this.active || !mode || id !== mode.id || !selected)
      throw new Error('Cursor mode is unavailable')
    this.localSessionInfo.mode = { ...mode, currentValue: selected.value }
    this.events.push({ type: 'local-session-info', info: { ...this.localSessionInfo } })
    return this.localSessionInfo
  }

  async setThoughtLevel(id: string, value: string) {
    const effort = this.localSessionInfo.thoughtLevel
    if (
      this.headless ||
      this.closed ||
      this.active ||
      effort?.id !== id ||
      !effort.options.some((option) => option.value === value)
    )
      throw new Error('Cursor effort is unavailable')
    this.localSessionInfo.thoughtLevel = { ...effort, currentValue: value }
    this.events.push({ type: 'local-session-info', info: { ...this.localSessionInfo } })
    return this.localSessionInfo
  }

  async send(input: AgentRuntimeUserInput) {
    const agent = this.agent
    if (!agent) throw new Error('Cursor SDK session is unavailable')
    const parts = await localContent(input, true)
    const prompt = {
      text: parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n'),
      images: parts.flatMap((p) => (p.type === 'image' ? [{ data: p.data, mimeType: p.mimeType }] : []))
    }
    this.begin(input)
    const signal = AbortSignal.any([this.abort.signal, this.turnAbort.signal])
    let lastModelCall: { id: string; inputTokens: number } | undefined
    try {
      const effort = this.localSessionInfo.thoughtLevel
      this.pendingRun = sendCursorTurn(
        agent,
        prompt,
        this.mode.value,
        {
          modelCallCompleted: (id, inputTokens) => {
            if (!signal.aborted && Number.isFinite(inputTokens) && inputTokens >= 0) lastModelCall = { id, inputTokens }
          },
          append: (kind, text) => {
            if (!signal.aborted) this.content(text, kind)
          },
          toolStarted: (id, name, args) => {
            if (!signal.aborted && !this.tools.has(id)) {
              this.endContent()
              this.tool(id, name, args)
            }
          },
          toolCompleted: (id, output, failed) => {
            if (!signal.aborted) this.result(id, output, failed)
          }
        },
        effort && this.modelForEffort?.(effort.currentValue)
      )
      const run = await this.pendingRun
      const steer = bindCursorSteer(run, (inputId) => {
        const contextId = this.contextId
        if (!this.active || signal.aborted || !contextId) return false
        this.endContent()
        this.events.push({ type: 'input-state', contextId, input: { inputId, facts: ['accepted', 'placed'] } })
        this.events.push({ type: 'steer-boundary', inputIds: [inputId] })
        this.continueSource()
        return true
      })
      if (steer && !this.headless)
        this.steerInput = {
          whenIdle: 'reject',
          submit: async ({ inputId, message }) => {
            const parts = (message.data.parts ?? []).filter(({ type }) => type !== 'data-knowledge-scope')
            if (signal.aborted || !parts.length || parts.some(({ type }) => type !== 'text'))
              return {
                status: 'rejected',
                inputId,
                error: {
                  operation: 'steer',
                  code: 'unavailable',
                  message: 'Cursor steer requires a running turn and text input'
                }
              }
            const text = parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])).join('\n')
            return steer({ inputId, text })
          }
        }
      const completed = await run.wait()
      const model = completed.model?.id ?? agent.model?.id ?? this.localSessionInfo.activeModel?.id ?? null
      if (completed.usage) {
        this.events.push({
          type: 'local-turn-usage',
          summary: {
            nativeSessionId: agent.agentId,
            model,
            reportedAt: Date.now(),
            correlation: 'unknown',
            usage: completed.usage
          }
        })
      }
      if (lastModelCall) {
        this.hasContextUsageReading = true
        this.events.push({
          type: 'context-usage',
          result: {
            status: 'confirmed',
            value: {
              model: model ?? '',
              revision: lastModelCall.id,
              basis: 'last-request',
              used: { tokens: lastModelCall.inputTokens, precision: 'reported' }
            }
          }
        })
      } else if (!this.hasContextUsageReading) {
        this.hasContextUsageReading = true
        this.events.push({
          type: 'context-usage',
          result: {
            status: 'unsupported',
            error: {
              operation: 'contextUsage',
              code: 'unsupported',
              message: 'This agent does not report context usage'
            }
          }
        })
      }
      if (completed.status === 'error') throw new Error(completed.error?.message || 'Cursor run failed')
      this.finish(undefined, completed.status === 'cancelled' || signal.aborted ? 'cancelled' : 'stop')
    } catch (error) {
      if (signal.aborted) this.finish(undefined, 'cancelled')
      else this.finish(error)
    } finally {
      this.steerInput = undefined
      this.pendingRun = undefined
    }
  }

  protected async stop() {
    try {
      const run = await this.pendingRun?.catch(() => undefined)
      if (run?.status === 'running') {
        await run.cancel()
        await run.wait()
      }
    } finally {
      this.agent?.close()
      await this.browser?.dispose()
    }
  }
}
