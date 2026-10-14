import { applyEdits, modify, parse, type ParseError } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { parseDocument } from 'yaml'

import type { CliConfigTarget } from '@shared/utils/cliConfig'

/** Changes only the native default, preserving credentials and unrelated settings. */
export function updateNativeModelConfig(target: CliConfigTarget, content: string | null, model?: string): string {
  if (target === 'codex-config' || target === 'kimi-config') {
    const config = toml.parse(content ?? '')
    const key = target === 'codex-config' ? 'model' : 'default_model'
    if (model === undefined) delete config[key]
    else config[key] = model
    return toml.stringify(config)
  }
  if (target === 'hermes-config' || target === 'minimax-config') {
    const config = parseDocument(content ?? '{}')
    if (config.errors.length) throw new Error('Invalid agent YAML configuration')
    const key = target === 'hermes-config' ? ['model', 'default'] : ['defaultModel']
    if (model === undefined) config.deleteIn(key)
    else config.setIn(key, model)
    return config.toString()
  }
  const errors: ParseError[] = []
  const config = parse(content ?? '{}', errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('Invalid agent JSON configuration')
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
      updates = [[['model'], model]]
      break
    case 'qwen-settings':
      updates = [[['model', 'name'], model]]
      break
    case 'pi-settings': {
      const slash = model?.indexOf('/') ?? -1
      if (model && (slash < 1 || slash === model.length - 1)) throw new Error('Pi requires a provider/model identifier')
      updates = [
        [['defaultProvider'], model?.slice(0, slash)],
        [['defaultModel'], model?.slice(slash + 1)]
      ]
      break
    }
    default:
      throw new Error('This agent does not support saving a native default model')
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
  if (target === 'codex-config' || target === 'kimi-config') {
    const config = toml.parse(content)
    const value = config[target === 'codex-config' ? 'model' : 'default_model']
    return typeof value === 'string' ? value : undefined
  }
  if (target === 'hermes-config' || target === 'minimax-config') {
    const config = parseDocument(content)
    if (config.errors.length) throw new Error('Invalid agent YAML configuration')
    const value = config.getIn(target === 'hermes-config' ? ['model', 'default'] : ['defaultModel'])
    return typeof value === 'string' ? value : undefined
  }
  const errors: ParseError[] = []
  const config = parse(content, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config))
    throw new Error('Invalid agent JSON configuration')
  const value =
    target === 'pi-settings'
      ? config.defaultProvider && config.defaultModel && `${config.defaultProvider}/${config.defaultModel}`
      : target === 'qwen-settings'
        ? config.model?.name
        : target === 'claude-settings'
          ? config.env?.ANTHROPIC_MODEL || config.model
          : config.model
  return typeof value === 'string' ? value : undefined
}
