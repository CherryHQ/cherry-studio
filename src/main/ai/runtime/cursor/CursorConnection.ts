import { openCursorSession, sendCursorTurn, type Run, type SDKAgent } from '@cherrystudio/agent-runtime-cursor'
import { CURSOR_PERMISSION_MODES } from '@cherrystudio/agent-runtime-cursor/cli'

import { acquireLocalAgentBrowserLease } from '../../mcp/localAgentBrowserBridge'
import type { LocalAgentBrowserLease } from '../../mcp/LocalAgentMcpBridgeService'
import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import { LocalConnection } from '../LocalConnection'
import { localContent } from '../localContent'
import { resolveLocalModelContextWindow } from '../modelContextWindow'
import type { AgentRuntimeUserInput } from '../types'
import { getCursorApiKey } from './cursorAccount'

export class CursorConnection extends LocalConnection {
  private agent?: SDKAgent
  private browser?: LocalAgentBrowserLease
  private get mode() {
    const currentValue = this.localSessionInfo.mode?.currentValue
    return (
      CURSOR_PERMISSION_MODES.options.find(({ value }) => value === currentValue) ?? CURSOR_PERMISSION_MODES.options[0]
    )
  }
  private pendingRun?: Promise<Run>
  private hasContextUsageReading = false

  async start(cwd: string, resume?: string): Promise<this> {
    const apiKey = await getCursorApiKey(this.config, this.abort.signal)
    this.abort.signal.throwIfAborted()
    const model = this.config.nativeModel || 'auto'
    this.localSessionInfo.activeModel = { id: model }
    this.localSessionInfo.images = true
    this.localSessionInfo.resume = true
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
    const agent = await openCursorSession({
      cwd,
      apiKey,
      model,
      agentId: resume,
      browser: this.browser && { type: 'http', url: this.browser.url, headers: this.browser.headers }
    }).catch((error: unknown) => {
      if (resume) throw new LocalAgentSessionRestoreError('Could not restore the Cursor SDK session', { cause: error })
      throw error
    })
    if (this.closed || (resume && agent.agentId !== resume)) {
      agent.close()
      this.abort.signal.throwIfAborted()
      throw new LocalAgentSessionRestoreError('Cursor returned a different session')
    }
    this.agent = agent
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

  async send(input: AgentRuntimeUserInput) {
    const agent = this.agent
    if (!agent) throw new Error('Cursor SDK session is unavailable')
    const parts = await localContent(input, true)
    const prompt = {
      text: parts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n'),
      images: parts.flatMap((p) => (p.type === 'image' ? [{ data: p.data, mimeType: p.mimeType }] : []))
    }
    this.begin(input.message.id)
    const signal = AbortSignal.any([this.abort.signal, this.turnAbort.signal])
    try {
      this.pendingRun = sendCursorTurn(agent, prompt, this.mode.value, {
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
      })
      const run = await this.pendingRun
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
        const contextWindow = resolveLocalModelContextWindow(model)
        if (contextWindow) {
          this.hasContextUsageReading = true
          this.events.push({
            type: 'context-usage',
            result: {
              status: 'confirmed',
              value: {
                model: model ?? '',
                revision: model ?? '',
                contextWindow,
                basis: 'last-request',
                used: { tokens: completed.usage.inputTokens, precision: 'estimated' }
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
                message: 'This agent does not report context window size'
              }
            }
          })
        }
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
