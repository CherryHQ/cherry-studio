import {
  acpConfigRecord,
  acpGatewayPath,
  type AcpJsonModelProfile,
  type AcpGatewayConfig,
  type AcpLaunch,
  type AcpModelSelection
} from '@cherrystudio/agent-runtime-acp/profile'

import { snowCli } from './cli'

const snowProfile = {
  format: 'json',
  target: 'snow-config',
  readModel(doc) {
    const advanced = acpConfigRecord(doc.snowcfg)?.advancedModel
    const model = (typeof advanced === 'string' && advanced) || doc.model
    return typeof model === 'string' && model ? model : undefined
  },
  writeModel: (_doc, model) => [
    [['snowcfg', 'advancedModel'], model],
    [['snowcfg', 'basicModel'], model]
  ],
  launch(doc) {
    const model = acpConfigRecord(doc.snowcfg)?.advancedModel
    return doc.cherryManaged === true && typeof model === 'string' && model ? model : undefined
  }
} satisfies AcpJsonModelProfile<'snow-config'>

const snowGateway = {
  format: 'json',
  read(doc) {
    const config = acpConfigRecord(doc.snowcfg)
    return {
      baseUrl: config?.baseUrl,
      apiKey: config?.apiKey,
      model: config?.advancedModel,
      path: acpGatewayPath(config?.requestMethod)
    }
  }
} satisfies AcpGatewayConfig

function snowSelection(configured: string | undefined, launch: Pick<AcpLaunch, 'nativeModel'>): AcpModelSelection {
  return { model: configured ?? launch.nativeModel, implicit: launch.nativeModel }
}

export const snowPreset = {
  id: snowCli.id,
  gateway: snowGateway,
  profile: snowProfile,
  selectModel: snowSelection
} as const
