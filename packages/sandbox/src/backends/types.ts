import type { SandboxError } from '../host/SandboxError.js'
import type { EffectivePolicy, SandboxCompletion, SandboxInput, SandboxProbe, SandboxSpec } from '../types.js'

export interface BackendLease {
  failure: Promise<SandboxError>
  started: Promise<{ effectivePolicy: EffectivePolicy }>
  targetExit: Promise<SandboxCompletion['target']>
  stdin: SandboxInput
  stdout: AsyncIterable<Uint8Array>
  stderr: AsyncIterable<Uint8Array>
  channel: null
  terminate(options: { graceMs: number; timeoutMs: number }): Promise<SandboxCompletion['tree']>
  cleanup(options: {
    timeoutMs: number
  }): Promise<{ status: SandboxCompletion['cleanup']; issues: SandboxCompletion['issues'] }>
}

export interface SandboxBackend {
  readonly id: string
  probe(spec: SandboxSpec): Promise<SandboxProbe>
  launch(instanceId: string, spec: SandboxSpec): BackendLease
}
