import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { parseDocument } from 'yaml'

import { t } from '@main/i18n'
import { getEnvironmentValue } from '@main/utils/env'
import type { CliConfigTarget } from '@shared/utils/cliConfig'
import { POOLSIDE_GATEWAY_SERVER } from '@shared/utils/cliConfig'

function parseToml(content: string) {
  try {
    return toml.parse(content)
  } catch {
    throw new Error(t('code_cli.model.invalid_config', { format: 'TOML' }))
  }
}

function parseYamlDoc(content: string | null) {
  const doc = parseDocument(content ?? '{}')
  if (doc.errors.length) throw new Error(t('code_cli.model.invalid_config', { format: 'YAML' }))
  if (doc.contents === null) doc.contents = doc.createNode({}) as unknown as typeof doc.contents
  return doc
}

function tomlTable(value: unknown): toml.TomlTable {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
    ? { ...(value as toml.TomlTable) }
    : {}
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

export function resolveClineProvider(config: Record<string, unknown> | undefined) {
  const lastUsed = config?.lastUsedProvider
  const id = typeof lastUsed === 'string' && lastUsed ? lastUsed : 'openai-compatible'
  const entry = asRecord(asRecord(config?.providers)?.[id])
  const legacy = id.startsWith('cherry-')
  const settings = legacy ? entry : asRecord(entry?.settings)
  const provider = typeof settings?.provider === 'string' && settings.provider ? settings.provider : id
  return {
    id,
    provider,
    settings,
    managed: entry?.cherryManaged === true,
    legacy
  }
}

export function usesGlobalClineProfile(env: NodeJS.ProcessEnv, shellEnv: NodeJS.ProcessEnv): boolean {
  return ['CLINE_DATA_DIR', 'CLINE_DIR', 'HOME', 'USERPROFILE'].every(
    (key) => getEnvironmentValue(env, key) === getEnvironmentValue(shellEnv, key)
  )
}

/** Changes only the native default, preserving credentials and unrelated settings. */
export function updateNativeModelConfig(target: CliConfigTarget, content: string | null, model?: string): string {
  if (target === 'poolside-settings') {
    const config = parseDocument(content ?? '{}')
    if (config.errors.length) throw new Error(t('code_cli.model.invalid_config', { format: 'YAML' }))
    config.setIn(['pool', 'default_agent_server'], 'Poolside')
    if (!config.hasIn(['agent_servers', 'Poolside']))
      config.setIn(['agent_servers', 'Poolside'], config.createNode({ type: 'custom', command: 'pool', args: ['acp'] }))
    const key = ['agent_servers', 'Poolside', 'default_config_options', 'model']
    if (model === undefined) config.deleteIn(key)
    else config.setIn(key, model)
    return config.toString()
  }
  if (target === 'codex-config' || target === 'kimi-config' || target === 'vibe-config') {
    const config = parseToml(content ?? '')
    const key = target === 'codex-config' ? 'model' : target === 'vibe-config' ? 'active_model' : 'default_model'
    if (model === undefined) delete config[key]
    else config[key] = model
    return toml.stringify(config)
  }
  if (target === 'grok-config') {
    const config = parseToml(content ?? '')
    const models = tomlTable(config.models)
    if (model === undefined) {
      delete models.default
      if (Object.keys(models).length === 0) delete config.models
      else config.models = models
    } else {
      models.default = model
      config.models = models
    }
    return toml.stringify(config)
  }
  if (target === 'hermes-config' || target === 'minimax-config' || target === 'goose-config') {
    const config = parseYamlDoc(content)
    const key =
      target === 'hermes-config' ? ['model', 'default'] : target === 'goose-config' ? ['GOOSE_MODEL'] : ['defaultModel']
    if (model === undefined) config.deleteIn(key)
    else config.setIn(key, model)
    return config.toString()
  }
  if (target === 'omp-settings') {
    const config = parseYamlDoc(content)
    if (model === undefined) {
      config.deleteIn(['defaultProvider'])
      config.deleteIn(['defaultModel'])
    } else {
      const slash = model.indexOf('/')
      if (slash > 0 && slash < model.length - 1) {
        config.setIn(['defaultProvider'], model.slice(0, slash))
        config.setIn(['defaultModel'], model.slice(slash + 1))
      } else {
        config.deleteIn(['defaultProvider'])
        config.setIn(['defaultModel'], model)
      }
    }
    return config.toString()
  }
  const errors: ParseError[] = []
  const config = parse(content ?? '{}', errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(t('code_cli.model.invalid_config', { format: 'JSON' }))
  }
  let updates: [string[], string | undefined][]
  switch (target) {
    case 'claude-settings':
      updates = [
        [['model'], model],
        [['env', 'ANTHROPIC_MODEL'], model]
      ]
      break
    case 'codebuddy-settings':
    case 'opencode-config':
    case 'kilo-config':
    case 'copilot-settings':
    case 'zcode-config':
    case 'glm-credentials':
      updates = [[['model'], model]]
      break
    case 'snow-config':
      updates = [
        [['snowcfg', 'advancedModel'], model],
        [['snowcfg', 'basicModel'], model]
      ]
      break
    case 'cline-providers': {
      const { id, legacy } = resolveClineProvider(config)
      updates = [[['providers', id, ...(legacy ? [] : ['settings']), 'model'], model]]
      break
    }
    case 'factory-settings':
      updates = [[['sessionDefaultSettings', 'model'], model]]
      break
    case 'qwen-settings':
      updates = [[['model', 'name'], model]]
      break
    case 'pi-settings': {
      const slash = model?.indexOf('/') ?? -1
      if (model && (slash < 1 || slash === model.length - 1)) throw new Error(t('code_cli.model.pi_model_invalid'))
      updates = [
        [['defaultProvider'], model?.slice(0, slash)],
        [['defaultModel'], model?.slice(slash + 1)]
      ]
      break
    }
    default:
      throw new Error(t('code_cli.model.unsupported'))
  }
  return updates.reduce(
    (text, [key, value]) =>
      applyEdits(
        text,
        modify(text, key, value, {
          formattingOptions: { insertSpaces: true, tabSize: 2 }
        })
      ),
    content ?? '{}'
  )
}

export function readNativeModelConfig(target: CliConfigTarget, content: string): string | undefined {
  if (target === 'poolside-settings') {
    const config = parseDocument(content)
    if (config.errors.length) throw new Error(t('code_cli.model.invalid_config', { format: 'YAML' }))
    const server =
      config.getIn(['pool', 'default_agent_server']) === POOLSIDE_GATEWAY_SERVER ? POOLSIDE_GATEWAY_SERVER : 'Poolside'
    const model = config.getIn(['agent_servers', server, 'default_config_options', 'model'])
    return typeof model === 'string' ? model : undefined
  }
  if (target === 'codex-config' || target === 'kimi-config' || target === 'vibe-config') {
    const config = parseToml(content)
    const value =
      config[target === 'codex-config' ? 'model' : target === 'vibe-config' ? 'active_model' : 'default_model']
    return typeof value === 'string' ? value : undefined
  }
  if (target === 'grok-config') {
    const config = parseToml(content)
    const value = tomlTable(config.models).default
    return typeof value === 'string' ? value : undefined
  }
  if (target === 'hermes-config' || target === 'minimax-config' || target === 'goose-config') {
    const config = parseYamlDoc(content)
    const value = config.getIn(
      target === 'hermes-config' ? ['model', 'default'] : target === 'goose-config' ? ['GOOSE_MODEL'] : ['defaultModel']
    )
    return typeof value === 'string' ? value : undefined
  }
  if (target === 'omp-settings') {
    const config = parseYamlDoc(content)
    const provider = config.getIn(['defaultProvider'])
    const model = config.getIn(['defaultModel'])
    if (typeof model !== 'string' || !model) return undefined
    return typeof provider === 'string' && provider ? `${provider}/${model}` : model
  }
  const errors: ParseError[] = []
  const config = parse(content, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config))
    throw new Error(t('code_cli.model.invalid_config', { format: 'JSON' }))
  if (target === 'cline-providers') {
    const { settings } = resolveClineProvider(config)
    const model = settings?.model
    return typeof model === 'string' && model ? model : undefined
  }
  if (target === 'snow-config') {
    const snowcfg =
      config.snowcfg && typeof config.snowcfg === 'object' && !Array.isArray(config.snowcfg)
        ? (config.snowcfg as Record<string, unknown>)
        : undefined
    const model = (typeof snowcfg?.advancedModel === 'string' && snowcfg.advancedModel) || config.model
    return typeof model === 'string' && model ? model : undefined
  }
  if (target === 'zcode-config') {
    if (config.provider && typeof config.provider === 'object' && !Array.isArray(config.provider)) {
      const cherryEntry = Object.entries(config.provider as Record<string, unknown>).find(([key]) =>
        key.startsWith('cherry-')
      )
      if (cherryEntry) {
        const [providerKey, entry] = cherryEntry
        const models =
          entry && typeof entry === 'object' && !Array.isArray(entry)
            ? (entry as Record<string, unknown>).models
            : undefined
        const firstModelId =
          models && typeof models === 'object' && !Array.isArray(models) ? Object.keys(models)[0] : undefined
        if (firstModelId) return `${providerKey}\\${firstModelId}`
      }
    }
    return typeof config.model === 'string' && config.model ? config.model : undefined
  }
  const value =
    target === 'factory-settings'
      ? config.sessionDefaultSettings?.model
      : target === 'pi-settings'
        ? config.defaultProvider && config.defaultModel && `${config.defaultProvider}/${config.defaultModel}`
        : target === 'qwen-settings'
          ? config.model?.name
          : target === 'claude-settings'
            ? config.env?.ANTHROPIC_MODEL || config.model
            : config.model
  return typeof value === 'string' && value ? value : undefined
}

/** Resolves a config-file default against the IDs advertised by the ACP session. */
export function resolveConfiguredAcpModel(presetId: string | undefined, model: string, available: string[]): string {
  if (available.includes(model)) return model
  let candidate = model
  if (presetId === 'qwen') candidate = `${model}(openai)`
  if (presetId === 'hermes') candidate = `custom:${model}`
  if (presetId === 'minimax') {
    const slash = model.indexOf('/')
    if (slash > 0)
      candidate = `m:${encodeURIComponent(model.slice(0, slash))}:${encodeURIComponent(model.slice(slash + 1))}:v:`
  }
  if (presetId === 'zcode') {
    const slashNormalized = model.includes('/') ? model.replace('/', '\\') : model
    if (available.includes(slashNormalized)) return slashNormalized
    const suffixMatch = available.find((item) => item.endsWith(`\\${model}`))
    if (suffixMatch) return suffixMatch
  }
  return available.includes(candidate) ? candidate : model
}
