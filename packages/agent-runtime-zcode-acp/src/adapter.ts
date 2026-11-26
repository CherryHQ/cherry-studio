import path from 'node:path'

import {
  acpConfigRecord,
  acpGatewayPath,
  type AcpHostBinary,
  type AcpJsonModelProfile,
  type AcpGatewayConfig
} from '@cherrystudio/agent-runtime-acp/profile'

import { zcodeCli } from './cli'

function zcodeModelId(model: string, available: readonly string[]) {
  const normalized = model.replace('/', '\\')
  return available.includes(normalized) ? normalized : (available.find((id) => id.endsWith('\\' + model)) ?? model)
}

const zcodeGateway = {
  format: 'json',
  read(doc, model) {
    const providers = acpConfigRecord(doc.provider)
    if (!providers) return
    const slash = model.indexOf('\\')
    const key = slash > 0 ? model.slice(0, slash) : Object.keys(providers).find((id) => id.startsWith('cherry-'))
    if (!key) return
    const entry = acpConfigRecord(providers[key])
    const models = acpConfigRecord(entry?.models)
    if (!models || !Object.keys(models).length) return
    const options = acpConfigRecord(entry?.options)
    return {
      baseUrl: options?.baseURL,
      apiKey: options?.apiKey,
      model: slash > 0 ? model.slice(slash + 1) : Object.keys(models)[0],
      path: acpGatewayPath(entry?.kind)
    }
  }
} satisfies AcpGatewayConfig

const zcodeHostBinary = {
  executable: 'zcode',
  label: 'ZCode Desktop / zcode CLI',
  envKey: 'ZCODE_BIN',
  async resolve(env, host) {
    const zcodeBin = env.ZCODE_BIN?.trim()
    if (zcodeBin) {
      if (path.isAbsolute(zcodeBin) || zcodeBin.includes('/') || zcodeBin.includes('\\')) {
        return (await host.isFile(zcodeBin)) ? zcodeBin : undefined
      }
      return (await host.find(zcodeBin)) ?? undefined
    }

    const installed = await host.installed()
    if (installed) return installed

    const onPath = await host.find('zcode')
    if (onPath) return onPath

    const home = host.home()
    const candidates = host.windows
      ? [
          path.join(
            env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'),
            'Programs',
            'ZCode',
            'resources',
            'glm',
            'zcode.cjs'
          ),
          path.join(env.ProgramFiles || 'C:\\Program Files', 'ZCode', 'resources', 'glm', 'zcode.cjs')
        ]
      : [
          '/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs',
          path.join(home, 'Applications', 'ZCode.app', 'Contents', 'Resources', 'glm', 'zcode.cjs'),
          '/opt/ZCode/resources/glm/zcode.cjs',
          '/usr/share/zcode/resources/glm/zcode.cjs'
        ]

    for (const candidate of candidates) {
      if (await host.isFile(candidate)) return candidate
    }
    return undefined
  }
} satisfies AcpHostBinary

const zcodeProfile = {
  format: 'json',
  target: 'zcode-config',
  writeModel: (_doc, model) => [[['model'], model]],
  readModel(doc) {
    const providers = acpConfigRecord(doc.provider)
    const key = providers && Object.keys(providers).find((id) => id.startsWith('cherry-'))
    const models = key && acpConfigRecord(acpConfigRecord(providers?.[key])?.models)
    const first = models && Object.keys(models)[0]
    if (first) return key + '\\' + first
    return typeof doc.model === 'string' && doc.model ? doc.model : undefined
  }
} satisfies AcpJsonModelProfile<'zcode-config'>

export const zcodePreset = {
  id: zcodeCli.id,
  gateway: zcodeGateway,
  profile: zcodeProfile,
  catalogId: zcodeModelId,
  hostBinary: zcodeHostBinary
} as const
