import type { AcpLoginProfile } from '@cherrystudio/agent-runtime-acp/profile'

export const antigravityCli = {
  id: 'antigravity-acp',
  modelEndpoints: ['google-generate-content'],
  terminalArgs: [],
  sessionModel: true,
  auth: {
    catalogRequiresLogin: true,
    methods: [
      { id: 'oauth-personal', form: 'browser', name: 'Google' },
      { id: 'oauth-business', form: 'enterprise', name: 'Gemini Enterprise' },
      { id: 'gemini-api-key', form: 'api-key', name: 'Gemini', apiKey: 'GEMINI_API_KEY' },
      {
        id: 'agent-platform',
        form: 'cloud',
        name: 'Gemini Enterprise Agent Platform',
        apiKey: 'GOOGLE_API_KEY',
        project: 'GOOGLE_CLOUD_PROJECT',
        location: 'GOOGLE_CLOUD_LOCATION'
      }
    ]
  } satisfies AcpLoginProfile,
  terminalCli: { executable: 'agy', managedPackage: 'google-antigravity/antigravity-cli' },
  name: 'Google Antigravity',
  protocol: 'acp',
  executable: 'agy_acp_server.par',
  aliases: ['agy_acp_server'],
  platformArgs: {
    linux: ['--uid=']
  },
  args: [],
  helpUrl: 'https://antigravity.google/docs/ide/extensions'
} as const
