import { SandboxError } from '../../host/SandboxError.js'
import type { SandboxProbe, SandboxSpec } from '../../types.js'
import type { SandboxBackend } from '../types.js'
import { createLease } from './lease.js'
import { compilePolicy } from './policy.js'

export class MxcBackend implements SandboxBackend {
  readonly id = 'mxc-seatbelt'

  async probe(spec: SandboxSpec): Promise<SandboxProbe> {
    const base = {
      environment: {
        id: spec.environmentId,
        kind: 'native' as const,
        os: process.platform === 'darwin' ? 'macos' : process.platform
      },
      backend: { id: this.id, version: '1.0.0' },
      requirements: []
    }
    try {
      if (process.platform !== 'darwin')
        throw new SandboxError('BACKEND_UNAVAILABLE', 'This MXC adapter currently supports macOS')
      const { effectivePolicy } = compilePolicy(spec)
      const { getAvailableBackends } = await import('@microsoft/mxc-sdk/v1')
      if (!getAvailableBackends().some((backend) => backend.backend === 'seatbelt'))
        throw new SandboxError('BACKEND_UNAVAILABLE', 'MXC Seatbelt is unavailable on this host')
      return {
        ...base,
        status: 'ready',
        checks: [{ feature: 'mxc-seatbelt', status: 'supported' }],
        policyPreview: effectivePolicy
      }
    } catch (error) {
      return {
        ...base,
        status: 'unavailable',
        checks: [{ feature: 'mxc-seatbelt', status: 'unsupported', reason: String(error) }]
      }
    }
  }

  launch(_instanceId: string, spec: SandboxSpec) {
    if (process.platform !== 'darwin')
      throw new SandboxError('BACKEND_UNAVAILABLE', 'This MXC adapter currently supports macOS')
    return createLease(spec, compilePolicy(spec))
  }
}
