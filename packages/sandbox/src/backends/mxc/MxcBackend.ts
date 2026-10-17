import { release } from 'node:os'

import { SandboxError } from '../../host/SandboxError.js'
import type { SandboxProbe, SandboxSpec } from '../../types.js'
import type { SandboxBackend } from '../types.js'
import { createLease } from './lease.js'
import { compilePolicy } from './policy.js'

export class MxcBackend implements SandboxBackend {
  readonly id = process.platform === 'win32' ? 'mxc-processcontainer' : 'mxc-seatbelt'

  async probe(spec: SandboxSpec): Promise<SandboxProbe> {
    const base = {
      environment: {
        id: spec.environmentId,
        kind: 'native' as const,
        os: process.platform === 'darwin' ? 'macos' : process.platform
      },
      backend: { id: this.id, version: '1.0.0' },
      requirements: [] as SandboxProbe['requirements']
    }
    try {
      if (!['darwin', 'win32'].includes(process.platform))
        throw new SandboxError('BACKEND_UNAVAILABLE', 'This MXC adapter supports macOS and Windows')
      const { request, effectivePolicy } = compilePolicy(spec)
      if (process.platform === 'win32') {
        const build = Number(release().split('.')[2])
        if (build < 22631)
          throw new SandboxError(
            'BACKEND_UNAVAILABLE',
            'This adapter requires Windows 11 23H2 or newer; MXC officially supports 24H2+'
          )
        if (build < 26100)
          effectivePolicy.limitations = [
            ...(effectivePolicy.limitations ?? []),
            'Windows 11 23H2 is below the MXC supported floor (24H2); this host is experimental.'
          ]
        const [major, minor] = process.versions.node.split('.').map(Number)
        if (!((major === 24 && minor >= 21) || (major === 26 && minor >= 8) || major > 26))
          throw new SandboxError('BACKEND_UNAVAILABLE', 'MXC Windows stdio requires Node 24.21+ (24.x) or 26.8+')
      }
      const { getAvailableBackends, probe } = await import('@microsoft/mxc-sdk/v1')
      const backendName = process.platform === 'win32' ? 'processcontainer' : 'seatbelt'
      if (!getAvailableBackends().some((backend) => backend.backend === backendName))
        throw new SandboxError('BACKEND_UNAVAILABLE', `MXC ${backendName} is unavailable on this host`)
      if (process.platform === 'win32') {
        const assessment = probe(request)
        if (assessment.error || !assessment.tier)
          throw new SandboxError('BACKEND_UNAVAILABLE', assessment.error ?? 'No Windows isolation tier is available')
        base.requirements = ['prepare-system-drive', 'prepare-null-device']
          .filter((command) => assessment.warnings.some((warning) => warning.includes(`wxc-host-prep ${command}`)))
          .map((command) => ({
            code: command,
            message: `Run the packaged wxc-host-prep.exe ${command} as administrator`,
            adminRequired: true
          }))
        effectivePolicy.limitations = [...(effectivePolicy.limitations ?? []), ...assessment.warnings]
        if (base.requirements.length)
          return {
            ...base,
            status: 'setup-required',
            policyPreview: effectivePolicy,
            checks: [{ feature: this.id, status: 'unsupported', reason: 'Windows host preparation is required' }]
          }
      }
      return {
        ...base,
        status: 'ready',
        checks: [{ feature: this.id, status: 'supported' }],
        policyPreview: effectivePolicy
      }
    } catch (error) {
      return {
        ...base,
        status: 'unavailable',
        checks: [{ feature: this.id, status: 'unsupported', reason: String(error) }]
      }
    }
  }

  launch(instanceId: string, spec: SandboxSpec) {
    if (!['darwin', 'win32'].includes(process.platform))
      throw new SandboxError('BACKEND_UNAVAILABLE', 'This MXC adapter supports macOS and Windows')
    const policy = compilePolicy(spec)
    return createLease(spec, async () => {
      const assessment = await this.probe(spec)
      if (assessment.status !== 'ready')
        throw new SandboxError(
          assessment.status === 'setup-required' ? 'SETUP_REQUIRED' : 'BACKEND_UNAVAILABLE',
          [
            ...assessment.requirements.map((requirement) => requirement.message),
            ...assessment.checks.map((check) => check.reason).filter(Boolean)
          ].join('; ')
        )
      return {
        request: { ...policy.request, containerName: `cherry-${instanceId}` },
        effectivePolicy: assessment.policyPreview
      }
    })
  }
}
