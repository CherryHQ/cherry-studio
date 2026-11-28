import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { AcpGatewayModel, AcpLaunch } from '@cherrystudio/agent-runtime-acp/profile'

const gatewayKey = 'CHERRY_JUNIE_GATEWAY_API_KEY'
const profileId = 'cherry-gateway'

export async function applyJunieGatewayModel(launch: AcpLaunch, gateway: AcpGatewayModel, directory: string) {
  const dispose = () => rm(directory, { recursive: true, force: true })
  try {
    await writeFile(
      path.join(directory, `${profileId}.json`),
      JSON.stringify({
        baseUrl: `${gateway.baseUrl}/v1/chat/completions`,
        id: gateway.model,
        apiType: 'OpenAICompletion',
        apiKey: '${' + gatewayKey + '}'
      }),
      { mode: 0o600 }
    )
  } catch (error) {
    await dispose()
    throw error
  }
  launch.args = [
    ...launch.args,
    '--model-default-locations=false',
    `--model-location=${directory}`,
    `--model=custom:${profileId}`
  ]
  launch.env[gatewayKey] = gateway.apiKey
  return { dispose }
}
