import { openCursorSession, sendCursorTurn, type Run, type SDKAgent } from '@cherrystudio/agent-runtime-cursor'
import { getShellEnv } from '@main/utils/shellEnv'

import type { AgentRuntimeUserInput } from '../types'
import { acquireLocalAgentBrowserLease } from './browserBridge'
import { cursorWorkspaceTools } from './cursorTools'
import type { LocalAgentBrowserLease } from './LocalAgentMcpBridgeService'
import { LocalAgentSessionRestoreError } from './LocalAgentSessionRestoreError'
import { LocalConnection } from './LocalConnection'
import { localContent } from './localContent'

export class CursorConnection extends LocalConnection {
  private agent?: SDKAgent
  private browser?: LocalAgentBrowserLease
  private cwd = ''
  private mode: 'plan' | 'default' = 'default'
  private env: NodeJS.ProcessEnv = {}
  private pendingRun?: Promise<Run>

  async start(cwd: string, resume?: string): Promise<this> {
    this.cwd = cwd
    this.env = { ...(await getShellEnv(this.abort.signal)), ...this.config.env }
    const apiKey = this.env.CURSOR_API_KEY
    const model = this.config.nativeModel || 'auto'
    this.localSessionInfo.activeModel = { id: model }
    this.localSessionInfo.images = true
    this.localSessionInfo.resume = true
    this.localSessionInfo.mode = {
      id: 'cursor-mode',
      currentValue: this.mode,
      options: [
        { value: 'default', name: 'Default' },
        { value: 'plan', name: 'Plan' }
      ]
    }
    this.supportedCommands = []
    this.browser = await acquireLocalAgentBrowserLease({
      sessionId: this.sessionId,
      agentId: this.agentId,
      config: this.config,
      headless: this.headless,
      signal: this.abort.signal,
      isReadOnly: () => this.mode === 'plan'
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
    if (
      this.headless ||
      id !== 'cursor-mode' ||
      (value !== 'plan' && value !== 'default') ||
      !this.localSessionInfo.mode
    )
      throw new Error('Unsupported Cursor mode')
    this.mode = value
    this.localSessionInfo.mode.currentValue = value
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
      const tools = cursorWorkspaceTools({
        cwd: this.cwd,
        env: this.env,
        signal,
        isReadOnly: () => this.mode === 'plan',
        start: (id, name, args) => {
          this.endContent()
          this.tool(id, name, args)
        },
        approve: (id, name, args) => {
          this.endContent()
          return this.approve(id, name, args, signal)
        },
        finish: (id, text, failed) => this.result(id, text, failed)
      })
      this.pendingRun = sendCursorTurn(agent, prompt, this.mode === 'plan' ? 'plan' : 'agent', tools, {
        append: (kind, text) => {
          if (!signal.aborted) this.content(text, kind)
        },
        browserTool: (id, name, args) => {
          if (!signal.aborted && !this.tools.has(id)) {
            this.endContent()
            this.tool(id, name, args)
          }
        },
        browserResult: (id, output, failed) => {
          if (!signal.aborted) this.result(id, output, failed)
        }
      })
      const run = await this.pendingRun
      const completed = await run.wait()
      if (completed.usage)
        this.events.push({
          type: 'local-turn-usage',
          summary: {
            nativeSessionId: agent.agentId,
            model: completed.model?.id ?? agent.model?.id ?? null,
            reportedAt: Date.now(),
            correlation: 'unknown',
            usage: completed.usage
          }
        })
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
