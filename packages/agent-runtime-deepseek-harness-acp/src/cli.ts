import type { PermissionModeCatalog, AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

export const DSH_PERMISSION_MODES = {
  id: 'dsh-mode',
  currentValue: 'workspace-write',
  application: 'reconnect',
  options: [
    { value: 'read-only', name: 'Read Only', permissionMode: 'plan' },
    { value: 'workspace-write', name: 'Workspace', permissionMode: 'acceptEdits' },
    { value: 'danger-full-access', name: 'Full Access', permissionMode: 'bypassPermissions' }
  ]
} as const satisfies PermissionModeCatalog

export function dshMode(selected?: string) {
  return {
    ...DSH_PERMISSION_MODES,
    currentValue:
      DSH_PERMISSION_MODES.options.find(({ value }) => value === selected)?.value ?? DSH_PERMISSION_MODES.currentValue,
    options: [...DSH_PERMISSION_MODES.options]
  }
}

export function dshModelAddress(nativeModel: string, route: string): string | undefined {
  try {
    const value: unknown = JSON.parse(nativeModel)
    if (Array.isArray(value) && value.length === 2 && value[0] === route && typeof value[1] === 'string')
      return value[1]
  } catch {
    return undefined
  }
}

export const dshCli = {
  id: 'deepseek-harness',
  credentialScope: 'provider',
  defaultMode: DSH_PERMISSION_MODES,
  modeForLaunch: (env: Readonly<Record<string, string>>) => dshMode(env.DSH_PERMISSION_MODE),
  minimumAcpVersion: '0.1.2-alpha.2',
  name: 'DeepSeek Harness',
  protocol: 'acp',
  executable: 'dsh',
  args: ['--profile', 'acp'],
  npmPackage: '@deepseek-ai/dsh',
  helpUrl: 'https://github.com/deepseek-ai/deepseek-harness'
} as const satisfies AcpCliPreset
