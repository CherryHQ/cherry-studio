import {
  client,
  methods,
  RequestError,
  type ClientConnection,
  type ClientRequestContext,
  type InitializeResponse,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification
} from '@agentclientprotocol/sdk'
import * as z from 'zod'

import {
  runtimeId,
  type InputState,
  type Observation,
  type OperationResult,
  type SubmitResult,
  type Thread
} from '@cherrystudio/agent-runtime'

import { Projection } from './projection'
import { deadline, failure, unavailable, untilAborted } from './result'
import type {
  AcpHostContext,
  AcpInputDraft,
  AcpRuntime,
  AcpRuntimeOptions,
  AcpThreadHandle,
  AcpTransportLease
} from './types'

interface Prompt {
  readonly input: InputState
  readonly permissions: AbortController
  readonly done: Promise<OperationResult<void>>
  settle(result: OperationResult<void>): void
}
interface Owner {
  readonly thread: Thread
  readonly projection: Projection
  readonly inputs: Set<string>
  readonly observations: Set<Observation>
  work: Promise<void>
  active?: Prompt
  lost: boolean
  setup?: { count: number; bytes: number; overflow: boolean }
}

const stopReason = z.enum(['end_turn', 'cancelled', 'max_tokens', 'max_turn_requests', 'refusal'])

export function createAcpRuntime(options: AcpRuntimeOptions): AcpRuntime {
  let lease: AcpTransportLease | undefined
  let connection: ClientConnection | undefined
  let initialized: InitializeResponse | undefined
  let starting: Promise<InitializeResponse> | undefined
  let state: 'running' | 'stopping' | 'stopped' = 'running'
  let shutdownAttempt: Promise<OperationResult<void>> | undefined
  let creating = Promise.resolve()
  let provisional: { updates: SessionNotification[]; bytes: number; overflow: boolean } | undefined
  const stopping = new AbortController()
  const owners = new Map<string, Owner>()
  const opening = new Map<string, Promise<OperationResult<Owner>>>()
  const callbacks = options.callbacks ?? {}
  const report = (error: unknown) => {
    try {
      options.report(error)
    } catch {
      /* Diagnostics cannot change execution. */
    }
  }

  function enqueue(owner: Owner, work: () => Promise<void> | void): Promise<void> {
    owner.work = owner.work.then(work).catch((error: unknown) => {
      report(error)
      lose(owner, 'projection-failed')
    })
    return owner.work
  }

  function lose(owner: Owner, code: string): void {
    if (owner.lost) return
    owner.lost = true
    owner.active?.permissions.abort()
    if (owner.active) {
      owner.projection.publish({
        type: 'input.changed',
        input: { ...owner.active.input, error: failure('prompt', code, code) }
      })
      owner.active.settle(unavailable('prompt', code))
    }
    owner.projection.publish({ type: 'gap', reason: 'disconnected' })
    owner.projection.publish({ type: 'activity.changed', activity: { state: 'unknown' } })
  }

  function route(params: SessionNotification): void {
    const owner = owners.get(params.sessionId)
    if (owner) {
      if (owner.setup) {
        owner.setup.count++
        owner.setup.bytes += Buffer.byteLength(JSON.stringify(params), 'utf8')
        if (owner.setup.count > 256 || owner.setup.bytes > 8 * 1024 * 1024) {
          owner.setup.overflow = true
          return
        }
      }
      if (!owner.lost) void enqueue(owner, () => owner.projection.update(params.update))
    } else if (provisional) {
      provisional.bytes += Buffer.byteLength(JSON.stringify(params), 'utf8')
      if (provisional.updates.length >= 256 || provisional.bytes > 8 * 1024 * 1024) provisional.overflow = true
      else if (!provisional.overflow) provisional.updates.push(params)
    } else report(new Error(`Update for unowned ACP session: ${params.sessionId}`))
  }

  async function permission(params: RequestPermissionRequest, signal: AbortSignal): Promise<RequestPermissionResponse> {
    const owner = owners.get(params.sessionId)
    const prompt = owner?.active
    const cancelled: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } }
    if (!owner || !prompt || !callbacks.permission || owner.lost || state !== 'running') return cancelled
    const lifetime = AbortSignal.any([signal, stopping.signal, prompt.permissions.signal])
    try {
      const answer = await untilAborted(
        () => callbacks.permission!(params, { thread: owner.thread, signal: lifetime }),
        lifetime
      )
      if (lifetime.aborted || owner.active !== prompt) return cancelled
      const outcome = answer.outcome
      if (outcome.outcome === 'selected' && !params.options.some((option) => option.optionId === outcome.optionId)) {
        report(new Error('Permission selection was not offered by the agent'))
        return cancelled
      }
      return answer
    } catch (error) {
      if (!lifetime.aborted) report(error)
      return cancelled
    }
  }

  async function start(): Promise<InitializeResponse> {
    if (state !== 'running') throw new Error('Runtime is shutting down')
    if (starting) return starting
    starting = (async () => {
      lease = await options.connect()
      if (state !== 'running') throw new Error('Runtime is shutting down')
      const app = client({ name: 'cherry-acp-v1' })
        .onNotification(methods.client.session.update, ({ params }) => route(params))
        .onRequest(methods.client.session.requestPermission, ({ params, signal }) => permission(params, signal))
      function host<P extends object, R>(handler: ((params: P, context: AcpHostContext) => Promise<R>) | undefined) {
        return ({ params, signal }: ClientRequestContext<P>): Promise<R> => {
          const sessionId = 'sessionId' in params ? params.sessionId : undefined
          const owner = typeof sessionId === 'string' ? owners.get(sessionId) : undefined
          if (!handler || !owner || owner.lost || state !== 'running')
            throw new RequestError(-32602, 'Callback requires an owned session and handler')
          const lifetime = AbortSignal.any([signal, stopping.signal])
          return untilAborted(() => handler(params, { thread: owner.thread, signal: lifetime }), lifetime)
        }
      }
      if (callbacks.readTextFile) app.onRequest(methods.client.fs.readTextFile, host(callbacks.readTextFile))
      if (callbacks.writeTextFile) app.onRequest(methods.client.fs.writeTextFile, host(callbacks.writeTextFile))
      if (callbacks.terminal) {
        app.onRequest(methods.client.terminal.create, host(callbacks.terminal.create))
        app.onRequest(methods.client.terminal.output, host(callbacks.terminal.output))
        app.onRequest(methods.client.terminal.release, host(callbacks.terminal.release))
        app.onRequest(methods.client.terminal.waitForExit, host(callbacks.terminal.waitForExit))
        app.onRequest(methods.client.terminal.kill, host(callbacks.terminal.kill))
      }
      if (callbacks.elicitation)
        app.onRequest(methods.client.elicitation.create, (context) => {
          if (context.params.mode !== 'form')
            throw new RequestError(-32602, 'Only session-scoped form elicitation is supported')
          return host(callbacks.elicitation)(context)
        })
      connection = app.connect(lease.stream)
      connection.signal.addEventListener(
        'abort',
        () => {
          for (const owner of owners.values()) void enqueue(owner, () => lose(owner, 'source-lost'))
        },
        { once: true }
      )
      const response = await connection.agent.request(methods.agent.initialize, {
        protocolVersion: 1,
        clientInfo: { name: 'cherry-acp-v1', version: '0.0.0' },
        clientCapabilities: {
          fs: { readTextFile: !!callbacks.readTextFile, writeTextFile: !!callbacks.writeTextFile },
          terminal: !!callbacks.terminal,
          ...(callbacks.elicitation && { elicitation: { form: {} } })
        }
      })
      if (response.protocolVersion !== 1)
        throw new Error(`Unsupported ACP protocol version: ${response.protocolVersion}`)
      initialized = response
      return response
    })()
    return starting
  }

  async function operation<T>(name: string, work: () => Promise<T>): Promise<OperationResult<T>> {
    if (state !== 'running') return unavailable(name, 'runtime-closed', 'rejected')
    try {
      return { status: 'confirmed', value: await work() }
    } catch (error) {
      return {
        status: connection?.signal.aborted ? 'unknown' : 'rejected',
        error: failure(name, 'request-failed', error)
      }
    }
  }

  function newOwner(sessionId: string): Owner {
    const thread = { backendId: options.backendId, id: runtimeId<'thread'>(sessionId) }
    const owner: Owner = {
      thread,
      projection: new Projection(sessionId, report),
      inputs: new Set(),
      observations: new Set(),
      work: Promise.resolve(),
      lost: false
    }
    owners.set(sessionId, owner)
    return owner
  }

  function validateConfiguration(config: NewSessionRequest): void {
    if (
      config.additionalDirectories?.length &&
      !initialized?.agentCapabilities?.sessionCapabilities?.additionalDirectories
    )
      throw new Error('Agent does not support additional directories')
    for (const server of config.mcpServers) {
      if ('type' in server && server.type === 'http' && !initialized?.agentCapabilities?.mcpCapabilities?.http)
        throw new Error('Agent does not support HTTP MCP')
      if ('type' in server && server.type === 'sse' && !initialized?.agentCapabilities?.mcpCapabilities?.sse)
        throw new Error('Agent does not support SSE MCP')
    }
  }

  async function submit(owner: Owner, input: AcpInputDraft): Promise<SubmitResult> {
    const reject = (code: string, status: 'rejected' | 'unsupported' = 'rejected'): SubmitResult => ({
      status,
      inputId: input.inputId,
      error: failure('submit', code, code)
    })
    if (input.whenBusy !== 'reject') return reject('unsupported-busy-policy', 'unsupported')
    if (state !== 'running' || !connection || owner.lost || connection.signal.aborted)
      return reject('source-unavailable')
    if (owner.inputs.has(input.inputId)) return reject('duplicate-input')
    if (owner.active) return reject('busy')
    const capabilities = initialized?.agentCapabilities?.promptCapabilities
    if (
      input.content.some(
        (part) =>
          (part.type === 'image' && !capabilities?.image) ||
          (part.type === 'audio' && !capabilities?.audio) ||
          ((part.type === 'resource' || part.type === 'resource_link') && !capabilities?.embeddedContext)
      )
    )
      return reject('unsupported-prompt-content', 'unsupported')
    let settle!: (result: OperationResult<void>) => void
    const prompt: Prompt = {
      input: { inputId: input.inputId, facts: ['dispatch-started'] },
      permissions: new AbortController(),
      done: new Promise((resolve) => {
        settle = resolve
      }),
      settle: (result) => settle(result)
    }
    owner.active = prompt
    owner.inputs.add(input.inputId)
    owner.projection.boundary()
    owner.projection.publish({ type: 'input.changed', input: prompt.input })
    owner.projection.publish({ type: 'activity.changed', activity: { state: 'active' } })
    const request = connection.agent.request(methods.agent.session.prompt, {
      sessionId: owner.thread.id,
      prompt: [...input.content]
    })
    void request.then(
      (response) =>
        enqueue(owner, async () => {
          if (owner.lost) return
          const reason = stopReason.parse(response.stopReason)
          const outcome = reason === 'end_turn' ? 'completed' : reason === 'cancelled' ? 'aborted' : 'unanswered'
          owner.projection.rememberPrompt(input.inputId, response)
          await owner.projection.finish('complete')
          owner.projection.publish({ type: 'input.changed', input: { ...prompt.input, outcome } })
          owner.projection.publish({ type: 'activity.changed', activity: { state: 'idle' } })
          prompt.permissions.abort()
          owner.active = undefined
          prompt.settle({ status: 'confirmed', value: undefined })
        }),
      (error: unknown) =>
        enqueue(owner, async () => {
          if (connection?.signal.aborted || !(error instanceof RequestError)) {
            lose(owner, 'source-lost')
            return
          }
          await owner.projection.finish('unknown')
          owner.projection.publish({
            type: 'input.changed',
            input: { ...prompt.input, outcome: 'failed', error: failure('prompt', 'remote-error', error) }
          })
          owner.projection.publish({ type: 'activity.changed', activity: { state: 'unknown' } })
          prompt.permissions.abort()
          owner.active = undefined
          prompt.settle({ status: 'rejected', error: failure('prompt', 'remote-error', error) })
        })
    )
    return { status: 'acknowledged', inputId: input.inputId, facts: ['dispatch-started'] }
  }

  async function interrupt(owner: Owner): Promise<OperationResult<void>> {
    const prompt = owner.active
    if (!prompt) return owner.lost ? unavailable('interrupt', 'source-lost') : { status: 'confirmed', value: undefined }
    prompt.permissions.abort()
    try {
      await deadline(connection!.agent.notify(methods.agent.session.cancel, { sessionId: owner.thread.id }))
      return await deadline(prompt.done)
    } catch (error) {
      return { status: 'unknown', error: failure('interrupt', 'unconfirmed-cancellation', error) }
    }
  }

  function access(owner: Owner): AcpThreadHandle {
    let released = false
    const observations = new Set<Observation>()
    const available = () => !released && state === 'running'
    const projection = owner.projection
    function observe(create: () => Observation): Promise<OperationResult<Observation>> {
      if (!available()) return Promise.resolve(unavailable('observe', 'access-closed', 'rejected'))
      const raw = create()
      const observation: Observation = {
        drain: () => raw.drain(),
        stop: async () => {
          await raw.stop()
          observations.delete(observation)
          owner.observations.delete(observation)
        }
      }
      observations.add(observation)
      owner.observations.add(observation)
      return Promise.resolve({ status: 'confirmed', value: observation })
    }
    const send = (input: AcpInputDraft) =>
      available()
        ? submit(owner, input)
        : Promise.resolve<SubmitResult>({
            status: 'rejected',
            inputId: input.inputId,
            error: failure('submit', 'access-closed', 'Access is closed')
          })
    return {
      thread: owner.thread,
      input: { submit: (input) => send({ ...input, content: [{ type: 'text', text: input.text }] }) },
      contextUsage: async () =>
        available() ? owner.projection.contextUsage() : unavailable('contextUsage', 'access-closed', 'rejected'),
      observe: (sink) => observe(() => projection.feed.observe(sink)),
      interrupt: () =>
        available() ? interrupt(owner) : Promise.resolve(unavailable('interrupt', 'access-closed', 'rejected')),
      release: async () => {
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
      },
      acp: {
        state: () => owner.projection.state(),
        submit: send,
        observe: (sink) =>
          observe(() =>
            projection.feed.observeCaptured(sink, (event, delivery) => {
              const update = event.type === 'gap' || event.type === 'closed' ? undefined : projection.publishing
              return {
                value: {
                  revision: projection.revision,
                  event,
                  ...(update && { update }),
                  ...((delivery !== 'update' || event.type === 'input.changed' || event.type === 'snapshot') && {
                    state: projection.state()
                  })
                },
                retain: !!update
              }
            })
          ),
        setMode: async (modeId) => {
          if (!available()) return unavailable('setMode', 'access-closed', 'rejected')
          if (!owner.projection.state().configuration.modes?.availableModes.some((mode) => mode.id === modeId))
            return unavailable('setMode', 'unsupported-mode', 'unsupported')
          return operation('setMode', async () => {
            await connection!.agent.request(methods.agent.session.setMode, { sessionId: owner.thread.id, modeId })
            await enqueue(owner, () => {
              const modes = projection.state().configuration.modes
              if (modes) projection.configure({ modes: { ...modes, currentModeId: modeId } })
            })
          })
        },
        setConfigOption: async (configId, value) => {
          if (!available()) return unavailable('setConfigOption', 'access-closed', 'rejected')
          const config = owner.projection.state().configuration.configOptions?.find((item) => item.id === configId)
          if (!config) return unavailable('setConfigOption', 'unsupported-config', 'unsupported')
          if (
            config.type === 'boolean'
              ? typeof value !== 'boolean'
              : typeof value !== 'string' ||
                !config.options
                  .flatMap((option) => ('options' in option ? option.options : [option]))
                  .some((option) => option.value === value)
          )
            return unavailable('setConfigOption', 'invalid-config-value', 'rejected')
          return operation('setConfigOption', async () => {
            const response = await connection!.agent.request(methods.agent.session.setConfigOption, {
              sessionId: owner.thread.id,
              configId,
              ...(typeof value === 'boolean' ? { type: 'boolean', value } : { value })
            })
            await enqueue(owner, () => owner.projection.configure({ configOptions: response.configOptions }))
          })
        }
      }
    }
  }

  return {
    initialize: () => operation('initialize', async () => structuredClone(await start())),
    authenticate: async (methodId) => {
      const ready = await operation('authenticate', start)
      if (ready.status !== 'confirmed') return ready
      if (!ready.value.authMethods?.some((method) => method.id === methodId))
        return unavailable('authenticate', 'unsupported-authentication', 'unsupported')
      return operation('authenticate', async () => {
        await connection!.agent.request(methods.agent.authenticate, { methodId })
      })
    },
    create: async (config) => {
      const work = creating.then(() =>
        operation('create', async () => {
          await start()
          validateConfiguration(config)
          provisional = { updates: [], bytes: 0, overflow: false }
          try {
            const response = await connection!.agent.request(methods.agent.session.new, config)
            if (provisional.overflow) throw new Error('ACP setup update buffer overflow')
            const sessionId = z.string().min(1).parse(response.sessionId)
            if (owners.has(sessionId)) throw new Error('Agent returned an already owned session')
            const owner = newOwner(sessionId)
            owner.projection.configure(response)
            for (const update of provisional.updates) {
              if (update.sessionId === sessionId) void enqueue(owner, () => owner.projection.update(update.update))
              else report(new Error(`Setup update belongs to a different session: ${update.sessionId}`))
            }
            await owner.work
            if (owner.lost) throw new Error('Session projection failed')
            return access(owner)
          } finally {
            provisional = undefined
          }
        })
      )
      creating = work.then(() => {})
      return work
    },
    open: async (thread) => {
      if (thread.backendId !== options.backendId) return unavailable('open', 'backend-mismatch', 'rejected')
      if (state !== 'running') return unavailable('open', 'runtime-closed', 'rejected')
      let pending = opening.get(thread.id)
      if (!pending) {
        const live = owners.get(thread.id)
        if (live) return { status: 'confirmed', value: access(live) }
        pending = (async (): Promise<OperationResult<Owner>> => {
          const ready = await operation('open', start)
          if (ready.status !== 'confirmed') return ready
          if (!ready.value.agentCapabilities?.loadSession || !options.loadConfiguration)
            return unavailable('open', 'native-load-unavailable', 'unsupported')
          return operation('open', async () => {
            const config = await options.loadConfiguration!(thread)
            if (state !== 'running') throw new Error('Runtime is shutting down')
            validateConfiguration(config)
            const owner = newOwner(thread.id)
            owner.setup = { count: 0, bytes: 0, overflow: false }
            owner.projection.publish({ type: 'gap', reason: 'mapping-reset' })
            try {
              const response = await connection!.agent.request(methods.agent.session.load, {
                ...config,
                sessionId: thread.id
              })
              if (owner.setup.overflow) throw new Error('ACP setup update buffer overflow')
              owner.setup = undefined
              await owner.work
              if (owner.lost) throw new Error('Session projection failed')
              owner.projection.configure(response ?? {})
              await owner.projection.finish('complete')
              return owner
            } catch (error) {
              owners.delete(thread.id)
              await owner.work
              await owner.projection.close()
              throw error
            }
          })
        })()
        opening.set(thread.id, pending)
      }
      try {
        const result = await pending
        return result.status === 'confirmed' ? { status: 'confirmed', value: access(result.value) } : result
      } finally {
        if (opening.get(thread.id) === pending) opening.delete(thread.id)
      }
    },
    shutdown: () => {
      if (state === 'stopped') return Promise.resolve({ status: 'confirmed', value: undefined })
      if (shutdownAttempt) return shutdownAttempt
      state = 'stopping'
      stopping.abort()
      shutdownAttempt = (async (): Promise<OperationResult<void>> => {
        try {
          if (starting && !lease) await deadline(starting.catch(report))
          if (connection && !connection.signal.aborted) {
            await deadline(
              Promise.all(
                [...owners.values()].map(async (owner) => {
                  owner.active?.permissions.abort()
                  if (owner.active)
                    await connection!.agent.notify(methods.agent.session.cancel, { sessionId: owner.thread.id })
                  if (initialized?.agentCapabilities?.sessionCapabilities?.close)
                    await connection!.agent.request(methods.agent.session.close, { sessionId: owner.thread.id })
                })
              )
            ).catch(report)
            connection.close()
          }
          if (lease) await deadline(lease.closeAndJoin())
          if (starting) await deadline(starting.catch(report))
          await deadline(Promise.all([creating, ...opening.values()]))
          for (const owner of owners.values()) {
            await owner.work
            await owner.projection.close()
            owner.projection.feed.close('shutdown')
          }
          await deadline(
            Promise.all(
              [...owners.values()].flatMap((owner) => [...owner.observations].map((observation) => observation.drain()))
            )
          )
          state = 'stopped'
          return { status: 'confirmed', value: undefined }
        } catch (error) {
          return { status: 'unknown', error: failure('shutdown', 'unconfirmed-termination', error) }
        } finally {
          shutdownAttempt = undefined
        }
      })()
      return shutdownAttempt
    }
  }
}
