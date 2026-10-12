export interface SandboxLimits {
  startupTimeoutMs: number
  lifetimeMs?: number
  stopGraceMs: number
  stopTimeoutMs: number
  cleanupTimeoutMs: number
  ioDrainTimeoutMs: number
  ioBufferBytes: number
  outputBytes?: number
  memoryBytes?: number
  processCount?: number
}

export interface SandboxSpec {
  ownerId: string
  environmentId: string
  runtimeProfileId: string
  command: { executable: string; args: readonly string[]; cwd: string; env: Readonly<Record<string, string>> }
  filesystem: {
    read: readonly string[]
    write: readonly string[]
    denyRead: readonly string[]
    denyWrite: readonly string[]
  }
  mounts?: readonly { source: string; target: string; access: 'read' | 'read-write' }[]
  network:
    | { mode: 'deny' }
    | { mode: 'proxy'; targets: readonly { host: string; port: number }[] }
    | { mode: 'unrestricted' }
  channel: 'none' | 'dedicated' | 'stdio'
  limits: SandboxLimits
}

export interface EffectivePolicy {
  limitations?: readonly string[]
  runtimeProfile: { id: string; version: string }
  filesystem: SandboxSpec['filesystem']
  mounts: NonNullable<SandboxSpec['mounts']>
  network: SandboxSpec['network']
  runtimeAccess: readonly { resource: string; access: string; reason: string }[]
  limits: SandboxLimits
  channel: SandboxSpec['channel']
}

export type SandboxProbe = {
  environment: { id: string; kind: 'native'; os: string }
  checks: readonly { feature: string; status: 'supported' | 'unsupported' | 'unknown'; reason?: string }[]
  requirements: readonly { code: string; message: string; adminRequired: boolean }[]
} & (
  | { status: 'ready'; backend: { id: string; version: string }; policyPreview: EffectivePolicy }
  | {
      status: 'unavailable' | 'setup-required'
      backend: { id: string; version: string } | null
      policyPreview?: EffectivePolicy
    }
)

export interface SandboxInput {
  write(data: Uint8Array): Promise<void>
  end(): Promise<void>
}

export interface SandboxCompletion {
  reason: 'exited' | 'stopped' | 'cancelled' | 'limit' | 'startup-error' | 'channel-error'
  target: { status: 'not-started' | 'exited' | 'unknown'; exitCode?: number; signal?: string }
  tree: 'gone' | 'unverified' | 'unknown'
  cleanup: 'complete' | 'incomplete'
  issues: readonly { code: string; message: string; resourceId?: string }[]
}

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type JsonObject = { [key: string]: JsonValue }

export interface RpcPeer {
  request(
    method: string,
    params: JsonObject,
    options?: { timeoutMs?: number; signal?: AbortSignal }
  ): Promise<JsonValue>
  handle(method: string, handler: (params: JsonObject, signal: AbortSignal) => Promise<JsonValue>): { dispose(): void }
}

export interface HostRpcBinding {
  configure(peer: RpcPeer): undefined
  authorize(context: { instanceId: string; ownerId: string; method: string; params: JsonObject }): Promise<boolean>
}

export interface SandboxInstanceBase {
  readonly id: string
  readonly ownerId: string
  readonly ready: Promise<{ backendId: string; effectivePolicy: EffectivePolicy }>
  readonly completion: Promise<SandboxCompletion>
  readonly stderr: AsyncIterable<Uint8Array>
  snapshot(): { state: 'starting' | 'running' | 'stopping' | 'stopped' | 'failed'; lastCompletion?: SandboxCompletion }
  stop(): Promise<SandboxCompletion>
}

export type SandboxInstance = SandboxInstanceBase &
  (
    | {
        readonly channel: 'none'
        readonly rpc: null
        readonly stdin: SandboxInput
        readonly stdout: AsyncIterable<Uint8Array>
      }
    | { readonly channel: 'stdio'; readonly rpc: RpcPeer; readonly stdin: null; readonly stdout: null }
  )
export type RawSandboxInstance = SandboxInstance & { channel: 'none' }
export type RpcSandboxInstance = SandboxInstance & { channel: 'stdio' }
