import fs from 'fs'
import path from 'path'

import { application } from '@application'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import { BUILTIN_AGENT_ROLE, type BuiltinAgentRole } from '@shared/ai/builtinAgent'
import { type AgentConfiguration, sanitizeAgentConfiguration } from '@shared/data/api/schemas/agents'

const logger = loggerService.withContext('BuiltinAgentDefinition')

/** Canonical Claude plugin name declared by the bundled Cherry Assistant manifest. */
export const BUILTIN_AGENT_PLUGIN_NAME = 'cherry-assistant-builtin'

const TEMPLATE_NAME_BY_ROLE: Record<string, string> = {
  [BUILTIN_AGENT_ROLE.ASSISTANT]: 'cherry-assistant',
  [BUILTIN_AGENT_ROLE.SUPPORT]: 'cherry-support'
}

const PLUGIN_TEMPLATE_NAME_BY_ROLE: Record<string, string> = {
  [BUILTIN_AGENT_ROLE.ASSISTANT]: 'cherry-assistant',
  [BUILTIN_AGENT_ROLE.SUPPORT]: 'cherry-assistant'
}

// No `description` here: the builtin agent's display/search description is owned by i18n
// (`agent.builtin.cherry_assistant.description`), not the bundle — a bundle copy would be a
// drift-prone second source of truth.
export interface BuiltinAgentDefinition {
  name?: string
  instructions?: string
  configuration?: Record<string, unknown>
  skills?: string[]
}

export interface BuiltinAgentDefaults {
  name: string
  configuration: AgentConfiguration
}

/** Resolve a localized field: string passes through; locale-keyed object resolves by language. */
function resolveLocalizedField(value: unknown, language: string): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined

  const map = value as Record<string, string>
  const prefix = language.split('-')[0]
  const prefixKey = Object.keys(map).find((key) => key.startsWith(prefix))

  return map[language] || (prefixKey && map[prefixKey]) || map['en-US'] || Object.values(map)[0]
}

export function getBuiltinAgentTemplateDirectory(builtinRole: string): string | undefined {
  const templateName = TEMPLATE_NAME_BY_ROLE[builtinRole]
  if (!templateName) {
    logger.warn('Unknown builtin role, skipping provisioning', { builtinRole })
    return undefined
  }

  return path.join(application.getPath('feature.agents.builtin'), templateName)
}

export function getBuiltinAgentPluginTemplateDirectory(builtinRole: string): string | undefined {
  const templateName = PLUGIN_TEMPLATE_NAME_BY_ROLE[builtinRole]
  if (!templateName) {
    logger.warn('Unknown builtin role, skipping plugin provisioning', { builtinRole })
    return undefined
  }

  return path.join(application.getPath('feature.agents.builtin'), templateName)
}

export function loadBuiltinAgentDefinition(
  builtinRole: string,
  language: string = getAppLanguage()
): BuiltinAgentDefinition | undefined {
  const templateDir = getBuiltinAgentTemplateDirectory(builtinRole)
  if (!templateDir) return undefined

  const agentJsonPath = path.join(templateDir, 'agent.json')
  if (!fs.existsSync(agentJsonPath)) {
    logger.error('Builtin agent definition not found', { agentJsonPath, builtinRole })
    return undefined
  }

  try {
    const agentConfig = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8'))
    if (
      agentConfig.skills !== undefined &&
      (!Array.isArray(agentConfig.skills) || agentConfig.skills.some((skill: unknown) => typeof skill !== 'string'))
    ) {
      throw new Error('Builtin agent skills must be a string array')
    }
    return {
      name: resolveLocalizedField(agentConfig.name, language),
      instructions: resolveLocalizedField(agentConfig.instructions, language),
      configuration: agentConfig.configuration,
      skills: agentConfig.skills
    }
  } catch (error) {
    logger.error('Failed to load builtin agent definition', {
      builtinRole,
      agentJsonPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

export function loadBuiltinAgentDefaults(builtinRole: BuiltinAgentRole, language?: string): BuiltinAgentDefaults {
  const definition = loadBuiltinAgentDefinition(builtinRole, language)
  if (!definition) {
    throw new Error(`Builtin Agent package definition is unavailable: ${builtinRole}`)
  }

  const { data: configuration, invalidKeys } = sanitizeAgentConfiguration(definition.configuration)
  if (!configuration || invalidKeys.length > 0) {
    throw new Error(
      `Builtin Agent package configuration is invalid for ${builtinRole}: ${invalidKeys.join(', ') || '<root>'}`
    )
  }

  return {
    name: definition.name?.trim() || 'Built-in Agent',
    configuration: { ...configuration, builtin_role: builtinRole }
  }
}
