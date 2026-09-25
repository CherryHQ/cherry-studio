import { createHash, randomUUID } from 'node:crypto'
import type { ServerResponse } from 'node:http'

export const UAR_TOOL_ADMISSION_VERSION = 1
export const UAR_TOOL_ADMISSION_PATH = '/uar/admission/v1'
export const UAR_TOOL_ADMISSION_META_KEY = 'tools.know-me.the-boss/admission'

export type UarHostToolDisposition = 'auto' | 'ask' | 'deny'

type PreparedInvocation = {
  version: number
  invocationId: string
  modelToolCallId: string
  attempt: number
  rootRunId: string
  executingRunId: string
  ownerId: string
  workspace: string
  runtimeEpoch: string
  hostEpoch: string
  catalogRevision: string
  mountedServerId: string
  nativeToolName: string
  providerToolName: string
  runPolicyRevision: string
  toolPolicyRevision: string
  callIndex: number
  validatedArguments: Record<string, unknown>
}

export type UarHostAdmissionState =
  | 'prepared'
  | 'awaiting-human'
  | 'awaiting-ack'
  | 'authorized'
  | 'claimed'
  | 'succeeded'
  | 'failed'
  | 'denied'
  | 'cancelled'
  | 'invalidated'
  | 'interrupted'
  | 'outcome-unknown'

export type UarHostAdmissionSnapshot = {
  admissionId: string
  invocationId: string
  rootRunId: string
  executingRunId: string
  sessionId: string
  ownerId: string
  workspace: string
  hostEpoch: string
  toolName: string
  state: UarHostAdmissionState
  hostDisposition: UarHostToolDisposition
  actionDisplay: Record<string, unknown>
  updatedAt: number
}

type AdmissionRecord = {
  admissionId: string
  invocation: PreparedInvocation
  argumentDigest: string
  hostDisposition: UarHostToolDisposition
  state: UarHostAdmissionState
  decision?: boolean
  actionDisplay: Record<string, unknown>
  updatedAt: number
}

type JsonRpcCall = { id: unknown }
type ClaimResult = { call?: JsonRpcCall; admissionId?: string; error?: string }

export interface UarHostToolAdmissionOptions {
  sessionId?: string
  ownerId: string
  workspace: string
  disposition(toolName: string): UarHostToolDisposition
  persistLifecycle?(snapshot: UarHostAdmissionSnapshot): void
  onLifecycle?(snapshot: UarHostAdmissionSnapshot): void
}

export class UarHostToolAdmission {
  readonly hostEpoch = randomUUID()
  private readonly records = new Map<string, AdmissionRecord>()
  private readonly invocationIndex = new Map<string, string>()
  private runtimeEpoch?: string
  private rootRunId?: string

  constructor(private readonly options: UarHostToolAdmissionOptions) {}

  handleHttp(method: string | undefined, path: string, body: unknown, response: ServerResponse): boolean {
    if (!path.startsWith(`${UAR_TOOL_ADMISSION_PATH}/`)) return false
    const operation = path.slice(UAR_TOOL_ADMISSION_PATH.length + 1)
    if (method === 'POST' && operation === 'prepare') return this.prepare(body, response)
    if (method === 'POST' && operation === 'resolve') return this.resolve(body, response)
    if (method === 'POST' && operation === 'cancel') return this.cancel(body, response)
    if (method === 'POST' && operation === 'finish') return this.finish(body, response)
    if (method === 'POST' && operation === 'inspect') return this.inspect(body, response)
    this.respond(response, 404, { error: 'Unknown tool admission operation' })
    return true
  }

  claimToolCall(body: unknown, serverName: string): ClaimResult {
    if (Array.isArray(body)) return { call: { id: null }, error: 'Batch tools/call is not supported by the managed host' }
    if (!isRecord(body) || body.method !== 'tools/call' || !isRecord(body.params)) return {}
    const call = { id: body.id ?? null }
    const name = body.params.name
    const args = body.params.arguments
    const meta = isRecord(body.params._meta) ? body.params._meta[UAR_TOOL_ADMISSION_META_KEY] : undefined
    if (typeof name !== 'string' || !isRecord(args) || !isRecord(meta)) {
      return { call, error: 'Managed tool call is missing exact admission identity' }
    }
    const admissionId = meta.admissionId
    const invocationId = meta.invocationId
    const record = typeof admissionId === 'string' ? this.records.get(admissionId) : undefined
    if (!record || typeof invocationId !== 'string') return { call, error: 'Managed tool admission is unknown' }
    const invocation = record.invocation
    const providerName = sanitizeToolName(`${serverName}__${name}`)
    const matches =
      meta.version === UAR_TOOL_ADMISSION_VERSION &&
      meta.runtimeEpoch === invocation.runtimeEpoch &&
      meta.hostEpoch === this.hostEpoch &&
      invocationId === invocation.invocationId &&
      invocation.mountedServerId === serverName &&
      invocation.nativeToolName === name &&
      invocation.providerToolName === providerName &&
      record.argumentDigest === argumentDigest(args)
    if (!matches) {
      this.transition(record, 'invalidated')
      return { call, error: 'Managed tool call does not match its prepared admission' }
    }
    const currentDisposition = this.options.disposition(providerName)
    if (currentDisposition === 'deny' || (currentDisposition === 'ask' && record.decision !== true)) {
      this.transition(record, 'invalidated')
      return { call, error: 'Managed tool policy changed before dispatch' }
    }
    if (record.state !== 'authorized') return { call, error: 'Managed tool admission is not executable' }
    try {
      this.transition(record, 'claimed')
    } catch {
      return { call, error: 'Managed tool claim evidence could not be persisted; dispatch was blocked' }
    }
    return { call, admissionId: record.admissionId }
  }

  recordHumanDecision(admissionId: string, approved: boolean): boolean {
    const record = this.records.get(admissionId)
    if (!record) return false
    if (record.decision !== undefined) return record.decision === approved
    if (!['prepared', 'awaiting-human'].includes(record.state)) return false
    this.transition(record, approved ? 'awaiting-ack' : 'denied')
    record.decision = approved
    return true
  }

  cancelAdmission(
    admissionId: string,
    invocationId: string | undefined,
    reason: 'cancelled' | 'invalidated' = 'cancelled'
  ): UarHostAdmissionState | undefined {
    const record = this.records.get(admissionId)
    if (!record || (invocationId && record.invocation.invocationId !== invocationId)) return undefined
    if (
      ![
        'claimed',
        'succeeded',
        'failed',
        'denied',
        'cancelled',
        'invalidated',
        'interrupted',
        'outcome-unknown'
      ].includes(record.state)
    ) {
      this.transition(record, reason)
    }
    return record.state
  }

  invalidateForTeardown(onError: (error: unknown) => void = () => undefined): void {
    for (const record of this.records.values()) {
      try {
        if (record.state === 'claimed') this.transition(record, 'outcome-unknown')
        else if (!['succeeded', 'failed', 'denied', 'cancelled', 'invalidated'].includes(record.state)) {
          this.transition(record, 'interrupted')
        }
      } catch (error) {
        onError(error)
      }
    }
  }

  snapshots(ownerId = this.options.ownerId): UarHostAdmissionSnapshot[] {
    if (ownerId !== this.options.ownerId) return []
    return [...this.records.values()].map((record) => this.snapshot(record))
  }

  private prepare(body: unknown, response: ServerResponse): true {
    const invocation = isRecord(body) && isPreparedInvocation(body.invocation) ? body.invocation : undefined
    if (!invocation) {
      this.respond(response, 422, { error: 'Invalid prepared tool invocation' })
      return true
    }
    if (!this.binds(invocation)) {
      this.respond(response, 409, { error: 'Prepared tool invocation belongs to another host binding' })
      return true
    }
    if (this.invocationIndex.has(invocation.invocationId)) {
      this.respond(response, 409, { error: 'Prepared tool invocation already exists' })
      return true
    }
    const hostDisposition = this.options.disposition(invocation.providerToolName)
    const admissionId = randomUUID()
    const record: AdmissionRecord = {
      admissionId,
      invocation: structuredClone(invocation),
      argumentDigest: argumentDigest(invocation.validatedArguments),
      hostDisposition,
      state: hostDisposition === 'auto' ? 'prepared' : hostDisposition === 'ask' ? 'awaiting-human' : 'denied',
      actionDisplay: safeActionDisplay(invocation),
      updatedAt: Date.now()
    }
    try {
      this.options.persistLifecycle?.(this.snapshot(record))
    } catch {
      this.respond(response, 503, { error: 'Tool admission evidence could not be persisted' })
      return true
    }
    this.records.set(admissionId, record)
    this.invocationIndex.set(invocation.invocationId, admissionId)
    this.options.onLifecycle?.(this.snapshot(record))
    this.respond(response, 200, this.preparation(record))
    return true
  }

  private resolve(body: unknown, response: ServerResponse): true {
    const admissionId = isRecord(body) && typeof body.admissionId === 'string' ? body.admissionId : ''
    const invocationId = isRecord(body) && typeof body.invocationId === 'string' ? body.invocationId : ''
    const approved = isRecord(body) && typeof body.approved === 'boolean' ? body.approved : undefined
    const localDisposition = isRecord(body) ? body.localDisposition : undefined
    const record = this.records.get(admissionId)
    if (
      !record ||
      record.invocation.invocationId !== invocationId ||
      approved === undefined ||
      !['allowed', 'approved', 'governance_bypassed', 'denied'].includes(String(localDisposition))
    ) {
      this.respond(response, 404, { error: 'Tool admission decision is unknown' })
      return true
    }
    if (!approved) {
      if (record.decision === true || ['claimed', 'succeeded'].includes(record.state)) {
        this.respond(response, 409, { error: 'Tool admission decision conflicts with host state' })
        return true
      }
      this.transition(record, 'denied')
      record.decision ??= false
      this.respond(response, 200, { state: record.state })
      return true
    }
    const currentDisposition = this.options.disposition(record.invocation.providerToolName)
    const requiresHuman =
      record.hostDisposition === 'ask' || currentDisposition === 'ask' || localDisposition === 'approved'
    if (
      record.hostDisposition === 'deny' ||
      currentDisposition === 'deny' ||
      localDisposition === 'denied' ||
      (requiresHuman && record.decision !== true) ||
      !['prepared', 'awaiting-ack', 'authorized'].includes(record.state)
    ) {
      this.respond(response, 409, { error: 'Tool admission decision conflicts with host state' })
      return true
    }
    this.transition(record, 'authorized')
    this.respond(response, 200, this.receipt(record))
    return true
  }

  private cancel(body: unknown, response: ServerResponse): true {
    const admissionId = isRecord(body) && typeof body.admissionId === 'string' ? body.admissionId : ''
    const invocationId = isRecord(body) && typeof body.invocationId === 'string' ? body.invocationId : undefined
    const reason = isRecord(body) && body.reason === 'invalidated' ? 'invalidated' : 'cancelled'
    const state = this.cancelAdmission(admissionId, invocationId, reason)
    if (!state) {
      this.respond(response, 404, { error: 'Tool admission is unknown' })
      return true
    }
    const outcome = ['cancelled', 'invalidated'].includes(state)
      ? 'cancelled'
      : state === 'claimed'
        ? 'already_claimed'
        : 'already_terminal'
    this.respond(response, 200, outcome)
    return true
  }

  private finish(body: unknown, response: ServerResponse): true {
    const admissionId = isRecord(body) && typeof body.admissionId === 'string' ? body.admissionId : ''
    const invocationId = isRecord(body) && typeof body.invocationId === 'string' ? body.invocationId : ''
    const outcome = isRecord(body) && (body.outcome === 'succeeded' || body.outcome === 'failed') ? body.outcome : undefined
    const record = this.records.get(admissionId)
    if (!record || record.invocation.invocationId !== invocationId || !outcome) {
      this.respond(response, 404, { error: 'Tool admission is unknown' })
      return true
    }
    if (record.state === 'claimed') this.transition(record, outcome)
    if (record.state !== outcome) {
      this.respond(response, 409, { error: 'Tool admission is not awaiting a terminal receipt' })
      return true
    }
    response.writeHead(204)
    response.end()
    return true
  }

  private inspect(body: unknown, response: ServerResponse): true {
    const admissionId = isRecord(body) && typeof body.admissionId === 'string' ? body.admissionId : ''
    const record = this.records.get(admissionId)
    if (!record) {
      this.respond(response, 404, { error: 'Tool admission is unknown' })
      return true
    }
    this.respond(response, 200, {
      admissionId,
      invocationId: record.invocation.invocationId,
      toolName: record.invocation.providerToolName,
      state: record.state,
      hostDisposition: record.hostDisposition,
      updatedAt: record.updatedAt
    })
    return true
  }

  private binds(invocation: PreparedInvocation): boolean {
    if (
      invocation.version !== UAR_TOOL_ADMISSION_VERSION ||
      invocation.hostEpoch !== this.hostEpoch ||
      invocation.ownerId !== this.options.ownerId ||
      invocation.workspace !== this.options.workspace ||
      invocation.attempt !== 1
    ) {
      return false
    }
    this.runtimeEpoch ??= invocation.runtimeEpoch
    this.rootRunId ??= invocation.rootRunId
    return this.runtimeEpoch === invocation.runtimeEpoch && this.rootRunId === invocation.rootRunId
  }

  private receipt(record: AdmissionRecord): Record<string, unknown> {
    return {
      version: UAR_TOOL_ADMISSION_VERSION,
      admissionId: record.admissionId,
      invocationId: record.invocation.invocationId,
      runtimeEpoch: record.invocation.runtimeEpoch,
      hostEpoch: this.hostEpoch,
      managedMcpMetadata: true
    }
  }

  private preparation(record: AdmissionRecord): Record<string, unknown> {
    return {
      ...this.receipt(record),
      hostDisposition: record.hostDisposition,
      actionDisplay: record.actionDisplay
    }
  }

  private transition(record: AdmissionRecord, state: UarHostAdmissionState): void {
    if (record.state === state) return
    const snapshot = this.snapshot(record, state)
    this.options.persistLifecycle?.(snapshot)
    record.state = state
    record.updatedAt = snapshot.updatedAt
    this.options.onLifecycle?.(snapshot)
  }

  private snapshot(record: AdmissionRecord, state = record.state): UarHostAdmissionSnapshot {
    return {
      admissionId: record.admissionId,
      invocationId: record.invocation.invocationId,
      rootRunId: record.invocation.rootRunId,
      executingRunId: record.invocation.executingRunId,
      sessionId: this.options.sessionId ?? this.options.ownerId,
      ownerId: record.invocation.ownerId,
      workspace: record.invocation.workspace,
      hostEpoch: this.hostEpoch,
      toolName: record.invocation.providerToolName,
      state,
      hostDisposition: record.hostDisposition,
      actionDisplay: record.actionDisplay,
      updatedAt: state === record.state ? record.updatedAt : Date.now()
    }
  }

  private respond(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  }
}

function isPreparedInvocation(value: unknown): value is PreparedInvocation {
  if (!isRecord(value) || !isRecord(value.validatedArguments)) return false
  const strings = [
    'invocationId',
    'modelToolCallId',
    'rootRunId',
    'executingRunId',
    'ownerId',
    'workspace',
    'runtimeEpoch',
    'hostEpoch',
    'catalogRevision',
    'mountedServerId',
    'nativeToolName',
    'providerToolName',
    'runPolicyRevision',
    'toolPolicyRevision'
  ]
  return (
    value.version === UAR_TOOL_ADMISSION_VERSION &&
    value.attempt === 1 &&
    Number.isSafeInteger(value.callIndex) &&
    strings.every((key) => typeof value[key] === 'string' && value[key].length > 0)
  )
}

function argumentDigest(value: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(value))).digest('hex')
}

function safeActionDisplay(invocation: PreparedInvocation): Record<string, unknown> {
  const target = safeTarget(invocation.validatedArguments)
  return {
    operation: invocation.nativeToolName,
    server: invocation.mountedServerId,
    ...(target ? { target } : {}),
    detailsAvailable: Boolean(target)
  }
}

function safeTarget(argumentsValue: Record<string, unknown>): string | undefined {
  for (const key of ['path', 'filePath', 'directory', 'root', 'uri', 'url']) {
    const value = argumentsValue[key]
    if (typeof value !== 'string' || !value.trim()) continue
    const trimmed = value.trim().slice(0, 512)
    if (key !== 'uri' && key !== 'url') return trimmed
    try {
      const parsed = new URL(trimmed)
      parsed.username = ''
      parsed.password = ''
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString()
    } catch {
      return undefined
    }
  }
  return undefined
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
