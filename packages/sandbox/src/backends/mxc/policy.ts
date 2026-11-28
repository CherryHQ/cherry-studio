import { accessSync, constants, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'

import type { ContainerRequest } from '@microsoft/mxc-sdk/v1'

import { SandboxError } from '../../host/SandboxError.js'
import type { EffectivePolicy, SandboxSpec } from '../../types.js'

export function compilePolicy(spec: SandboxSpec): { request: ContainerRequest; effectivePolicy: EffectivePolicy } {
  if (process.platform === 'win32' && (spec.filesystem.denyRead.length || spec.filesystem.denyWrite.length))
    throw new SandboxError(
      'POLICY_UNSUPPORTED',
      'MXC 1.0.0 Windows deny overrides are not reliably enforced; use separate read/write grants'
    )
  if (
    spec.environmentId !== 'native' ||
    spec.runtimeProfileId !== 'mxc-command-v1' ||
    (spec.network.mode !== 'deny' && (spec.network.mode !== 'proxy' || process.platform !== 'darwin')) ||
    spec.channel === 'dedicated' ||
    spec.mounts?.length ||
    spec.limits.memoryBytes !== undefined ||
    spec.limits.processCount !== undefined
  )
    throw new SandboxError(
      'POLICY_UNSUPPORTED',
      'MXC demo supports native commands, deny networking (or macOS proxy networking), and none/stdio channels; process and memory quotas are not enforced'
    )
  accessSync(spec.command.executable, constants.X_OK)
  accessSync(spec.command.cwd, constants.R_OK)
  const paths = (values: readonly string[]) => values.map((value) => realpathSync(value))
  const filesystem = {
    read: paths(spec.filesystem.read),
    write: paths(spec.filesystem.write),
    denyRead: paths(spec.filesystem.denyRead),
    denyWrite: paths(spec.filesystem.denyWrite)
  }
  const windows = process.platform === 'win32'
  const quote = (value: string) =>
    windows
      ? `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`
      : `'${value.replaceAll("'", "'\\''")}'`
  const inside = (path: string, root: string) => {
    const suffix = relative(root, path)
    return suffix === '' || (suffix !== '..' && !suffix.startsWith('..' + sep) && !isAbsolute(suffix))
  }
  const environment = windows
    ? {
        SYSTEMROOT: process.env.SystemRoot ?? 'C:\\Windows',
        LOCALAPPDATA: spec.command.cwd,
        ...Object.fromEntries(Object.entries(spec.command.env).map(([key, value]) => [key.toUpperCase(), value]))
      }
    : { ...spec.command.env }
  const request: ContainerRequest = {
    containment: { type: windows ? 'processcontainer' : 'seatbelt' },
    command: (windows ? '' : 'exec ') + [spec.command.executable, ...spec.command.args].map(quote).join(' '),
    workingDirectory: spec.command.cwd,
    environment,
    // Node/Python load Win32k-dependent DLLs; other UI restrictions remain requested.
    ...(windows ? { ui: { disable: false, clipboard: 'none' as const, allowInputInjection: false } } : {}),
    filesystem: {
      readonlyPaths: [realpathSync(spec.command.executable), ...filesystem.read, ...filesystem.denyWrite],
      readwritePaths: filesystem.write.filter((path) => !filesystem.denyWrite.some((root) => inside(path, root))),
      deniedPaths: filesystem.denyRead
    },
    network: { egress: { default: 'deny' }, ingress: { default: 'deny' } }
  }
  // MXC's readonlyPaths also grants reads; avoid expanding a write-only denial.
  if (
    filesystem.denyWrite.some((path) => ![...filesystem.read, ...filesystem.write].some((root) => inside(path, root)))
  )
    throw new SandboxError('POLICY_UNSUPPORTED', 'denyWrite must be inside an existing read/write grant')
  return {
    request,
    effectivePolicy: {
      runtimeProfile: { id: 'mxc-command-v1', version: '1' },
      filesystem,
      mounts: [],
      network: spec.network,
      channel: spec.channel,
      limits: spec.limits,
      runtimeAccess: [
        {
          resource: windows ? 'MXC ProcessContainer baseline' : 'MXC Seatbelt baseline',
          access: 'runtime defaults',
          reason: 'System paths and services required by the MXC backend'
        }
      ],
      limitations: windows
        ? [
            'MXC selects the Windows isolation tier; AppContainer/DACL temporarily changes ACLs on granted paths.',
            'Windows system resources accessible to AppContainers remain available; grants do not describe every runtime access.',
            'Win32k calls are enabled for DLL initialization; clipboard and input injection are requested denied, but UI isolation has not been independently verified.',
            'Explicit denyRead/denyWrite overrides are rejected on Windows because MXC 1.0.0 did not enforce them in native tests.',
            'MXC owns the Windows Job and policy cleanup; detached process-tree cleanup has not been independently certified.'
          ]
        : [
            'Filesystem grants are path-based; existing hard-link aliases may access objects outside grants.',
            'Writable directories allow Unix sockets; network deny does not mean all local IPC is denied.',
            'MXC terminates the process group; detached descendants are not guaranteed to be reaped.'
          ]
    }
  }
}
