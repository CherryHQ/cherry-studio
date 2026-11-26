import {
  acpConfigRecord,
  acpGatewayPath,
  type AcpJsonModelProfile,
  type AcpGatewayConfig,
  type AcpLaunch,
  type AcpModelSelection
} from '@cherrystudio/agent-runtime-acp/profile'

import { clineCli } from './cli'

function readProvider(config: Record<string, unknown>) {
  const lastUsed = config.lastUsedProvider
  const id = typeof lastUsed === 'string' && lastUsed ? lastUsed : 'openai-compatible'
  const entry = acpConfigRecord(acpConfigRecord(config.providers)?.[id])
  const legacy = id.startsWith('cherry-')
  const settings = legacy ? entry : acpConfigRecord(entry?.settings)
  const provider = typeof settings?.provider === 'string' && settings.provider ? settings.provider : id
  return { id, provider, settings, managed: entry?.cherryManaged === true, legacy }
}

const clineProfile = {
  format: 'json',
  target: 'cline-providers',
  matchesEnvironment(get, shell) {
    return ['CLINE_DATA_DIR', 'CLINE_DIR', 'HOME', 'USERPROFILE'].every((key) => get(key) === shell(key))
  },
  readModel(doc) {
    const model = readProvider(doc).settings?.model
    return typeof model === 'string' && model ? model : undefined
  },
  writeModel(doc, model) {
    const { id, legacy } = readProvider(doc)
    return [[['providers', id, ...(legacy ? [] : ['settings']), 'model'], model]]
  },
  launch(doc, env, get) {
    const { provider, managed, settings } = readProvider(doc)
    if (!managed || !settings) return
    const override = get('CLINE_PROVIDER')
    if (override && override !== provider) return
    if (typeof settings.apiKey === 'string' && settings.apiKey) env.CLINE_API_KEY = settings.apiKey
    env.CLINE_PROVIDER = provider
    if (typeof settings.baseUrl === 'string' && settings.baseUrl) {
      env.OPENAI_BASE_URL = settings.baseUrl
      env.CLINE_BASE_URL = settings.baseUrl
    }
    if (typeof settings.model === 'string' && settings.model) {
      env.CLINE_MODEL = settings.model
      return settings.model
    }
  }
} satisfies AcpJsonModelProfile<'cline-providers'>

const clineGateway = {
  format: 'json',
  read(doc, _model, get) {
    const { provider, managed, legacy, settings } = readProvider(doc)
    if (!settings || (!managed && !legacy)) return
    const expected = {
      CLINE_PROVIDER: provider,
      CLINE_API_KEY: settings.apiKey,
      CLINE_BASE_URL: settings.baseUrl,
      OPENAI_BASE_URL: settings.baseUrl,
      CLINE_MODEL: settings.model
    }
    if (Object.entries(expected).some(([key, value]) => get(key) !== undefined && get(key) !== value)) return
    return {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      path: legacy ? acpGatewayPath(settings.api) : '/v1/chat/completions'
    }
  }
} satisfies AcpGatewayConfig

function clineSelection(configured: string | undefined, launch: AcpLaunch): AcpModelSelection {
  return { model: configured ?? (launch.env.CLINE_MODEL || undefined), allowUnlisted: true }
}

export const clinePreset = {
  id: clineCli.id,
  gateway: clineGateway,
  profile: clineProfile,
  selectModel: clineSelection
} as const
