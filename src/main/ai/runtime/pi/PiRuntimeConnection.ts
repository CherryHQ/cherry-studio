import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import type { AgentSession, AgentSessionEvent, LoadExtensionsResult } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import { buildAgentUserContent } from '@main/ai/runtime/agentUserContent'
import { application } from '@main/core/application'

import type {
  AgentRuntimeConnectInput,
  AgentRuntimeConnection,
  AgentRuntimeEvent,
  AgentRuntimeUserInput
} from '../types'
import { resolvePiProviderInjection } from './modelInjection'
import { loadPiSdk } from './piSdk'
import { PiStreamAdapter } from './piStreamAdapter'
import { createPiProviderExtension } from './providerExtension'

const logger = loggerService.withContext('PiRuntimeConnection')

/** Bridges pi's callback-based `subscribe` onto the `AsyncIterable` event contract. */
class AsyncEventQueue<T> implements AsyncIterable<T> {
  private readonly items: T[] = []
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = []
  private closed = false

  push(item: T): void {
    if (this.closed) return
    const waiter = this.waiters.shift()
    if (waiter) {
      waiter({ value: item, done: false })
      return
    }
    this.items.push(item)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    while (this.waiters.length > 0) {
      this.waiters.shift()?.({ value: undefined as T, done: true })
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        const item = this.items.shift()
        if (item) return Promise.resolve({ value: item, done: false })
        if (this.closed) return Promise.resolve({ value: undefined as T, done: true })
        return new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve)
        })
      }
    }
  }
}

export class PiRuntimeConnection implements AgentRuntimeConnection {
  private readonly eventQueue = new AsyncEventQueue<AgentRuntimeEvent>()
  private readonly adapter = new PiStreamAdapter({ enqueue: (chunk) => this.eventQueue.push({ type: 'chunk', chunk }) })
  private session?: AgentSession
  private unsubscribe?: () => void
  private resumeToken?: string
  private lastStopReason?: string
  private closed = false

  readonly events = this.eventQueue

  constructor(private readonly input: AgentRuntimeConnectInput) {
    this.resumeToken = input.resumeToken
  }

  async start(): Promise<this> {
    const session = await agentSessionService.getById(this.input.sessionId)
    const workspacePath = session?.workspace?.path
    if (!session?.agentId || !workspacePath) {
      throw new Error(`pi agent session ${this.input.sessionId} has no agent or workspace configured`)
    }
    const agent = await agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`pi agent ${session.agentId} has no model configured`)
    }

    const injection = await resolvePiProviderInjection(this.input.modelId ?? agent.model)

    const agentDir = application.getPath('feature.agents.pi.root')
    const sessionDir = application.getPath('feature.agents.pi.sessions')
    // Belt: force pi's global discovery away from the user's ~/.pi/agent. The
    // explicit `agentDir`/session-dir passed to the SDK objects below are the
    // suspenders (plan D9).
    process.env.PI_CODING_AGENT_DIR = agentDir
    process.env.PI_CODING_AGENT_SESSION_DIR = sessionDir

    const pi = await loadPiSdk()

    // Cherry owns the credential + model registry: in-memory only, never pi's
    // global auth.json/models.json. The real key is a runtime override; the
    // registered provider config carries only the placeholder (plan D1).
    const authStorage = pi.AuthStorage.inMemory()
    authStorage.setRuntimeApiKey(injection.providerName, injection.apiKey)
    const modelRegistry = pi.ModelRegistry.inMemory(authStorage)
    modelRegistry.registerProvider(injection.providerName, injection.providerConfig)
    const model = modelRegistry.find(injection.providerName, injection.modelId)
    if (!model) {
      throw new Error(`pi model ${injection.providerName}/${injection.modelId} could not be resolved after injection`)
    }

    const settingsManager = pi.SettingsManager.inMemory()

    const instructions = agent.instructions?.trim()
    const resourceLoader = new pi.DefaultResourceLoader({
      cwd: workspacePath,
      agentDir,
      settingsManager,
      // Provider injection re-applies across reloads (plan D1); approval joins in Phase 3.
      extensionFactories: [createPiProviderExtension(injection.providerName, injection.providerConfig)],
      // Cherry owns the persona: replace pi's discovered system prompt with the
      // agent's instructions when present, else keep pi's base (plan Phase 2).
      ...(instructions ? { systemPromptOverride: () => instructions } : {})
    })
    // Fail-closed project trust for executable workspace resources (plan D9).
    const trustStore = new pi.ProjectTrustStore(agentDir)
    await resourceLoader.reload({
      resolveProjectTrust: async (loadInput: { extensionsResult: LoadExtensionsResult }) => {
        const requiresTrust = pi.hasTrustRequiringProjectResources(workspacePath)
        const decision = trustStore.get(workspacePath) === true
        if (requiresTrust && !decision) {
          logger.info('pi workspace carries trust-requiring resources; leaving them unloaded until trusted', {
            sessionId: this.input.sessionId,
            extensions: loadInput.extensionsResult.extensions.length
          })
        }
        // Executable project resources load only when explicitly trusted; the
        // user-facing prompt that writes the decision lands in Phase 5.
        return decision
      }
    })

    const sessionManager = this.resumeToken
      ? pi.SessionManager.open(this.resumeToken, sessionDir, workspacePath)
      : pi.SessionManager.create(workspacePath, sessionDir)

    const { session: piSession } = await pi.createAgentSession({
      cwd: workspacePath,
      agentDir,
      authStorage,
      modelRegistry,
      settingsManager,
      sessionManager,
      resourceLoader,
      model
    })

    this.session = piSession
    this.unsubscribe = piSession.subscribe((event) => this.handlePiEvent(event))
    this.maybeEmitResumeToken()
    return this
  }

  send(input: AgentRuntimeUserInput): void {
    const content = buildAgentUserContent(input.message)
    const session = this.session
    if (!session) {
      this.eventQueue.push({ type: 'error', error: new Error('pi session is not started') })
      return
    }
    // No native steer in v1 (plan D6): the host only calls send() to start a
    // turn. `followUp` is a defensive guard in case a message arrives while a
    // turn is still winding down.
    const options = session.isStreaming ? ({ streamingBehavior: 'followUp' } as const) : undefined
    void session.prompt(content, options).catch((error) => {
      if (this.closed) return
      logger.error('pi prompt failed', error as Error)
      this.eventQueue.push({ type: 'error', error })
    })
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // Unsubscribe first so the abort's terminal events do not race into a
    // closing queue.
    this.unsubscribe?.()
    this.unsubscribe = undefined
    try {
      await this.session?.abort()
    } catch (error) {
      logger.warn('pi session abort failed during close', { error })
    }
    this.session?.dispose()
    this.session = undefined
    this.eventQueue.close()
  }

  private handlePiEvent(event: AgentSessionEvent): void {
    if (this.closed) return
    this.adapter.handleEvent(event)

    if (event.type === 'turn_end') {
      const stopReason = (event.message as { stopReason?: string }).stopReason
      if (stopReason) this.lastStopReason = stopReason
      return
    }

    if (event.type === 'agent_end') {
      // Auto-retry pending — the loop is not actually done, so hold the turn open.
      if (event.willRetry) return
      this.maybeEmitResumeToken()
      if (this.lastStopReason === 'error') {
        const message = lastErrorMessage(event.messages)
        this.eventQueue.push({ type: 'error', error: new Error(message ?? 'pi agent turn failed') })
      } else {
        this.eventQueue.push({ type: 'turn-complete' })
      }
      this.lastStopReason = undefined
    }
  }

  /** resume-token = pi `sessionFile` path (reopen handle for `SessionManager.open`). */
  private maybeEmitResumeToken(): void {
    const sessionFile = this.session?.sessionFile
    if (!sessionFile || sessionFile === this.resumeToken) return
    this.resumeToken = sessionFile
    this.eventQueue.push({ type: 'resume-token', token: sessionFile })
  }
}

function lastErrorMessage(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; errorMessage?: string }
    if (message.role === 'assistant' && typeof message.errorMessage === 'string') return message.errorMessage
  }
  return undefined
}
