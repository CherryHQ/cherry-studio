import {
  RequestError,
  type InitializeResponse,
  type NewSessionRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason
} from '@agentclientprotocol/sdk'

import {
  runtimeId,
  type InputState,
  type Observation,
  type OperationResult,
  type SubmitResult,
  type Thread
} from '@cherrystudio/agent-runtime'

import { connectAcpClient, type AcpAgent, type AcpClient, type AcpClientOptions, type AcpSession } from './client'
import { AcpControlError, AcpSessionControls } from './configuration'
import { acpSetupUpdate, bindDesktopUpdates, type AcpDesktopEvents } from './desktopUpdates'
import type { AcpNativeTurn } from './harness'
import { Projection } from './projection'
import { deadline, failure, unavailable, untilAborted } from './result'
import type {
  AcpHostContext,
  AcpInputDraft,
  AcpPromptOutcome,
  AcpRuntime,
  AcpRuntimeOptions,
  AcpSessionConfiguration,
  AcpThreadHandle,
  AcpTransportLease
} from './types'

interface Prompt {
  readonly input: InputState
  readonly permissions: AbortController
  readonly done: Promise<OperationResult<void>>
  settle(result: OperationResult<void>): void
}
type Frame = SessionNotification | AcpNativeTurn
interface Setup {
  frames: Frame[]
  bytes: number
  overflow: boolean
  nativeTurn?: string
}

interface Owner {
  readonly thread: Thread
  readonly projection?: Projection
  readonly controls: AcpSessionControls
  readonly inputs?: Set<string>
  readonly observations: Set<Observation>
  work: Promise<void>
  session?: AcpSession
  desktop?: ReturnType<typeof bindDesktopUpdates>
  active?: Prompt
  lost: boolean
  setup?: Setup
}

export type DesktopOptions = Pick<AcpClientOptions, 'clientInfo' | 'callbacks' | 'harness' | 'denyMutation'> & {
  events: AcpDesktopEvents
}

type Configure = (handle: AcpThreadHandle<true>) => Promise<void>

const stopOutcomes = {
  end_turn: 'completed',
  cancelled: 'aborted',
  max_tokens: 'unanswered',
  max_turn_requests: 'unanswered',
  refusal: 'unanswered'
} satisfies Record<StopReason, NonNullable<InputState['outcome']>>

export function createAcpRuntime(options: AcpRuntimeOptions): AcpRuntime {
  return buildAcpRuntime(options).replay
}

export function buildAcpRuntime(options: AcpRuntimeOptions, desktop?: DesktopOptions) {
  let lease: AcpTransportLease | undefined
  let connection: AcpClient | undefined
  let capabilities: InitializeResponse['agentCapabilities']
  let starting: Promise<AcpAgent> | undefined
  let state: 'running' | 'stopping' | 'stopped' = 'running'
  let shutdownAttempt: Promise<OperationResult<void>> | undefined
  let creating = Promise.resolve()
  let provisional: Setup | undefined
  const stopping = new AbortController()
  const transport = new AbortController()
  function disconnect(reason?: Error) {
    transport.abort(reason)
    connection?.close(reason)
  }
  const owners = new Map<string, Owner>()
  const opening = new Map<string, Promise<{ owner: Owner; handle?: AcpThreadHandle<true> }>>()
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
    owner.desktop?.close()
    owner.active?.permissions.abort()
    if (owner.active) {
      owner.projection?.publish({
        type: 'input.changed',
        input: { ...owner.active.input, error: failure('prompt', code, code) }
      })
      owner.active.settle(unavailable('prompt', code))
    }
    owner.projection?.publish({ type: 'gap', reason: 'disconnected' })
    owner.projection?.publish({ type: 'activity.changed', activity: { state: 'unknown' } })
  }

  function deliver(owner: Owner, frame: Frame) {
    if (owner.lost) return
    const desktopUpdates = owner.desktop
    if (desktopUpdates) {
      // Desktop consumers take incremental facts synchronously in wire order.
      try {
        if ('update' in frame) desktopUpdates.receive(frame.update)
        else desktopUpdates.acceptNativeTurn(frame)
      } catch (error) {
        report(error)
        disconnect(error instanceof Error ? error : new Error('ACP update failed'))
      }
      return
    }
    if (!('update' in frame)) return
    void enqueue(owner, () => {
      if (owner.lost) return
      const { update } = frame
      if (update.sessionUpdate === 'config_option_update') owner.controls.acceptOptions(update.configOptions)
      if (update.sessionUpdate === 'current_mode_update') owner.controls.acceptMode(update.currentModeId)
      return owner.projection?.update(update)
    })
  }

  function route(frame: Frame) {
    const owner = owners.get(frame.sessionId)
    const setup = owner ? owner.setup : provisional
    if (!setup) {
      if (owner) deliver(owner, frame)
      else report(new Error(`Update for unowned ACP session: ${frame.sessionId}`))
      return
    }
    if (desktop) {
      if ('update' in frame) {
        if (setup.nativeTurn !== frame.sessionId && !acpSetupUpdate(frame.update, owner ? undefined : desktop.harness))
          return
      } else if (frame.state === 'started') setup.nativeTurn = frame.sessionId
      else if (setup.nativeTurn === frame.sessionId) setup.nativeTurn = undefined
    }
    setup.bytes += Buffer.byteLength(JSON.stringify(frame), 'utf8')
    if (setup.frames.length >= 256 || setup.bytes > 8 * 1024 * 1024) setup.overflow = true
    else if (!setup.overflow) setup.frames.push(frame)
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

  async function start(): Promise<AcpAgent> {
    if (state !== 'running') throw new Error('Runtime is shutting down')
    if (starting) return starting
    starting = (async () => {
      lease = await options.connect()
      if (state !== 'running') throw new Error('Runtime is shutting down')
      transport.signal.throwIfAborted()
      function host<P extends object, R>(handler: (params: P, context: AcpHostContext) => Promise<R>) {
        return (params: P, { signal }: { signal: AbortSignal }): Promise<R> => {
          const sessionId = 'sessionId' in params ? params.sessionId : undefined
          if (typeof sessionId !== 'string') throw RequestError.invalidParams(undefined, 'Callback requires a session')
          const owner = owners.get(sessionId)
          if (!owner || owner.lost) throw RequestError.sessionNotFound(sessionId)
          if (state !== 'running') throw RequestError.invalidParams(undefined, 'Runtime is shutting down')
          const lifetime = AbortSignal.any([signal, stopping.signal])
          return untilAborted(() => handler(params, { thread: owner.thread, signal: lifetime }), lifetime)
        }
      }
      const elicitation = callbacks.elicitation && host(callbacks.elicitation)
      connection = connectAcpClient(lease.stream, {
        clientInfo: desktop?.clientInfo ?? { name: 'cherry-acp-v1', version: '0.0.0' },
        update: route,
        nativeTurn: desktop && route,
        harness: desktop?.harness,
        denyMutation:
          desktop?.denyMutation ??
          (desktop?.harness?.hostMutations === 'disabled'
            ? () => RequestError.invalidParams(undefined, 'Host writes and terminals are disabled')
            : undefined),
        sessionCapabilities: desktop ? { configOptions: { boolean: {} }, notices: {}, compaction: {} } : undefined,
        callbacks: desktop?.callbacks ?? {
          permission: (params, { signal }) => permission(params, signal),
          readTextFile: callbacks.readTextFile && host(callbacks.readTextFile),
          writeTextFile: callbacks.writeTextFile && host(callbacks.writeTextFile),
          terminal: callbacks.terminal && {
            create: host(callbacks.terminal.create),
            output: host(callbacks.terminal.output),
            release: host(callbacks.terminal.release),
            waitForExit: host(callbacks.terminal.waitForExit),
            kill: host(callbacks.terminal.kill)
          },
          elicitation:
            elicitation &&
            ((params, context) => {
              if (params.mode !== 'form')
                throw RequestError.invalidParams(undefined, 'Only session-scoped form elicitation is supported')
              return elicitation(params, context)
            })
        }
      })
      connection.signal.addEventListener(
        'abort',
        () => {
          transport.abort(connection?.signal.reason)
          for (const owner of owners.values()) void enqueue(owner, () => lose(owner, 'source-lost'))
        },
        { once: true }
      )
      const agent = await connection.initialize()
      capabilities = agent.response.agentCapabilities
      return agent
    })()
    return starting
  }

  async function operation<T>(name: string, work: () => Promise<T>): Promise<OperationResult<T>> {
    if (state !== 'running') return unavailable(name, 'runtime-closed', 'rejected')
    try {
      return { status: 'confirmed', value: await work() }
    } catch (error) {
      return {
        status: connection?.signal.aborted ? 'unknown' : error instanceof AcpControlError ? error.status : 'rejected',
        error: failure(name, error instanceof AcpControlError ? error.code : 'request-failed', error)
      }
    }
  }

  function newOwner(sessionId: string): Owner {
    const thread = { backendId: options.backendId, id: runtimeId<'thread'>(sessionId) }
    const controls = new AcpSessionControls()
    const owner: Owner = {
      thread,
      controls,
      projection: desktop ? undefined : new Projection(sessionId, thread, controls, report),
      inputs: desktop ? undefined : new Set(),
      observations: new Set(),
      work: Promise.resolve(),
      lost: false
    }
    owners.set(sessionId, owner)
    return owner
  }

  function validateConfiguration(config: NewSessionRequest): void {
    if (config.additionalDirectories?.length && !capabilities?.sessionCapabilities?.additionalDirectories)
      throw new Error('Agent does not support additional directories')
    for (const server of config.mcpServers) {
      if ('type' in server && server.type === 'http' && !capabilities?.mcpCapabilities?.http)
        throw new Error('Agent does not support HTTP MCP')
      if ('type' in server && server.type === 'sse' && !capabilities?.mcpCapabilities?.sse)
        throw new Error('Agent does not support SSE MCP')
    }
  }

  function dispatch(
    owner: Owner,
    input: AcpInputDraft
  ):
    | { receipt: Extract<SubmitResult, { status: 'acknowledged' }>; completed: Promise<AcpPromptOutcome> }
    | { receipt: Exclude<SubmitResult, { status: 'acknowledged' }> } {
    const reject = (code: string, status: 'rejected' | 'unsupported' = 'rejected') => ({
      receipt: { status, inputId: input.inputId, error: failure('submit', code, code) }
    })
    const { session, projection } = owner
    if (state !== 'running' || !session || !connection || owner.lost || connection.signal.aborted)
      return reject('source-unavailable')
    if (owner.inputs?.has(input.inputId)) return reject('duplicate-input')
    if (owner.active || owner.controls.busy || owner.desktop?.busy) return reject('busy')
    const promptCapabilities = capabilities?.promptCapabilities
    if (
      input.content.some(
        (part) =>
          (part.type === 'image' && !promptCapabilities?.image) ||
          (part.type === 'audio' && !promptCapabilities?.audio) ||
          (part.type === 'resource' && !promptCapabilities?.embeddedContext)
      )
    )
      return reject('unsupported-prompt-content', 'unsupported')

    const result = Promise.withResolvers<OperationResult<void>>()
    const prompt: Prompt = {
      input: { inputId: input.inputId, facts: ['dispatch-started'] },
      permissions: new AbortController(),
      done: result.promise,
      settle: result.resolve
    }
    owner.active = prompt
    owner.inputs?.add(input.inputId)
    projection?.boundary()
    projection?.publish({ type: 'input.changed', input: prompt.input })
    projection?.publish({ type: 'activity.changed', activity: { state: 'active' } })
    function complete(outcome: OperationResult<void>) {
      owner.desktop?.finish()
      prompt.permissions.abort()
      owner.active = undefined
      prompt.settle(outcome)
    }
    const harness = owner.desktop?.harness
    const completed = session.prompt([...input.content], harness?.promptMeta).then(
      async ({ response, usage }) => {
        await enqueue(owner, async () => {
          if (owner.lost) return
          if (typeof response.stopReason !== 'string' || !Object.hasOwn(stopOutcomes, response.stopReason))
            throw new Error('Invalid ACP stop reason')
          projection?.rememberPrompt(input.inputId, response)
          await projection?.finish('complete')
          const outcome = stopOutcomes[response.stopReason]
          projection?.publish({ type: 'input.changed', input: { ...prompt.input, outcome } })
          projection?.publish({ type: 'activity.changed', activity: { state: 'idle' } })
          complete({ status: 'confirmed', value: undefined })
        })
        if (owner.lost) throw new Error('ACP connection closed')
        return {
          stopReason: response.stopReason,
          usage,
          context: harness?.contextAfterPrompt?.(response, input.inputId)
        }
      },
      async (error: unknown) => {
        await enqueue(owner, async () => {
          if (owner.lost || connection?.signal.aborted || !(error instanceof RequestError)) {
            lose(owner, 'source-lost')
            return
          }
          await projection?.finish('unknown')
          projection?.publish({
            type: 'input.changed',
            input: { ...prompt.input, outcome: 'failed', error: failure('prompt', 'remote-error', error) }
          })
          projection?.publish({ type: 'activity.changed', activity: { state: 'unknown' } })
          complete({ status: 'rejected', error: failure('prompt', 'remote-error', error) })
        })
        throw error
      }
    )
    return { receipt: { status: 'acknowledged', inputId: input.inputId, facts: ['dispatch-started'] }, completed }
  }

  async function interrupt(owner: Owner): Promise<OperationResult<void>> {
    const prompt = owner.active
    const nativeWork = owner.desktop?.work
    if (!prompt && !nativeWork)
      return owner.lost ? unavailable('interrupt', 'source-lost') : { status: 'confirmed', value: undefined }
    prompt?.permissions.abort()
    try {
      await deadline(owner.session!.cancel())
      if (prompt) return await deadline(prompt.done)
      if (nativeWork) await deadline(nativeWork)
      return owner.lost ? unavailable('interrupt', 'source-lost') : { status: 'confirmed', value: undefined }
    } catch (error) {
      return { status: 'unknown', error: failure('interrupt', 'unconfirmed-cancellation', error) }
    }
  }

  function access(owner: Owner) {
    const session = owner.session
    if (!session) throw new Error('ACP session setup is incomplete')
    let released = false
    const observations = new Set<Observation>()
    const available = () => !released && state === 'running' && !owner.lost
    const { controls, projection } = owner
    const commit = (change: () => boolean) =>
      enqueue(owner, () => {
        if (!owner.lost && change()) {
          projection?.publishConfiguration()
          owner.desktop?.publishOptions()
        }
      })
    async function runControl(name: string, work: () => Promise<void>): Promise<OperationResult<void>> {
      if (!available()) return unavailable(name, 'access-closed', 'rejected')
      if (owner.active || owner.desktop?.busy) return unavailable(name, 'busy', 'rejected')
      try {
        return await operation(name, work)
      } finally {
        owner.desktop?.drainNativeTurn()
      }
    }
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
    function startPrompt(input: AcpInputDraft) {
      return available()
        ? dispatch(owner, input)
        : {
            receipt: {
              status: 'rejected' as const,
              inputId: input.inputId,
              error: failure('submit', 'access-closed', 'Access is closed')
            }
          }
    }
    async function send(input: AcpInputDraft): Promise<SubmitResult> {
      const result = startPrompt(input)
      if ('completed' in result) void result.completed.catch(() => {})
      return result.receipt
    }
    const handle: Omit<AcpThreadHandle<boolean>, 'acp'> = {
      thread: owner.thread,
      input: { submit: (input) => send({ ...input, content: [{ type: 'text', text: input.text }] }) },
      contextUsage: async () =>
        available()
          ? (owner.desktop?.harness?.inspectContextUsage?.() ??
            projection?.contextUsage() ??
            unavailable('contextUsage', 'missing-native-context-or-model', 'unsupported'))
          : unavailable('contextUsage', 'access-closed', 'rejected'),
      observe: (sink) =>
        projection
          ? observe(() => projection.feed.observe(sink))
          : Promise.resolve(unavailable('observe', 'desktop-native-events', 'unsupported')),
      interrupt: () =>
        available() ? interrupt(owner) : Promise.resolve(unavailable('interrupt', 'access-closed', 'rejected')),
      release: async () => {
        released = true
        await Promise.all([...observations].map((observation) => observation.stop()))
      }
    }
    return {
      handle,
      observe,
      startPrompt,
      available,
      runControl,
      commit,
      acp: {
        submit: send,
        get model() {
          return controls.model
        },
        setMode: (modeId: string) => runControl('setMode', () => controls.setMode(session, modeId, commit)),
        setConfigOption: (configId: string, value: string | boolean) =>
          runControl('setConfigOption', () => controls.setOption(session, configId, value, commit)),
        selectModel: (modelId: string) =>
          runControl('selectModel', () => controls.selectModel(session, modelId, commit))
      }
    }
  }

  function archiveAccess(owner: Owner): AcpThreadHandle {
    const { handle, acp, observe } = access(owner)
    const projection = owner.projection!
    return {
      ...handle,
      acp: {
        get model() {
          return acp.model
        },
        submit: acp.submit,
        selectModel: acp.selectModel,
        setMode: acp.setMode,
        setConfigOption: acp.setConfigOption,
        state: () => projection.state(),
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
          )
      }
    }
  }

  function desktopAccess(owner: Owner, ownsObserver = false): AcpThreadHandle<true> {
    const { handle, acp, startPrompt, available, runControl, commit } = access(owner)
    const updates = owner.desktop!
    const compact = updates.compact
    return {
      ...handle,
      compact: compact && (async () => (available() ? compact() : unavailable('compact', 'access-closed', 'rejected'))),
      async release() {
        if (ownsObserver) updates.releaseObserver()
        await handle.release()
      },
      acp: {
        get model() {
          return acp.model
        },
        submit: acp.submit,
        selectModel: acp.selectModel,
        setMode: acp.setMode,
        setConfigOption: acp.setConfigOption,
        legacyEffort: updates.harness?.legacyEffort,
        predictPrompt: updates.harness?.predictPrompt,
        steer: updates.harness?.steer,
        get awaitingNativeTurn() {
          return updates.awaitingNativeTurn
        },
        drainNativeTurn: updates.drainNativeTurn,
        async runPrompt(draft) {
          const result = startPrompt(draft)
          if ('completed' in result) return result.completed
          throw new Error(result.receipt.error.message)
        },
        selectInitialModel: (selection) =>
          runControl('selectInitialModel', () =>
            owner.controls.selectModel(owner.session!, selection.model, commit, selection)
          )
      }
    }
  }

  async function bind(
    owner: Owner,
    { session, configuration }: { session: AcpSession; configuration: AcpSessionConfiguration },
    setup: Setup,
    configure?: Configure
  ) {
    owner.session = session
    if (setup.overflow) throw new Error('ACP setup update buffer overflow')
    connection?.signal.throwIfAborted()
    owner.setup = undefined
    owner.controls.initialize(configuration, session.legacyModels)
    owner.projection?.publishConfiguration()
    let handle: AcpThreadHandle<true> | undefined
    if (desktop) {
      owner.desktop = bindDesktopUpdates(session, owner.controls, desktop.events, () => !!owner.active)
      handle = desktopAccess(owner, true)
      desktop.events.opened(handle, { ...configuration, configOptions: owner.controls.extraOptions })
    }
    for (const frame of setup.frames) {
      if (frame.sessionId === session.id) deliver(owner, frame)
      else report(new Error(`Setup update belongs to a different session: ${frame.sessionId}`))
    }
    setup.frames.length = 0
    await owner.work
    if (owner.lost) throw new Error('ACP connection closed')
    if (handle) await configure?.(handle)
    connection?.signal.throwIfAborted()
    owner.desktop?.ready()
    return handle
  }

  function create(config: NewSessionRequest, configure?: Configure) {
    const work = creating.then(async () => {
      const agent = await start()
      validateConfiguration(config)
      const setup: Setup = { frames: [], bytes: 0, overflow: false }
      provisional = setup
      try {
        const opened = await agent.create(config)
        if (owners.has(opened.session.id)) throw new Error('Agent returned an already owned session')
        const owner = newOwner(opened.session.id)
        try {
          return { owner, handle: await bind(owner, opened, setup, configure) }
        } catch (error) {
          await discard(owner)
          throw error
        }
      } finally {
        provisional = undefined
      }
    })
    creating = work.then(
      () => {},
      () => {}
    )
    return work
  }

  async function discard(owner: Owner) {
    owners.delete(owner.thread.id)
    owner.lost = true
    owner.desktop?.close()
    await owner.work
    await owner.projection?.close()
    if (owner.session?.close && !connection?.signal.aborted) {
      await deadline(owner.session.close()).catch(report)
    }
  }

  function restoreMethod(agent: AcpAgent) {
    if (!desktop) return agent.load
    return desktop.harness?.preferredRestore === 'load' ? (agent.load ?? agent.resume) : (agent.resume ?? agent.load)
  }

  async function open(thread: Thread, config?: NewSessionRequest, configure?: Configure) {
    if (thread.backendId !== options.backendId)
      throw new AcpControlError('rejected', 'backend-mismatch', 'Invalid backend')
    if (state !== 'running') throw new AcpControlError('rejected', 'runtime-closed', 'Runtime is shutting down')
    let pending = opening.get(thread.id)
    if (!pending) {
      const live = owners.get(thread.id)
      if (live) return { owner: live, handle: live.desktop ? desktopAccess(live) : undefined }
      pending = (async () => {
        const agent = await start()
        const restore = restoreMethod(agent)
        const params = config ?? (await options.loadConfiguration?.(thread))
        if (!restore || !params)
          throw new AcpControlError('unsupported', 'native-load-unavailable', 'ACP session restoration is unavailable')
        if (state !== 'running') throw new Error('Runtime is shutting down')
        validateConfiguration(params)
        const owner = newOwner(thread.id)
        const setup: Setup = { frames: [], bytes: 0, overflow: false }
        owner.setup = setup
        owner.projection?.publish({ type: 'gap', reason: 'mapping-reset' })
        try {
          const handle = await bind(owner, await restore({ ...params, sessionId: thread.id }), setup, configure)
          await owner.projection?.finish('complete')
          return { owner, handle }
        } catch (error) {
          await discard(owner)
          throw error
        }
      })()
      opening.set(thread.id, pending)
    }
    try {
      return await pending
    } finally {
      if (opening.get(thread.id) === pending) opening.delete(thread.id)
    }
  }

  const replay: AcpRuntime = {
    // oxlint-disable-next-line no-restricted-globals -- Detach handshake metadata from the protocol connection.
    initialize: () => operation('initialize', async () => structuredClone((await start()).response)),
    authenticate: async (methodId) => {
      const ready = await operation('authenticate', start)
      if (ready.status !== 'confirmed') return ready
      if (!ready.value.response.authMethods?.some((method) => method.id === methodId))
        return unavailable('authenticate', 'unsupported-authentication', 'unsupported')
      return operation('authenticate', async () => {
        await ready.value.authenticate(methodId)
      })
    },
    create: (config) => operation('create', async () => archiveAccess((await create(config)).owner)),
    open: (thread) => operation('open', async () => archiveAccess((await open(thread)).owner)),
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
                  if (!owner.session) await opening.get(owner.thread.id)?.catch(report)
                  if (owner.active || owner.desktop?.work) await interrupt(owner)
                  await owner.session?.close?.()
                })
              )
            ).catch(report)
            disconnect()
          }
          if (lease) await deadline(lease.closeAndJoin())
          if (starting) await deadline(starting.catch(report))
          await deadline(Promise.allSettled([creating, ...opening.values()]))
          for (const owner of owners.values()) {
            await owner.work
            await owner.projection?.close()
            owner.projection?.feed.close('shutdown')
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
  return {
    replay,
    signal: transport.signal,
    disconnect,
    async initializeDesktop() {
      const agent = await start()
      return {
        response: agent.response,
        create: async (config: NewSessionRequest, configure: Configure) => (await create(config, configure)).handle!,
        restore: restoreMethod(agent)
          ? async ({ sessionId, ...config }: NewSessionRequest & { sessionId: string }, configure: Configure) =>
              (await open({ backendId: options.backendId, id: runtimeId(sessionId) }, config, configure)).handle!
          : undefined
      }
    }
  }
}
