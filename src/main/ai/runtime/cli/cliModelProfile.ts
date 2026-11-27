import { applyEdits, findNodeAtLocation, modify, parse, parseTree, type ParseError } from 'jsonc-parser'
import * as toml from 'smol-toml'
import { isCollection, parseDocument } from 'yaml'

import type { AcpJsonModelProfile, AcpYamlModelProfile } from '@cherrystudio/agent-runtime-acp/profile'
import type { TomlModelProfile } from '@cherrystudio/agent-runtime/cli'
import { t } from '@main/i18n'
import type { CliConfigTarget } from '@shared/utils/cliConfig'

export type CliModelProfile =
  | AcpJsonModelProfile<CliConfigTarget>
  | AcpYamlModelProfile<CliConfigTarget>
  | TomlModelProfile<CliConfigTarget>

export type CliModelBinding = { profile?: CliModelProfile }

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

function deleteYamlPath(doc: ReturnType<typeof parseDocument>, key: readonly string[]) {
  const parent = key.length > 1 ? doc.getIn(key.slice(0, -1), true) : doc.contents
  if (isCollection(parent)) doc.deleteIn(key)
}

function parseJson(content: string) {
  const errors: ParseError[] = []
  const config = parse(content, errors, { allowTrailingComma: true })
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config))
    throw new Error(t('code_cli.model.invalid_config', { format: 'JSON' }))
  return config as Record<string, unknown>
}

export function updateModelProfile(profile: CliModelProfile, content: string | null, model?: string): string {
  if (profile.format === 'toml') {
    const config = parseToml(content ?? '')
    profile.writeModel(config, model)
    return toml.stringify(config)
  }
  if (profile.format === 'yaml') {
    const config = parseYamlDoc(content)
    if ('writeModel' in profile) profile.writeModel(config, model)
    else {
      const path = 'write' in profile.path ? profile.path.write(config) : profile.path
      if (model === undefined) deleteYamlPath(config, path)
      else config.setIn(path, model)
    }
    return config.toString()
  }
  const updates = profile.writeModel(parseJson(content ?? '{}'), model, () => {
    throw new Error(t('code_cli.model.pi_model_invalid'))
  })
  return updates.reduce((text, [key, value]) => {
    if (value === undefined) {
      const tree = parseTree(text, undefined, { allowTrailingComma: true })
      if (!tree || !findNodeAtLocation(tree, key)) return text
    }
    return applyEdits(
      text,
      modify(text, key, value, {
        formattingOptions: { insertSpaces: true, tabSize: 2 }
      })
    )
  }, content ?? '{}')
}

export function readModelProfile(profile: CliModelProfile, content: string): string | undefined {
  if (profile.format === 'toml') return profile.readModel(parseToml(content))
  if (profile.format === 'json') return profile.readModel(parseJson(content))
  const doc = parseYamlDoc(content)
  if ('readModel' in profile) return profile.readModel(doc)
  const value = doc.getIn('read' in profile.path ? profile.path.read(doc) : profile.path)
  return typeof value === 'string' ? value : undefined
}
