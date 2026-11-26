export const DSH_LOCAL_MODE_ID = 'dsh-mode'
export const DSH_LOCAL_MODE_OPTIONS = [
  { value: 'read-only', name: 'Read Only' },
  { value: 'workspace-write', name: 'Workspace' },
  { value: 'danger-full-access', name: 'Full Access' }
] as const

export function dshMode(selected?: string) {
  return {
    id: DSH_LOCAL_MODE_ID,
    currentValue: DSH_LOCAL_MODE_OPTIONS.find(({ value }) => value === selected)?.value ?? 'workspace-write',
    options: DSH_LOCAL_MODE_OPTIONS.map((option) => ({ ...option }))
  }
}

export const dshCli = {
  id: 'deepseek-harness',
  defaultMode: dshMode(),
  minimumAcpVersion: '0.1.2-alpha.2',
  name: 'DeepSeek Harness',
  protocol: 'acp',
  executable: 'dsh',
  args: ['--profile', 'acp'],
  npmPackage: '@deepseek-ai/dsh',
  helpUrl: 'https://github.com/deepseek-ai/deepseek-harness'
} as const
