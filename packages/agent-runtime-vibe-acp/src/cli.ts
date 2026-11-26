import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const vibeCli = {
  id: 'mistral-vibe',
  account: { canReadAccount: true },
  loginArgs: ['--setup'],
  permissionMode: {
    values: { ask: 'default', 'accept-edits': 'acceptEdits', 'auto-approve': 'bypassPermissions' }
  } satisfies AcpPermissionModes,
  name: 'Mistral Vibe',
  protocol: 'acp',
  executable: 'vibe-acp',
  modelConfig: { tool: 'mistral-vibe', target: 'vibe-config', overrides: ['VIBE_HOME', 'VIBE_ACTIVE_MODEL'] },
  args: [],
  helpUrl: 'https://mistral.ai/products/vibe'
} as const

export function vibeInstall() {
  return { manager: 'uv' as const, package: 'mistral-vibe', args: ['tool', 'install', '--upgrade', 'mistral-vibe'] }
}
