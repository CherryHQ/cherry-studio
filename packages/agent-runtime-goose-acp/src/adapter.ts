import type { Document } from 'yaml'

import type { AcpYamlModelProfile } from '@cherrystudio/agent-runtime-acp/profile'

import { gooseCli } from './cli'

const providers = {
  anthropic: { host: 'ANTHROPIC_HOST', key: 'ANTHROPIC_API_KEY', path: '/v1/messages' },
  openai: { host: 'OPENAI_HOST', key: 'OPENAI_API_KEY', path: '/v1/chat/completions' }
} as const

export function writeGooseConnection(
  doc: Document,
  provider: keyof typeof providers,
  baseUrl: string,
  apiKey: string,
  model: string
) {
  doc.setIn(['CHERRY_MANAGED'], true)
  doc.set('GOOSE_MODEL', model)
  doc.set('GOOSE_PROVIDER', provider)
  for (const [id, { host, key }] of Object.entries(providers)) {
    if (provider === id) {
      doc.set(host, baseUrl)
      doc.set(key, apiKey)
    } else {
      doc.delete(host)
      doc.delete(key)
    }
  }
}

export function clearGooseConnection(doc: Document) {
  if (doc.get('CHERRY_MANAGED') !== true) return false
  for (const key of [
    'CHERRY_MANAGED',
    'GOOSE_MODEL',
    'GOOSE_PROVIDER',
    ...Object.values(providers).flatMap(({ host, key }) => [host, key])
  ])
    doc.delete(key)
  return true
}

export function readGooseConnection(doc: Record<string, unknown>) {
  const { host, key, path } = doc.GOOSE_PROVIDER === 'anthropic' ? providers.anthropic : providers.openai
  return { baseUrl: doc[host], apiKey: doc[key], model: doc.GOOSE_MODEL, path }
}

export function readManagedGooseConnection(doc: Record<string, unknown>) {
  return doc.CHERRY_MANAGED === true ? readGooseConnection(doc) : undefined
}

export function gooseConfigDirectory(env: Record<string, string | undefined>, platform: string): string[] | undefined {
  if (env.GOOSE_PATH_ROOT) return [env.GOOSE_PATH_ROOT, 'config']
  if (platform === 'win32') return env.APPDATA ? [env.APPDATA, 'Block', 'goose', 'config'] : undefined
  return env.XDG_CONFIG_HOME ? [env.XDG_CONFIG_HOME, 'goose'] : undefined
}

const profile = {
  format: 'yaml',
  target: gooseCli.modelConfig.target,
  path: ['GOOSE_MODEL'],
  launch(doc, env) {
    if (doc.errors.length || doc.get('CHERRY_MANAGED') !== true) return
    const provider = doc.get('GOOSE_PROVIDER')
    const fields = ['GOOSE_PROVIDER', 'GOOSE_MODEL']
    if (provider === 'anthropic' || provider === 'openai')
      fields.push(providers[provider].host, providers[provider].key)
    for (const key of fields) {
      const value = doc.get(key)
      if (typeof value === 'string' && value) env[key] = value
    }
    const model = doc.get('GOOSE_MODEL')
    return typeof model === 'string' && model ? model : undefined
  }
} satisfies AcpYamlModelProfile

export const goosePreset = {
  id: gooseCli.id,
  profile
}
