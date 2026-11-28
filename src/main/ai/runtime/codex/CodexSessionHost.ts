import { runtimeId } from '@cherrystudio/agent-runtime'
import {
  CodexRestoreError,
  CodexSession,
  type CodexSessionEvent,
  type CodexThreadRestore
} from '@cherrystudio/agent-runtime-codex'
import { selectedPermissionMode } from '@cherrystudio/agent-runtime/cli'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import type { LocalAgentSessionInfo } from '@shared/ai/localAgent'
import { LocalAgentTurnUsageSchema } from '@shared/ai/localAgentUsage'
import { NativeQuestionReplySchema } from '@shared/ai/nativeInteraction'

import { acquireLocalAgentBrowserLease, LOCAL_AGENT_AUTOMATION_SERVER_NAME } from '../../mcp/localAgentBrowserBridge'
import type { LocalAgentBrowserLease } from '../../mcp/LocalAgentMcpBridgeService'
import { LocalAgentSessionRestoreError } from '../LocalAgentSessionRestoreError'
import { LocalConnection, type LocalSource } from '../LocalConnection'
import { localContent } from '../localContent'
import type { AgentRuntimeUserInput, AgentRuntimeInput, AgentRuntimeConnectInput } from '../types'
import { resolveCodexLaunch } from './codexLaunch'
import { codexProcessHost } from './processHost'

const browserTokenEnv = 'CHERRY_BROWSER_MCP_TOKEN'

export class CodexSessionHost extends LocalConnection {
  private readonly textItems = new Map<
    string,
    { part: number; source: LocalSource; streamed: boolean; phase?: string; kind: 'agentMessage' | 'plan' }
  >()
  private callbacks?: Pick<AgentRuntimeConnectInput, 'onSteerInjected'>
  private branchHead?: string
  private planPart?: number
  private session?: CodexSession
  private browser?: LocalAgentBrowserLease
  private modelBinding?: { dispose(): Promise<void> }

  override get localSessionInfo(): LocalAgentSessionInfo {
    return this.session?.info ?? super.localSessionInfo
  }

  async start(cwd: string, restore?: CodexThreadRestore | string, branchHead?: string): Promise<this> {
    this.branchHead = branchHead
    const signal = this.abort.signal
    try {
      const { modelBinding, ...launch } = await resolveCodexLaunch(this.config, cwd, signal, 'chat', this.sessionId)
      this.modelBinding = modelBinding
      signal.throwIfAborted()
      const env = { ...launch.env }
      const browser = await acquireLocalAgentBrowserLease({
        sessionId: this.sessionId,
        agentId: this.agentId,
        config: this.config,
        headless: this.headless,
        signal,
        isReadOnly: () => selectedPermissionMode(this.localSessionInfo.mode) === 'plan'
      })
      if (signal.aborted) {
        await browser?.dispose()
        signal.throwIfAborted()
      }
      this.browser = browser
      if (this.browser) env[browserTokenEnv] = this.browser.token
      this.session = await CodexSession.launch(
        { ...launch, env },
        {
          restore: typeof restore === 'string' ? { threadId: restore, kind: 'required' } : restore,
          model: this.config.nativeModel,
          headless: this.headless,
          signal,
          mcp: this.browser && {
            name: LOCAL_AGENT_AUTOMATION_SERVER_NAME,
            url: this.browser.url,
            tokenEnv: browserTokenEnv,
            approvedTools: ['js', 'reset']
          }
        },
        {
          ...codexProcessHost,
          approve: async ({ itemId, title, input, options }, approvalSignal) => {
            const decision = await this.approve(
              itemId,
              title,
              { ...input, localPermissionOptions: options },
              approvalSignal
            )
            const optionId = decision.updatedInput?.localPermissionOption
            return { approved: decision.approved, optionId: typeof optionId === 'string' ? optionId : undefined }
          },
          form: (message, schema, signal) => this.elicit(message, schema, 'Codex', signal),
          question: async (id, native, signal) => {
            const questions = native.map(({ id, question, header, options }) => ({
              id,
              question,
              header,
              options: options ?? [],
              multiSelect: false
            }))
            const input = { questions, responseMode: 'native-request' }
            const turn = this.turnAbort.signal
            const answer = await this.approve(id, 'AskUserQuestion', input, signal)
            const reply =
              answer.approved && !signal.aborted
                ? NativeQuestionReplySchema.safeParse(answer.updatedInput).data
                : undefined
            if (this.active && !turn.aborted)
              this.result(id, { ...input, answers: reply ? answer.updatedInput?.answers : {} })
            return reply?.action === 'submit' ? reply.selections : []
          },
          emit: (event) => this.receive(event)
        }
      )
      signal.throwIfAborted()
      this.publishResumeToken(this.session.id)
      return this
    } catch (error) {
      await this.close()
      if (error instanceof CodexRestoreError) throw new LocalAgentSessionRestoreError(error.message)
      throw error
    }
  }

  private receive(event: CodexSessionEvent) {
    switch (event.type) {
      case 'options-changed':
        if (this.session) this.events.push({ type: 'local-session-info', info: this.session.info })
        return
      case 'thread-changed':
        return this.publishResumeToken(event.threadId)
      case 'native-start': {
        const anchor = this.branchHead ?? agentSessionMessageService.captureHead(this.sessionId)
        if (!this.claimLocalContext(anchor, event.threadId)) return
        this.events.push({ type: 'autonomous-turn-state', state: 'started', origin: { kind: 'native-turn' } })
        this.begin(anchor, event.threadId)
        return
      }
      case 'native-finish':
        this.events.push({ type: 'autonomous-turn-state', state: 'finished' })
        return
      case 'plan': {
        const entries = event.steps.map(({ step, status }) => ({
          content: step,
          status: status === 'inProgress' ? ('in_progress' as const) : status,
          priority: 'medium' as const
        }))
        this.planPart = this.putData({ type: 'data-agent-plan', id: event.turnId, data: { entries } }, this.planPart)
        return
      }
      case 'text-open':
      case 'text-append':
      case 'text-finish':
        return this.nativeText(event)
      case 'steer-boundary':
        this.branchHead = event.inputIds.at(-1) ?? this.branchHead
        this.callbacks?.onSteerInjected?.(event.inputIds)
        if (this.contextId)
          for (const id of event.inputIds)
            this.events.push({
              type: 'input-state',
              contextId: this.contextId,
              input: { inputId: runtimeId(id), facts: ['accepted', 'placed'] }
            })
        this.events.push({ type: event.type, inputIds: event.inputIds })
        this.planPart = undefined
        this.continueSource()
        return
      case 'text':
        return this.content(event.text)
      case 'tool':
        return this.tool(event.itemId, event.name, event.input)
      case 'tool-result':
        return this.result(event.itemId, event.output, event.failed)
      case 'finished':
        this.planPart = undefined
        for (const [itemId, slot] of this.textItems)
          this.editPart(
            {
              type: 'finish',
              part: slot.part,
              providerMetadata: { codex: { itemId, ...(slot.phase && { phase: slot.phase }), kind: slot.kind } }
            },
            slot.source
          )
        this.textItems.clear()
        return this.finish(event.error, event.reason)
      case 'disconnected':
        return this.dispose()
      case 'usage': {
        const model = event.model ?? this.localSessionInfo.activeModel?.id ?? this.config.nativeModel ?? ''
        const summary = LocalAgentTurnUsageSchema.safeParse({
          nativeSessionId: event.threadId,
          model: model || null,
          usage: event.usage,
          reportedAt: Date.now(),
          correlation: 'unknown'
        })
        if (summary.success) this.events.push({ type: 'local-turn-usage', summary: summary.data })
        const { modelContextWindow, turnId, inputTokens } = event.lastRequest
        this.events.push({
          type: 'context-usage',
          result: {
            status: 'confirmed',
            value: {
              model,
              revision: `${model}:${turnId}`,
              ...(modelContextWindow !== undefined && { contextWindow: modelContextWindow }),
              basis: 'last-request',
              used: { tokens: inputTokens, precision: 'reported' }
            }
          }
        })
        return
      }
      case 'compaction-start':
      case 'compaction-complete':
      case 'compaction-error':
      case 'session-title':
      case 'supported-commands':
        this.events.push(event)
        return
      default:
        event satisfies never
    }
  }

  private nativeText(event: Extract<CodexSessionEvent, { type: 'text-open' | 'text-append' | 'text-finish' }>) {
    if (!this.active) return
    let slot = this.textItems.get(event.itemId)
    const phase = event.phase ?? slot?.phase
    const providerMetadata = { codex: { itemId: event.itemId, kind: event.kind, ...(phase && { phase }) } }
    if (!slot) {
      slot = { part: this.source.nextPart++, source: this.source, streamed: false, phase, kind: event.kind }
      this.textItems.set(event.itemId, slot)
      this.editPart({ type: 'open', kind: 'text', part: slot.part, providerMetadata }, slot.source)
    }
    slot.phase = phase
    if (event.type === 'text-open') return
    if (event.type === 'text-append') {
      slot.streamed = true
      this.editPart({ type: 'append', part: slot.part, text: event.text }, slot.source)
      return
    }
    if (event.kind === 'plan' && slot.streamed)
      this.editPart(
        { type: 'correct', kind: 'text', part: slot.part, text: event.text, state: 'done', providerMetadata },
        slot.source
      )
    else {
      if (!slot.streamed && event.text)
        this.editPart({ type: 'append', part: slot.part, text: event.text }, slot.source)
      this.editPart({ type: 'finish', part: slot.part, providerMetadata }, slot.source)
    }
    this.textItems.delete(event.itemId)
  }

  bindInputs(callbacks: Pick<AgentRuntimeConnectInput, 'onSteerInjected'>) {
    this.callbacks = callbacks
  }

  get threadInput(): AgentRuntimeInput | undefined {
    const session = this.session
    if (!session || !this.active || !this.contextId || this.headless) return
    return {
      steer: {
        whenIdle: 'reject',
        submit: ({ inputId, ...input }) => session.steer(inputId, () => localContent(input, session.info.images))
      }
    }
  }

  get compact() {
    const session = this.session
    return session && !this.headless ? () => session.compact() : undefined
  }

  private get connected() {
    if (!this.session) throw new Error('Codex session is unavailable')
    return this.session
  }

  override async getSupportedCommands() {
    return this.session?.listCommands() ?? null
  }

  async setMode(configId: string, value: string) {
    const info = this.connected.setMode(configId, value)
    this.events.push({ type: 'local-session-info', info })
    return info
  }
  async setThoughtLevel(configId: string, value: string) {
    const info = this.connected.setThoughtLevel(configId, value)
    this.events.push({ type: 'local-session-info', info })
    return info
  }
  async send(input: AgentRuntimeUserInput) {
    const session = this.connected
    const content = await localContent(input, session.info.images)
    this.begin(input)
    this.branchHead = input.message.id
    try {
      await session.send(content, input.message.id)
    } catch (error) {
      this.finish(error)
    }
  }
  protected async stop() {
    void this.session?.interrupt().catch(() => {})
    if (this.active) await this.waitForTurn()
    await this.session?.close()
  }
  protected override dispose() {
    void this.browser?.dispose().catch(() => {})
    this.browser = undefined
    void this.modelBinding?.dispose().catch(() => {})
    this.modelBinding = undefined
    super.dispose()
  }
}
