/**
 * BuiltinAgentProvisioner
 *
 * Loads built-in agent definitions and initializes persona/memory files in
 * app-owned system workspaces. Bundled skills stay in the read-only app
 * resources directory and are injected as a local Claude plugin.
 */
import { application } from '@application'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import { AGENT_WORKSPACE_TYPE, type AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'
import fs from 'fs'
import path from 'path'

const logger = loggerService.withContext('BuiltinAgentProvisioner')

/** Resolve a localized field: string passes through; locale-keyed object resolves by current language. */
function resolveLocalizedField(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (typeof value !== 'object' || value === null) return undefined

  const map = value as Record<string, string>
  const lang = getAppLanguage()
  const prefix = lang.split('-')[0]
  const prefixKey = Object.keys(map).find((k) => k.startsWith(prefix))

  return map[lang] || (prefixKey && map[prefixKey]) || map['en-US'] || Object.values(map)[0]
}

const TEMPLATE_NAME_BY_ROLE: Record<string, string> = {
  assistant: 'cherry-assistant'
}

function getTemplateDir(builtinRole: string): string | undefined {
  const templateName = TEMPLATE_NAME_BY_ROLE[builtinRole]
  if (!templateName) {
    logger.warn('Unknown builtin role, skipping provisioning', { builtinRole })
    return undefined
  }

  return path.join(application.getPath('feature.agents.builtin'), templateName)
}

export function getBuiltinAgentPluginDirectory(builtinRole: string): string | undefined {
  const templateDir = getTemplateDir(builtinRole)
  if (!templateDir) return undefined

  const pluginDirectory = path.join(templateDir, '.claude')
  const manifestPath = path.join(pluginDirectory, '.claude-plugin', 'plugin.json')
  if (!fs.existsSync(manifestPath)) {
    logger.error('Builtin agent plugin manifest not found', { builtinRole, manifestPath })
    return undefined
  }

  return pluginDirectory
}

/**
 * Recursively copy a directory, creating target dirs as needed.
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

// No `description` here: the builtin agent's display/search description is owned by i18n
// (`agent.builtin.cherry_assistant.description`), not the bundle — a bundle copy would be a
// drift-prone second source of truth.
export interface BuiltinAgentConfig {
  name?: string
  instructions?: string
  configuration?: Record<string, unknown>
  skills?: string[]
}

export function loadBuiltinAgentDefinition(builtinRole: string): BuiltinAgentConfig | undefined {
  const templateDir = getTemplateDir(builtinRole)
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
      name: resolveLocalizedField(agentConfig.name),
      instructions: resolveLocalizedField(agentConfig.instructions),
      configuration: agentConfig.configuration,
      skills: agentConfig.skills
    } as BuiltinAgentConfig
  } catch (error) {
    logger.error('Failed to load builtin agent definition', {
      builtinRole,
      agentJsonPath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

/**
 * Initialize a built-in agent's app-owned system workspace.
 *
 * User workspaces are arbitrary project directories and are never modified by
 * this function. Bundled skills are loaded from the app-owned plugin directory.
 *
 * @param workspace - The agent session's workspace
 * @param builtinRole - The built-in role identifier (currently only 'assistant')
 * @returns The parsed agent.json config, or undefined if not found
 */
export async function provisionBuiltinAgent(
  workspace: Pick<AgentWorkspaceEntity, 'path' | 'type'>,
  builtinRole: string
): Promise<BuiltinAgentConfig | undefined> {
  const templateDir = getTemplateDir(builtinRole)
  if (!templateDir) return undefined

  if (!fs.existsSync(templateDir)) {
    logger.error('Builtin agent template not found', { templateDir, builtinRole })
    return undefined
  }

  const definition = loadBuiltinAgentDefinition(builtinRole)
  if (!definition || workspace.type !== AGENT_WORKSPACE_TYPE.SYSTEM) return definition

  const workspacePath = workspace.path

  try {
    // Copy SOUL.md, USER.md, and memory/ only if they don't already exist (first-time provision)
    // Never overwrite — user may have customized their persona or accumulated memories
    for (const soulFile of ['SOUL.md', 'USER.md']) {
      const srcFile = path.join(templateDir, soulFile)
      const destFile = path.join(workspacePath, soulFile)
      if (fs.existsSync(srcFile) && !fs.existsSync(destFile)) {
        fs.copyFileSync(srcFile, destFile)
      }
    }

    const srcMemoryDir = path.join(templateDir, 'memory')
    const destMemoryDir = path.join(workspacePath, 'memory')
    if (fs.existsSync(srcMemoryDir) && !fs.existsSync(destMemoryDir)) {
      copyDirSync(srcMemoryDir, destMemoryDir)
    }

    return definition
  } catch (error) {
    logger.error('Failed to provision builtin agent workspace', {
      builtinRole,
      workspacePath,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}
