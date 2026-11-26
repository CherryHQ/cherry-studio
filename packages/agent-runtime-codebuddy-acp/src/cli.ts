import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const codeBuddyCli = {
  id: 'codebuddy-code',
  permissionMode: {
    values: {
      default: 'default',
      acceptedits: 'acceptEdits',
      plan: 'plan',
      auto: 'auto',
      bypasspermissions: 'bypassPermissions'
    }
  } satisfies AcpPermissionModes,
  modelEndpoints: ['openai-chat-completions', 'openai-responses'],
  terminalArgs: [],
  modelConfig: { tool: 'codebuddy-code', target: 'codebuddy-settings', overrides: ['CODEBUDDY_MODEL'] },
  name: 'Codebuddy Code',
  protocol: 'acp',
  executable: 'codebuddy',
  npmPackage: '@tencent-ai/codebuddy-code',
  aliases: ['codebuddy-code', 'cbc'],
  args: ['--acp'],
  helpUrl: 'https://www.codebuddy.cn/cli/'
} as const
