import type { AcpPermissionModes } from '@cherrystudio/agent-runtime-acp/profile'

export const deepAgentsCli = {
  id: 'deepagents',
  permissionMode: { values: { agent: 'default', plan: 'plan' } } satisfies AcpPermissionModes,
  credentialScope: 'provider',
  gatewayModelEndpoint: 'openai-responses',
  modelDependencies: ['@langchain/anthropic', '@langchain/openai'],
  name: 'DeepAgents',
  protocol: 'acp',
  executable: 'deepagents-acp',
  npmPackage: 'deepagents-acp',
  args: [],
  helpUrl: 'https://docs.langchain.com/oss/javascript/deepagents/overview'
} as const
