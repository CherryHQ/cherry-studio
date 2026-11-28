import { acpConfigRecord, type AcpCliPreset } from '@cherrystudio/agent-runtime-acp/profile'

const accountRequestId = 'cherry-account'

export const codeBuddyCli = {
  id: 'codebuddy-code',
  accountProbe: {
    args: ['--print', '--input-format', 'stream-json', '--output-format', 'stream-json'],
    stdin:
      JSON.stringify({ type: 'control_request', request_id: accountRequestId, request: { subtype: 'initialize' } }) +
      '\n',
    parse(output: string, env: Readonly<Record<string, string>>) {
      if (env.CODEBUDDY_API_KEY) return { status: 'unknown' } as const
      for (const line of output.split('\n')) {
        try {
          const message = acpConfigRecord(JSON.parse(line))
          const response = acpConfigRecord(message?.response)
          if (
            message?.type !== 'control_response' ||
            response?.request_id !== accountRequestId ||
            response.subtype !== 'success'
          )
            continue
          const account = acpConfigRecord(response.response)?.account
          if (account === null) return { status: 'signed-out' } as const
          const identity = acpConfigRecord(account)
          if (identity) {
            const displayName = typeof identity.nickname === 'string' ? identity.nickname : undefined
            return { status: 'signed-in', ...(displayName && { account: { displayName } }) } as const
          }
        } catch {
          continue
        }
      }
      return { status: 'unknown' } as const
    }
  },
  permissionMode: {
    values: {
      default: 'default',
      acceptedits: 'acceptEdits',
      plan: 'plan',
      auto: 'auto',
      bypasspermissions: 'bypassPermissions'
    }
  },
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
} as const satisfies AcpCliPreset<'codebuddy-settings'>
